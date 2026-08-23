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
	POLL_RETRY_EVENT_MS,
	TITLE_MODEL_ID,
	VIDEO_MODEL_IDS,
	VIDEO_POLLING_INTERVAL,
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
	OpenRouterPollTimeoutError,
	type OpenRouterVideoJob,
} from "../lib/openrouterVideo";
import {
	imageConfigSchema,
	normalPlannerOutputSchema,
	videoParamsSchema,
	type ImageConfig,
	type LastModelParamsUsed,
	type VideoParams,
} from "../lib/schemas";
import { buildShlokaPlannerSystemPrompt } from "../lib/plannerPrompt";
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

import { summarizePromptToLimit } from "../lib/promptSummarizer";

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

	const summarized = await summarizePromptToLimit(
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

// ── OpenRouter poll continuation (10-minute Node action limit) ──────────

type VideoJobTarget = {
	runId?: Id<"generationRuns">;
	planId?: Id<"shlokaPlans">;
	modelStudioRunId?: Id<"modelStudioRuns">;
};

type PollChunkOutcome =
	| { kind: "completed"; job: OpenRouterVideoJob }
	| { kind: "deferred" };

/**
 * Poll an OpenRouter video job for at most POLL_RETRY_EVENT_MS within THIS
 * action. An AbortController bounds the whole loop so in-flight fetches and
 * sleeps are cut off promptly at the budget edge. On expiry callers schedule
 * internal.studio.actions.continueVideoPoll and exit, letting the
 * continuation run with a fresh Convex action budget instead of dying at the
 * 10-minute limit with an expensive generation still pending.
 */
async function pollForOneActionBudget(
	apiKey: string,
	job: OpenRouterVideoJob,
): Promise<PollChunkOutcome> {
	const controller = new AbortController();
	const budgetTimer = setTimeout(() => controller.abort(), POLL_RETRY_EVENT_MS);
	try {
		const completed = await waitForOpenRouterVideoJob(apiKey, job, {
			intervalMs: VIDEO_POLLING_INTERVAL,
			timeoutMs: POLL_RETRY_EVENT_MS,
			signal: controller.signal,
		});
		return { kind: "completed", job: completed };
	} catch (error) {
		if (error instanceof OpenRouterPollTimeoutError) {
			return { kind: "deferred" };
		}
		throw error;
	} finally {
		clearTimeout(budgetTimer);
	}
}

/**
 * Download a completed job, store it in R2, commit the gallery row (which
 * atomically links plan/run status), and close out the job record.
 * `generationStartedAt` is the submit-time timestamp (job record creation for
 * continuations) — OpenRouter exposes cost on the final poll response but no
 * generation-duration field, so wall-clock time is measured on our side.
 */
async function completeVideoJob(
	ctx: ActionCtx,
	args: {
		apiKey: string;
		jobRecordId: Id<"openRouterVideoJobs">;
		completed: OpenRouterVideoJob;
		generationStartedAt: number;
		target: VideoJobTarget;
		videoParams: VideoParams;
		videoPrompt?: string;
		warnings?: string[];
	},
): Promise<void> {
	const downloaded = await downloadOpenRouterVideo(args.apiKey, args.completed);
	const objectKey = await storeBytes({
		kind: "videos",
		bytes: downloaded.bytes,
		mimeType: downloaded.mimeType,
	});
	const warnings =
		args.warnings && args.warnings.length > 0 ? args.warnings : undefined;
	await ctx.runMutation(internal.studio.internal.insertGalleryVideo, {
		runId: args.target.runId,
		planId: args.target.planId,
		modelStudioRunId: args.target.modelStudioRunId,
		video: {
			objectKey,
			meta: {
				mimeType: downloaded.mimeType,
				durationSeconds: args.videoParams.durationSeconds,
				bytes: downloaded.bytes.byteLength,
			},
			openRouterJobId: args.completed.id,
			openRouterGenerationId: args.completed.generation_id,
			actualCostUsd:
				typeof args.completed.usage?.cost === "number"
					? args.completed.usage.cost
					: undefined,
			timeTakenMs: Date.now() - args.generationStartedAt,
			videoParams: args.videoParams,
			videoPrompt: args.videoPrompt,
			warnings,
			createdAt: Date.now(),
		},
		warnings,
	});
	await ctx.runMutation(internal.studio.internal.setVideoJobStatus, {
		jobRecordId: args.jobRecordId,
		status: "completed",
		generationId: args.completed.generation_id,
	});
}

/** Mark a job failed in both the provider-job record and its owning pipeline. */
async function failVideoJob(
	ctx: ActionCtx,
	args: {
		jobRecordId: Id<"openRouterVideoJobs">;
		message: string;
		target: VideoJobTarget;
	},
): Promise<void> {
	await ctx.runMutation(internal.studio.internal.setVideoJobStatus, {
		jobRecordId: args.jobRecordId,
		status: "failed",
		errorMessage: args.message,
	});
	if (args.target.planId) {
		// Also flips the owning run to failed inside the same transaction.
		await ctx.runMutation(internal.studio.internal.failPlanVideoGeneration, {
			planId: args.target.planId,
			message: args.message,
		});
	} else if (args.target.modelStudioRunId) {
		await ctx.runMutation(internal.studio.internal.setModelStudioStatus, {
			runId: args.target.modelStudioRunId,
			status: "failed",
			lastError: args.message,
		});
	}
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
			const imageStartedAt = Date.now();
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
			const timeTakenMs = Date.now() - imageStartedAt;

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
				timeTakenMs,
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

		const genWarnings = [
			...adapted.warnings,
			...(resolved.usedSummary
				? [
						`Provider prompt was summarized to fit ${used.maxPromptChars} characters.`,
					]
				: []),
		];

		try {
			const apiKey = getOpenRouterApiKey();
			const generationStartedAt = Date.now();
			const submitted = await submitOpenRouterVideoJob(apiKey, adapted.body);
			const videoPrompt = videoScenesToMarkdown(
				normalizeVideoScenes(plan.videoScenes),
			);
			const jobRecordId = await ctx.runMutation(
				internal.studio.internal.createVideoJobRecord,
				{
					jobId: submitted.id,
					pollingUrl: submitted.polling_url,
					status: submitted.status,
					generationId: submitted.generation_id,
					errorMessage: submitted.error,
					runId: args.runId,
					planId: args.planId,
					videoParams: parsedParams,
					videoPrompt,
					warnings: genWarnings.length > 0 ? genWarnings : undefined,
				},
			);

			const outcome = await pollForOneActionBudget(apiKey, submitted);
			if (outcome.kind === "deferred") {
				// Job still in progress and this action is at its poll budget —
				// hand it to a continuation action with a fresh runtime budget
				// instead of failing. Run stays "video_generating" for the UI.
				await ctx.scheduler.runAfter(
					0,
					internal.studio.actions.continueVideoPoll,
					{ jobRecordId },
				);
				return null;
			}

			await completeVideoJob(ctx, {
				apiKey,
				jobRecordId,
				completed: outcome.job,
				generationStartedAt,
				target: { runId: args.runId, planId: args.planId },
				videoParams: parsedParams,
				videoPrompt,
				warnings: genWarnings,
			});
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

// ── Model studio prompt summarizer (reuses luna compressor) ─────────────────

export const summarizeModelStudioPrompt = action({
	args: {
		prompt: v.string(),
		maxPromptChars: v.number(),
	},
	returns: v.object({
		summarized: v.string(),
		originalLength: v.number(),
		summarizedLength: v.number(),
	}),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const original = args.prompt.trim();
		if (!original) throw new Error("Prompt is empty.");
		if (!Number.isFinite(args.maxPromptChars) || args.maxPromptChars < 100) {
			throw new Error("Invalid character limit.");
		}
		if (original.length > 20_000) {
			throw new Error("Prompt is too long to summarize (max 20,000).");
		}
		const summarized = await summarizePromptToLimit(
			original,
			Math.floor(args.maxPromptChars),
		);
		return {
			summarized,
			originalLength: original.length,
			summarizedLength: summarized.length,
		};
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
			const imageStartedAt = Date.now();
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
			const timeTakenMs = Date.now() - imageStartedAt;

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
				timeTakenMs,
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
			const generationStartedAt = Date.now();
			const submitted = await submitOpenRouterVideoJob(apiKey, adapted.body);
			const jobRecordId = await ctx.runMutation(
				internal.studio.internal.createVideoJobRecord,
				{
					jobId: submitted.id,
					pollingUrl: submitted.polling_url,
					status: submitted.status,
					generationId: submitted.generation_id,
					errorMessage: submitted.error,
					modelStudioRunId: args.runId,
					videoParams: parsedParams,
					videoPrompt: adapted.body.prompt,
					warnings:
						adapted.warnings.length > 0 ? adapted.warnings : undefined,
				},
			);

			const outcome = await pollForOneActionBudget(apiKey, submitted);
			if (outcome.kind === "deferred") {
				await ctx.scheduler.runAfter(
					0,
					internal.studio.actions.continueVideoPoll,
					{ jobRecordId },
				);
				return null;
			}

			await completeVideoJob(ctx, {
				apiKey,
				jobRecordId,
				completed: outcome.job,
				generationStartedAt,
				target: { modelStudioRunId: args.runId },
				videoParams: parsedParams,
				videoPrompt: adapted.body.prompt,
				warnings: adapted.warnings,
			});
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

// ── Poll continuation (self-rescheduling until terminal) ────────────────

/**
 * Continuation of an OpenRouter video job whose previous action exhausted
 * its POLL_RETRY_EVENT_MS budget. Scheduler-invoked (no user auth), so it
 * trusts the job record persisted by the submitting action. Polls for one
 * more chunk; on completion downloads + commits the gallery row; otherwise
 * reschedules itself with a fresh action budget until the provider reports
 * a terminal state.
 */
export const continueVideoPoll = internalAction({
	args: {
		jobRecordId: v.id("openRouterVideoJobs"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const record = (await ctx.runQuery(
			internal.studio.queries.getOpenRouterVideoJobDoc,
			{ jobRecordId: args.jobRecordId },
		)) as Doc<"openRouterVideoJobs"> | null;
		if (!record) {
			return null;
		}
		if (
			record.status === "completed" ||
			record.status === "failed" ||
			record.status === "cancelled" ||
			record.status === "expired"
		) {
			return null;
		}

		const apiKey = getOpenRouterApiKey();
		const current: OpenRouterVideoJob = {
			id: record.jobId,
			polling_url: record.pollingUrl,
			status: record.status,
		};

		let outcome: PollChunkOutcome;
		try {
			outcome = await pollForOneActionBudget(apiKey, current);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Video polling failed.";
			await failVideoJob(ctx, {
				jobRecordId: args.jobRecordId,
				message,
				target: record,
			});
			return null;
		}

		if (outcome.kind === "deferred") {
			await ctx.scheduler.runAfter(
				0,
				internal.studio.actions.continueVideoPoll,
				{ jobRecordId: args.jobRecordId },
			);
			return null;
		}

		try {
			await completeVideoJob(ctx, {
				apiKey,
				jobRecordId: args.jobRecordId,
				completed: outcome.job,
				// Job record was created right after submit — spans continuations.
				generationStartedAt: record.createdAt,
				target: record,
				videoParams: record.videoParams,
				videoPrompt: record.videoPrompt,
				warnings: record.warnings ?? undefined,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Video generation failed.";
			await failVideoJob(ctx, {
				jobRecordId: args.jobRecordId,
				message,
				target: record,
			});
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
