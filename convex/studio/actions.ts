"use node";

import { generateImage, generateText, Output } from "ai";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireAdmin } from "../lib/auth";
import {
	MODEL_CAPABILITY_PROFILES,
	PLANNER_MODEL_ID,
	TITLE_MODEL_ID,
	VIDEO_PROMPT_SUMMARIZER_MODEL_ID,
	VIDEO_MODEL_IDS,
	type VideoModelId,
	isVideoModelId,
} from "../lib/modelCatalog";
import {
	getOpenAIProvider,
	getOpenRouterApiKey,
	getOpenRouterProvider,
} from "../lib/providers";
import {
	downloadOpenRouterVideo,
	fetchOpenRouterVideoModels,
	submitOpenRouterVideoJob,
	waitForOpenRouterVideoJob,
} from "../lib/openrouterVideo";
import {
	imageConfigSchema,
	normalPlannerOutputSchema,
	videoParamsSchema,
	type ImageConfig,
	type LastModelParamsUsed,
} from "../lib/schemas";
import {
	VIDEO_PROMPT_SUMMARIZER_SYSTEM_PROMPT,
	buildShlokaPlannerSystemPrompt,
} from "../lib/plannerPrompt";
import {
	buildVideoPromptFromScenes,
	hashVideoPromptSource,
	normalizeVideoScenes,
	videoScenesToMarkdown,
} from "../lib/videoPlanMarkdown";
import { adaptOpenRouterVideoRequest } from "../lib/videoAdapters";
import {
	buildStudioObjectKey,
	createPresignedGetUrl,
	putObjectBytes,
} from "../lib/r2";

function buildPlannerPrompt(args: {
	shlokaText: string;
	customInstructions?: string;
	durationSeconds?: number;
	maxPromptChars?: number;
	aspectRatio?: string;
	generateAudio?: boolean;
}) {
	const sections: string[] = [
		[
			"## Shloka",
			"Preserve meaning; do not replace with an invented translation unless asked.",
			`"""`,
			args.shlokaText.trim(),
			`"""`,
		].join("\n"),
	];

	if (args.customInstructions?.trim()) {
		sections.push(
			[
				"## Custom instructions (hard constraints)",
				`"""`,
				args.customInstructions.trim(),
				`"""`,
			].join("\n"),
		);
	} else {
		sections.push(
			"## Custom instructions\nnone — default to warm Indian devotional atmosphere.",
		);
	}

	const meta: string[] = [];
	if (args.aspectRatio) {
		meta.push(`- Aspect ratio: ${args.aspectRatio}`);
	}
	if (args.durationSeconds != null) {
		meta.push(
			`- Target video length: ${args.durationSeconds} seconds (modulate beat count to fit).`,
		);
	}
	if (args.maxPromptChars != null) {
		meta.push(
			`- Provider video prompt character limit: ${args.maxPromptChars} (videoScenes will be flattened into one text prompt; stay concise and pricise but details that would enrich video scene should not be cut down either).`,
		);
	}
	meta.push(`- Generate Audio Plans: ${args.generateAudio ? "Yes" : "No"}`);
	if (meta.length > 0) {
		sections.push(["## Generation constraints", ...meta].join("\n"));
	}

	return sections.join("\n\n");
}

function planBudgetFromConfig(config: {
	modelId: string;
	aspectRatio: string;
	resolution: string;
	durationSeconds: number;
	generateAudio?: boolean;
	negativePrompt?: string;
	cfgScale?: number;
}): { budget: LastModelParamsUsed; modelId: VideoModelId } {
	if (!isVideoModelId(config.modelId)) {
		throw new Error("Select a supported video model.");
	}
	const profile = MODEL_CAPABILITY_PROFILES[config.modelId];
	return {
		modelId: config.modelId,
		budget: {
			modelId: config.modelId,
			aspectRatio: config.aspectRatio,
			resolution: config.resolution,
			durationSeconds: config.durationSeconds,
			generateAudio: config.generateAudio,
			negativePrompt: config.negativePrompt,
			cfgScale: config.cfgScale,
			maxPromptChars: profile.maxPromptChars,
		},
	};
}

const MAX_SUMMARIZE_ATTEMPTS = 3;

async function summarizeVideoPromptToLimit(
	prompt: string,
	maxChars: number,
): Promise<string> {
	const openrouter = getOpenRouterProvider();
	let current = prompt.trim();
	for (let attempt = 1; attempt <= MAX_SUMMARIZE_ATTEMPTS; attempt++) {
		const result = await generateText({
			model: openrouter(VIDEO_PROMPT_SUMMARIZER_MODEL_ID),
			reasoning: "none",
			instructions: VIDEO_PROMPT_SUMMARIZER_SYSTEM_PROMPT,
			prompt: [
				`Character limit: ${maxChars}`,
				`Current length: ${current.length}`,
				attempt > 1
					? `Previous attempt was still ${current.length} chars — compress more aggressively. Prefer shorter clauses; keep beat order.`
					: "Compress the following video prompt to fit the limit.",
				"",
				"PROMPT:",
				current,
			].join("\n"),
		});
		const next = result.text.replace(/^["'`\s]+|["'`\s]+$/g, "").trim();
		if (!next) {
			continue;
		}
		if (next.length <= maxChars && next.length < current.length) {
			return next;
		}
		// Accept if under limit even if not much shorter (edge: already near limit).
		if (next.length <= maxChars) {
			return next;
		}
		current = next.length < current.length ? next : current;
	}
	// Last resort: hard truncate at a word boundary.
	const fitted = current.slice(0, Math.max(1, maxChars - 1));
	const lastSpace = fitted.lastIndexOf(" ");
	const sliced =
		lastSpace > Math.floor(maxChars * 0.6) ? fitted.slice(0, lastSpace) : fitted;
	return `${sliced.trimEnd()}…`;
}

/**
 * Resolve the prompt that should be sent to the video provider.
 * Uses cached summary when hash matches; otherwise summarizes if over limit.
 */
async function resolveProviderVideoPrompt(
	ctx: ActionCtx,
	args: {
		planId: Id<"shlokaPlans">;
		fullPrompt: string;
		maxPromptChars: number;
		cachedSummary?: string;
		cachedHash?: string;
	},
): Promise<{ prompt: string; usedSummary: boolean }> {
	const full = args.fullPrompt.trim();
	const sourceHash = hashVideoPromptSource(full);
	if (full.length <= args.maxPromptChars) {
		await ctx.runMutation(internal.studio.internal.clearPlanPromptSummary, {
			planId: args.planId,
		});
		return { prompt: full, usedSummary: false };
	}

	if (
		args.cachedSummary?.trim() &&
		args.cachedHash === sourceHash &&
		args.cachedSummary.trim().length <= args.maxPromptChars
	) {
		return { prompt: args.cachedSummary.trim(), usedSummary: true };
	}

	const summarized = await summarizeVideoPromptToLimit(
		full,
		args.maxPromptChars,
	);
	await ctx.runMutation(internal.studio.internal.setPlanPromptSummaryCache, {
		planId: args.planId,
		sourceHash,
		summarizedVideoPrompt: summarized,
	});
	return { prompt: summarized, usedSummary: true };
}

function warningMessages(
	warnings: Array<{ message?: string; feature?: string; details?: string }>,
) {
	return warnings
		.map((warning) => warning.message ?? warning.details ?? warning.feature)
		.filter((value): value is string => Boolean(value));
}

async function storeBytes(args: {
	kind: "images" | "videos" | "frames";
	bytes: Uint8Array;
	mimeType: string;
	mediaId?: string;
}) {
	const objectKey = buildStudioObjectKey({
		kind: args.kind,
		mimeType: args.mimeType,
		mediaId: args.mediaId,
	});
	await putObjectBytes({
		objectKey,
		bytes: args.bytes,
		mimeType: args.mimeType,
	});
	return objectKey;
}

async function signedReadUrl(objectKey: string) {
	return await createPresignedGetUrl({ objectKey });
}

// ── Shloka planning ─────────────────────────────────────────────────────

export const planShlokaRun = action({
	args: {
		runId: v.id("generationRuns"),
		planId: v.id("shlokaPlans"),
		force: v.optional(v.boolean()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.runQuery(internal.studio.queries.getRunDoc, {
			runId: args.runId,
		});
		if (!run) {
			throw new Error("Run not found.");
		}
		const plan = (await ctx.runQuery(internal.studio.queries.getPlanDoc, {
			planId: args.planId,
		})) as Doc<"shlokaPlans"> | null;
		if (!plan || plan.runId !== args.runId) {
			throw new Error("Plan not found for this run.");
		}
		if (!run.shlokaText?.trim()) {
			throw new Error("Shloka text is required before planning.");
		}
		if (!run.plannerPromptSelection) {
			throw new Error("Select a system prompt template before planning.");
		}
		// No idempotency short-circuit here: regeneration is explicitly
		// confirmed in the UI, so an already-"ready" plan is always overwritten
		// (image prompt + scenes + lastModelParamsUsed). The action also
		// re-establishes the "planning" status so progress UI updates.

		await ctx.runMutation(internal.studio.internal.setPlanStatus, {
			planId: args.planId,
			status: "planning",
		});
		await ctx.runMutation(internal.studio.internal.setRunStatus, {
			runId: args.runId,
			status: "planning",
		});

		try {
			const resolvedPrompt = await ctx.runQuery(
				internal.studio.queries.resolvePlannerPromptSelectionForRun,
				{ selection: run.plannerPromptSelection },
			);
			const { budget } = planBudgetFromConfig(plan.videoParams);
			// Audio planning only when the model can generate audio AND the
			// user turned it on for this plan.
			const generateAudio =
				Boolean(budget.generateAudio) &&
				Boolean(
					MODEL_CAPABILITY_PROFILES[budget.modelId as VideoModelId]
						?.supportsAudio,
				);

			const result = await generateText({
				model: getOpenRouterProvider()(PLANNER_MODEL_ID),
				reasoning: "medium",
				instructions: buildShlokaPlannerSystemPrompt({
					stored: resolvedPrompt.content,
				}),
				prompt: buildPlannerPrompt({
					shlokaText: run.shlokaText,
					customInstructions: run.customInstructions,
					durationSeconds: budget.durationSeconds,
					maxPromptChars: budget.maxPromptChars,
					aspectRatio: budget.aspectRatio,
					generateAudio,
				}),
				output: Output.object({ schema: normalPlannerOutputSchema }),
			});
			const planOutput = result.output;
			const warnings = warningMessages(result.warnings ?? []);
			const videoScenes = normalizeVideoScenes(planOutput.videoScenes);

			await ctx.runMutation(internal.studio.internal.commitPlanContent, {
				planId: args.planId,
				imagePrompt: planOutput.imagePrompt,
				videoScenes,
				plannerModel: PLANNER_MODEL_ID,
				plannerReasoning: "medium",
				plannerSystemPrompt: resolvedPrompt.content,
				plannerSystemPromptTemplateId:
					resolvedPrompt.source === "template"
						? resolvedPrompt.templateId
						: undefined,
				lastModelParamsUsed: budget,
				warnings: warnings.length > 0 ? warnings : undefined,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Planning failed.";
			await ctx.runMutation(internal.studio.internal.setPlanStatus, {
				planId: args.planId,
				status: "failed",
				lastError: message,
			});
			await ctx.runMutation(internal.studio.internal.setRunStatus, {
				runId: args.runId,
				status: "failed",
				lastError: message,
			});
			throw error;
		}

		return null;
	},
});

// ── Reference image (shloka run) ────────────────────────────────────────

export const generateReferenceImage = action({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.runQuery(internal.studio.queries.getRunDoc, {
			runId: args.runId,
		});
		if (!run) {
			throw new Error("Run not found.");
		}
		const imagePrompt = run.activePlan?.imagePrompt?.trim();
		if (!imagePrompt) {
			throw new Error(
				"Generate the plan's reference-image prompt before generating an image.",
			);
		}

		const imageConfig = imageConfigSchema.parse({
			size: run.imageSize ?? "1024x1536",
			quality: run.imageQuality ?? "medium",
		});

		await ctx.runMutation(internal.studio.internal.setRunStatus, {
			runId: args.runId,
			status: "image_generating",
		});

		try {
			const openai = getOpenAIProvider();
			const result = await generateImage({
				model: openai.image("gpt-image-2"),
				prompt: imagePrompt.trim(),
				size: imageConfig.size as ImageConfig["size"],
				providerOptions: {
					openai: {
						quality: imageConfig.quality,
					},
				},
			});

			const image = result.image;
			const objectKey = await storeBytes({
				kind: "images",
				bytes: image.uint8Array,
				mimeType: image.mediaType,
			});
			const [width, height] = imageConfig.size.split("x").map(Number);
			const warnings = warningMessages(result.warnings ?? []);
			const openaiMeta = result.providerMetadata?.openai as
				| { revisedPrompt?: string }
				| undefined;

			await ctx.runMutation(internal.studio.internal.insertGalleryImage, {
				runId: args.runId,
				objectKey,
				meta: {
					mimeType: image.mediaType,
					width,
					height,
					bytes: image.uint8Array.byteLength,
				},
				source: "generated",
				revisedImagePrompt: openaiMeta?.revisedPrompt,
				setAsFirstFrame: false,
				warnings: warnings.length > 0 ? warnings : undefined,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Image generation failed.";
			await ctx.runMutation(internal.studio.internal.setRunStatus, {
				runId: args.runId,
				status: "failed",
				lastError: message,
			});
			throw error;
		}

		return null;
	},
});

// ── Video generation (shloka plan) ──────────────────────────────────────

export const generateVideoForRun = action({
	args: {
		runId: v.id("generationRuns"),
		planId: v.id("shlokaPlans"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.runQuery(internal.studio.queries.getRunDoc, {
			runId: args.runId,
		});
		if (!run) {
			throw new Error("Run not found.");
		}
		const plan = (await ctx.runQuery(internal.studio.queries.getPlanDoc, {
			planId: args.planId,
		})) as Doc<"shlokaPlans"> | null;
		if (!plan || plan.runId !== args.runId) {
			throw new Error("Plan not found for this run.");
		}
		if (plan.status !== "ready" || !plan.videoScenes?.length) {
			throw new Error("Generate the plan before generating a video.");
		}
		// ★ Generation uses the config snapshot from plan-generation time —
		// NOT the user's current edits (those apply after regeneration).
		const used = plan.lastModelParamsUsed as LastModelParamsUsed | null;
		if (!used) {
			throw new Error(
				"This plan has no generation config snapshot. Regenerate the plan.",
			);
		}
		if (!isVideoModelId(used.modelId)) {
			throw new Error("This plan uses an unsupported video model.");
		}
		const profile = MODEL_CAPABILITY_PROFILES[used.modelId];

		type RefImage = {
			id: string;
			objectKey: string;
		};
		const images = (run.images ?? []) as RefImage[];
		const first = images.find(
			(image: RefImage) => image.id === run.firstFrameImageId,
		);
		const last = images.find(
			(image: RefImage) => image.id === run.lastFrameImageId,
		);
		const extraIds = (run.extraReferenceImageIds ?? []) as string[];
		const imagesById = new Map(images.map((image: RefImage) => [image.id, image]));
		const extras = extraIds
			.filter((id: string) => id !== first?.id && id !== last?.id)
			.map((id: string) => imagesById.get(id))
			.filter((image): image is RefImage => Boolean(image));

		if (profile.requiresFirstFrame && !first) {
			throw new Error("This model requires a first-frame reference image.");
		}

		const parsedParams = videoParamsSchema.parse({
			modelId: used.modelId,
			aspectRatio: used.aspectRatio,
			resolution: used.resolution,
			durationSeconds: used.durationSeconds,
			generateAudio: used.generateAudio,
			negativePrompt: used.negativePrompt,
			cfgScale: used.cfgScale,
		});

		const fullPrompt = buildVideoPromptFromScenes(plan.videoScenes);
		const resolved = await resolveProviderVideoPrompt(ctx, {
			planId: args.planId,
			fullPrompt,
			maxPromptChars: used.maxPromptChars,
			cachedSummary: plan.summarizedVideoPrompt,
			cachedHash: plan.videoPromptSourceHash,
		});

		const firstUrl = first ? await signedReadUrl(first.objectKey) : null;
		const lastUrl = last ? await signedReadUrl(last.objectKey) : null;
		const referenceUrls = await Promise.all(
			extras.map(async (image: RefImage) => signedReadUrl(image.objectKey)),
		);

		const adapted = adaptOpenRouterVideoRequest({
			params: {
				...parsedParams,
				prompt: resolved.prompt,
			},
			fallbackPrompt: resolved.prompt,
			firstFrameUrl: firstUrl,
			lastFrameUrl: lastUrl,
			referenceUrls,
		});

		await ctx.runMutation(internal.studio.internal.setRunStatus, {
			runId: args.runId,
			status: "video_generating",
		});

		try {
			const apiKey = getOpenRouterApiKey();
			const submitted = await submitOpenRouterVideoJob(apiKey, adapted.body);
			const completed = await waitForOpenRouterVideoJob(apiKey, submitted, {
				intervalMs: 8000,
				timeoutMs: 540_000,
			});
			const downloaded = await downloadOpenRouterVideo(apiKey, completed);
			const objectKey = await storeBytes({
				kind: "videos",
				bytes: downloaded.bytes,
				mimeType: downloaded.mimeType,
			});

			const genWarnings = [
				...adapted.warnings,
				...(resolved.usedSummary
					? [
							`Provider prompt was summarized to fit ${used.maxPromptChars} characters.`,
						]
					: []),
			];

			await ctx.runMutation(
				internal.studio.internal.insertGalleryVideo,
				{
					runId: args.runId,
					planId: args.planId,
					video: {
						objectKey,
						meta: {
							mimeType: downloaded.mimeType,
							durationSeconds: adapted.body.duration,
							bytes: downloaded.bytes.byteLength,
						},
						openRouterJobId: completed.id,
						openRouterGenerationId: completed.generation_id,
						actualCostUsd:
							typeof completed.usage?.cost === "number"
								? completed.usage.cost
								: undefined,
						videoParams: parsedParams,
						videoPrompt: videoScenesToMarkdown(
							normalizeVideoScenes(plan.videoScenes),
						),
						warnings: genWarnings.length > 0 ? genWarnings : undefined,
						createdAt: Date.now(),
					},
					warnings: genWarnings.length > 0 ? genWarnings : undefined,
				},
			);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Video generation failed.";
			await ctx.runMutation(internal.studio.internal.failPlanVideoGeneration, {
				planId: args.planId,
				message,
			});
			await ctx.runMutation(internal.studio.internal.setRunStatus, {
				runId: args.runId,
				status: "failed",
				lastError: message,
			});
			throw error;
		}

		return null;
	},
});

/** Rebuild / refresh the Luna-compressed provider prompt for a plan. */
export const refreshPlanPromptSummary = internalAction({
	args: {
		planId: v.id("shlokaPlans"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const plan = (await ctx.runQuery(internal.studio.queries.getPlanDoc, {
			planId: args.planId,
		})) as Doc<"shlokaPlans"> | null;
		if (!plan?.videoScenes?.length || !plan.lastModelParamsUsed) {
			return null;
		}
		const fullPrompt = buildVideoPromptFromScenes(plan.videoScenes);
		await resolveProviderVideoPrompt(ctx, {
			planId: args.planId,
			fullPrompt,
			maxPromptChars: plan.lastModelParamsUsed.maxPromptChars,
			cachedSummary: plan.summarizedVideoPrompt,
			cachedHash: plan.videoPromptSourceHash,
		});
		return null;
	},
});

// ── Model studio (direct-to-API) ────────────────────────────────────────

export const generateModelStudioImage = action({
	args: {
		runId: v.id("modelStudioRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = (await ctx.runQuery(
			internal.studio.queries.getModelStudioRunDoc,
			{ runId: args.runId },
		)) as Doc<"modelStudioRuns"> | null;
		if (!run) {
			throw new Error("Run not found.");
		}
		const imagePrompt =
			run.prompt?.trim() || run.videoParams?.prompt?.trim() || "";
		if (!imagePrompt) {
			throw new Error("A prompt is required before generating an image.");
		}

		const imageConfig = imageConfigSchema.parse({
			size: run.imageSize ?? "1024x1536",
			quality: run.imageQuality ?? "medium",
		});

		await ctx.runMutation(internal.studio.internal.setModelStudioStatus, {
			runId: args.runId,
			status: "generating",
		});

		try {
			const openai = getOpenAIProvider();
			const result = await generateImage({
				model: openai.image("gpt-image-2"),
				prompt: imagePrompt.trim(),
				size: imageConfig.size as ImageConfig["size"],
				providerOptions: {
					openai: {
						quality: imageConfig.quality,
					},
				},
			});

			const image = result.image;
			const objectKey = await storeBytes({
				kind: "images",
				bytes: image.uint8Array,
				mimeType: image.mediaType,
			});
			const [width, height] = imageConfig.size.split("x").map(Number);
			const warnings = warningMessages(result.warnings ?? []);
			const openaiMeta = result.providerMetadata?.openai as
				| { revisedPrompt?: string }
				| undefined;

			await ctx.runMutation(internal.studio.internal.insertGalleryImage, {
				modelStudioRunId: args.runId,
				objectKey,
				meta: {
					mimeType: image.mediaType,
					width,
					height,
					bytes: image.uint8Array.byteLength,
				},
				source: "generated",
				revisedImagePrompt: openaiMeta?.revisedPrompt,
				setAsFirstFrame: false,
				warnings: warnings.length > 0 ? warnings : undefined,
			});
			await ctx.runMutation(internal.studio.internal.setModelStudioStatus, {
				runId: args.runId,
				status: "draft",
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Image generation failed.";
			await ctx.runMutation(internal.studio.internal.setModelStudioStatus, {
				runId: args.runId,
				status: "failed",
				lastError: message,
			});
			throw error;
		}

		return null;
	},
});

export const generateModelStudioVideo = action({
	args: {
		runId: v.id("modelStudioRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = (await ctx.runQuery(
			internal.studio.queries.getModelStudioRunDoc,
			{ runId: args.runId },
		)) as Doc<"modelStudioRuns"> | null;
		if (!run) {
			throw new Error("Run not found.");
		}
		const modelId = run.selectedModelId ?? run.videoParams?.modelId;
		if (!modelId || !isVideoModelId(modelId)) {
			throw new Error("Select a supported video model.");
		}
		const prompt =
			run.prompt?.trim() || run.videoParams?.prompt?.trim() || "";
		if (!prompt) {
			throw new Error("A video prompt is required before generating.");
		}
		const profile = MODEL_CAPABILITY_PROFILES[modelId];

		type RefImage = {
			id: string;
			objectKey: string;
		};
		const images = ((await ctx.runQuery(
			internal.studio.queries.listModelStudioRunImages,
			{ runId: args.runId },
		)) ?? []) as RefImage[];
		const first = images.find((image) => image.id === run.firstFrameImageId);
		const last = images.find((image) => image.id === run.lastFrameImageId);
		const extraIds = (run.extraReferenceImageIds ?? []) as string[];
		const imagesById = new Map(images.map((image) => [image.id, image]));
		const extras = extraIds
			.filter((id) => id !== first?.id && id !== last?.id)
			.map((id) => imagesById.get(id))
			.filter((image): image is RefImage => Boolean(image));

		if (profile.requiresFirstFrame && !first) {
			throw new Error("This model requires a first-frame reference image.");
		}

		const parsedParams = videoParamsSchema.parse({
			...(run.videoParams ?? {}),
			modelId,
			prompt,
		});

		const firstUrl = first ? await signedReadUrl(first.objectKey) : null;
		const lastUrl = last ? await signedReadUrl(last.objectKey) : null;
		const referenceUrls = await Promise.all(
			extras.map(async (image) => signedReadUrl(image.objectKey)),
		);

		const adapted = adaptOpenRouterVideoRequest({
			params: parsedParams,
			fallbackPrompt: prompt,
			firstFrameUrl: firstUrl,
			lastFrameUrl: lastUrl,
			referenceUrls,
		});

		await ctx.runMutation(internal.studio.internal.setModelStudioStatus, {
			runId: args.runId,
			status: "generating",
		});

		try {
			const apiKey = getOpenRouterApiKey();
			const submitted = await submitOpenRouterVideoJob(apiKey, adapted.body);
			const completed = await waitForOpenRouterVideoJob(apiKey, submitted, {
				intervalMs: 8000,
				timeoutMs: 540_000,
			});
			const downloaded = await downloadOpenRouterVideo(apiKey, completed);
			const objectKey = await storeBytes({
				kind: "videos",
				bytes: downloaded.bytes,
				mimeType: downloaded.mimeType,
			});

			const videoId = await ctx.runMutation(
				internal.studio.internal.insertGalleryVideo,
				{
					modelStudioRunId: args.runId,
					video: {
						objectKey,
						meta: {
							mimeType: downloaded.mimeType,
							durationSeconds: adapted.body.duration,
							bytes: downloaded.bytes.byteLength,
						},
						openRouterJobId: completed.id,
						openRouterGenerationId: completed.generation_id,
						actualCostUsd:
							typeof completed.usage?.cost === "number"
								? completed.usage.cost
								: undefined,
						videoParams: parsedParams,
						videoPrompt: adapted.body.prompt,
						warnings:
							adapted.warnings.length > 0 ? adapted.warnings : undefined,
						createdAt: Date.now(),
					},
					warnings:
						adapted.warnings.length > 0 ? adapted.warnings : undefined,
				},
			);
			void videoId;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Video generation failed.";
			await ctx.runMutation(internal.studio.internal.setModelStudioStatus, {
				runId: args.runId,
				status: "failed",
				lastError: message,
			});
			throw error;
		}

		return null;
	},
});

// ── Model studio titles ─────────────────────────────────────────────────

async function modelStudioTitleGeneration(
	ctx: ActionCtx,
	args: { runId: Id<"modelStudioRuns">; force?: boolean },
): Promise<string> {
	const run: Doc<"modelStudioRuns"> | null = await ctx.runQuery(
		internal.studio.queries.getModelStudioRunDoc,
		{ runId: args.runId },
	);
	if (!run) {
		throw new Error("Run not found.");
	}
	if (!args.force && run.title?.trim()) {
		return run.title;
	}

	const prompt = (run.prompt as string | undefined)?.trim();
	const modelId = run.selectedModelId;
	const modelLabel =
		modelId && isVideoModelId(modelId)
			? MODEL_CAPABILITY_PROFILES[modelId as VideoModelId].displayName
			: null;
	const fallback = modelLabel ?? "Model Run";

	const context = prompt ? `Video prompt: ${prompt.slice(0, 600)}` : "";
	if (!context.trim()) {
		return fallback;
	}

	try {
		const result = await generateText({
			model: getOpenRouterProvider()(TITLE_MODEL_ID),
			reasoning: "none",
			instructions:
				"You write short, clear titles for video-generation runs (under 60 characters). No quotes, emoji, hashtags, or trailing punctuation.",
			prompt: `Write a short title for this run.\n\n${context}`,
		});
		const title =
			result.text.replace(/^["'`\s]+|["'`\s]+$/g, "").trim().slice(0, 90) ||
			fallback;
		await ctx.runMutation(internal.studio.internal.setModelStudioTitle, {
			runId: args.runId,
			title,
		});
		return title;
	} catch {
		return fallback;
	}
}

export const generateModelStudioTitle = action({
	args: {
		runId: v.id("modelStudioRuns"),
		force: v.optional(v.boolean()),
	},
	returns: v.string(),
	handler: async (ctx, args): Promise<string> => {
		await requireAdmin(ctx);
		return await modelStudioTitleGeneration(ctx, args);
	},
});

export const generateModelStudioTitleScheduled = internalAction({
	args: {
		runId: v.id("modelStudioRuns"),
		force: v.optional(v.boolean()),
	},
	returns: v.string(),
	handler: async (ctx, args): Promise<string> => {
		return await modelStudioTitleGeneration(ctx, args);
	},
});

export const refreshModelCatalog = action({
	args: {},
	returns: v.any(),
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const apiKey = getOpenRouterApiKey();
		const models = await fetchOpenRouterVideoModels(apiKey);
		const allowed = new Set(VIDEO_MODEL_IDS);
		const filtered = (models as Array<{ id: string }>).filter((model) =>
			allowed.has(model.id as VideoModelId),
		);

		const payload = JSON.stringify(filtered);
		const fetchedAt = Date.now();
		await ctx.runMutation(internal.studio.internal.setCatalogCache, {
			payload,
			fetchedAt,
		});

		return {
			fetchedAt,
			models: filtered,
			profiles: MODEL_CAPABILITY_PROFILES,
		};
	},
});

/** Shared title-generation logic used by both the public and internal actions. */
async function runTitleGeneration(
	ctx: ActionCtx,
	args: { runId: Id<"generationRuns">; force?: boolean },
): Promise<string> {
	const run: Doc<"generationRuns"> | null = await ctx.runQuery(
		internal.studio.queries.getRunDoc,
		{ runId: args.runId },
	);
	if (!run) {
		throw new Error("Run not found.");
	}
	// Only fill an empty title; never overwrite an existing one unless forced
	// (manual "regenerate title"). This keeps plan regeneration from churning titles.
	if (!args.force && run.title?.trim()) {
		return run.title;
	}

	const shloka = (run.shlokaText as string | undefined)?.trim();
	const fallback = "Shloka Run";

	const context = shloka ? `Shloka: ${shloka.slice(0, 600)}` : "";
	if (!context.trim()) {
		// Nothing to summarize yet — leave the title null (UI shows a neutral
		// fallback) so the real generation can happen once content exists.
		return fallback;
	}

	try {
		const result = await generateText({
			model: getOpenRouterProvider()(TITLE_MODEL_ID),
			reasoning: "none",
			instructions:
				"You write short, clear titles for video-generation runs (under 60 characters). No quotes, emoji, hashtags, or trailing punctuation.",
			prompt: `Write a short title for this run.\n\n${context}`,
		});
		const title =
			result.text.replace(/^["'`\s]+|["'`\s]+$/g, "").trim().slice(0, 90) ||
			fallback;
		await ctx.runMutation(internal.studio.internal.setRunTitle, {
			runId: args.runId,
			title,
		});
		return title;
	} catch {
		// Generation failed — leave the title null rather than dumping raw
		// content; the user can retry via "Regenerate title".
		return fallback;
	}
}

/** Public: called from the client ("Regenerate title" in the sidebar). */
export const generateRunTitle = action({
	args: {
		runId: v.id("generationRuns"),
		force: v.optional(v.boolean()),
	},
	returns: v.string(),
	handler: async (ctx, args): Promise<string> => {
		await requireAdmin(ctx);
		return await runTitleGeneration(ctx, args);
	},
});

/**
 * Internal: scheduled from mutations (run creation, draft updates, plan
 * commits). Scheduler-invoked functions carry no user auth, so this variant
 * skips requireAdmin — internal functions are only callable by other Convex
 * functions, which is safe.
 */
export const generateRunTitleScheduled = internalAction({
	args: {
		runId: v.id("generationRuns"),
		force: v.optional(v.boolean()),
	},
	returns: v.string(),
	handler: async (ctx, args): Promise<string> => {
		return await runTitleGeneration(ctx, args);
	},
});
