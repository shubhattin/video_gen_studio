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
	compositionPlannerOutputSchema,
	normalPlannerOutputSchema,
	videoParamsSchema,
	type ImageConfig,
} from "../lib/schemas";
import {
	MODEL_STUDIO_PLANNER_SYSTEM_PROMPT,
	VIDEO_PROMPT_SUMMARIZER_SYSTEM_PROMPT,
	buildShlokaPlannerSystemPrompt,
	multiClipPlannerInstructions,
} from "../lib/plannerPrompt";
import {
	buildVideoPromptFromScenes,
	hashVideoPromptSource,
	normalizeVideoScenes,
} from "../lib/videoPlanMarkdown";
import { adaptOpenRouterVideoRequest } from "../lib/videoAdapters";
import {
	buildStudioObjectKey,
	createPresignedGetUrl,
	deleteObjects as deleteR2Objects,
	putObjectBytes,
} from "../lib/r2";

function buildPlannerPrompt(args: {
	shlokaText: string;
	customInstructions?: string;
	mode: "single-clip" | "multi-clip";
	durationSeconds?: number;
	maxPromptChars?: number;
	aspectRatio?: string;
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
			`- Provider video prompt character limit: ${args.maxPromptChars} (videoScenes will be flattened into one text prompt; stay concise and pricise).`,
		);
	}
	if (meta.length > 0) {
		sections.push(["## Generation constraints", ...meta].join("\n"));
	}

	if (args.mode === "multi-clip") {
		sections.push(
			"## Task\nProduce imagePrompt + overallDescription + ordered clips for a portrait multi-clip short rooted in this shloka.",
		);
	} else {
		sections.push(
			"## Task\nProduce imagePrompt + videoScenes (Seedance six-part beats) for a portrait short rooted in this shloka.",
		);
	}

	return sections.join("\n\n");
}

function buildModelStudioPlannerPrompt(prompt: string) {
	return `Video brief (follow closely):\n"""\n${prompt}\n"""`;
}

function compositionPlannerExtension(run: {
	compositionMode?: "continuation" | "cut-scenes";
	compositionClipCount?: number;
	videoParams?: { durationSeconds: number; modelId: string };
}) {
	if (
		!run.compositionMode ||
		!run.compositionClipCount ||
		!run.videoParams ||
		!isVideoModelId(run.videoParams.modelId)
	) {
		return null;
	}
	return {
		mode: run.compositionMode,
		clipCount: run.compositionClipCount,
		clipDurationSeconds: run.videoParams.durationSeconds,
		maxPromptChars: MODEL_CAPABILITY_PROFILES[run.videoParams.modelId]
			.maxPromptChars,
	};
}

function singleClipPlannerBudget(run: {
	videoParams?: { durationSeconds: number; modelId: string; aspectRatio?: string };
	selectedModelId?: string;
}) {
	const modelId =
		(run.videoParams?.modelId && isVideoModelId(run.videoParams.modelId)
			? run.videoParams.modelId
			: null) ??
		(run.selectedModelId && isVideoModelId(run.selectedModelId)
			? run.selectedModelId
			: null) ??
		"bytedance/seedance-2.5";
	const profile = MODEL_CAPABILITY_PROFILES[modelId];
	return {
		modelId,
		durationSeconds: run.videoParams?.durationSeconds ?? 8,
		maxPromptChars: profile.maxPromptChars,
		aspectRatio: run.videoParams?.aspectRatio ?? "9:16",
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
		runId: Id<"generationRuns">;
		fullPrompt: string;
		maxPromptChars: number;
		cachedSummary?: string;
		cachedHash?: string;
		persist?: boolean;
	},
): Promise<{ prompt: string; usedSummary: boolean }> {
	const full = args.fullPrompt.trim();
	const sourceHash = hashVideoPromptSource(full);
	if (full.length <= args.maxPromptChars) {
		if (args.persist) {
			await ctx.runMutation(internal.studio.internal.clearVideoPromptSummary, {
				runId: args.runId,
				videoPrompt: full,
			});
		}
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
	if (args.persist) {
		await ctx.runMutation(internal.studio.internal.setVideoPromptSummaryCache, {
			runId: args.runId,
			videoPrompt: full,
			sourceHash,
			summarizedVideoPrompt: summarized,
		});
	}
	return { prompt: summarized, usedSummary: true };
}

/** Prepended at image gen time so gpt-image-2 / Seedance refs stay illustrated. */
const IMAGE_STYLE_SAFETY_PREFIX =
	"Stylized Indian miniature painting and temple-mural illustration, painted characters only, warm temple gold and marigold accents, not a photograph of a real person, no photoreal skin, no celebrity likeness.";

function withImageStyleSafety(prompt: string) {
	const trimmed = prompt.trim();
	if (
		/stylized indian miniature|temple[- ]mural|not a (photo|photograph) of a real person/i.test(
			trimmed,
		)
	) {
		return trimmed;
	}
	return `${IMAGE_STYLE_SAFETY_PREFIX} ${trimmed}`;
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

export const planShlokaRun = action({
	args: {
		runId: v.id("generationRuns"),
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
		if (!run.shlokaText?.trim()) {
			throw new Error("Shloka text is required before planning.");
		}
		if (!run.plannerPromptSelection) {
			throw new Error(
				"Select a system prompt template before planning.",
			);
		}
		const resolvedPrompt = await ctx.runQuery(
			internal.studio.queries.resolvePlannerPromptSelectionForRun,
			{ selection: run.plannerPromptSelection },
		);

		const planningKey = `plan-${args.runId}-${Date.now().toString(36)}`;
		if (
			!args.force &&
			run.activePlanId &&
			run.status === "plan_ready" &&
			run.imagePrompt &&
			run.videoScenes
		) {
			return null;
		}

		await ctx.runMutation(internal.studio.internal.setRunStatus, {
			runId: args.runId,
			status: "planning",
		});

		try {
			const openrouter = getOpenRouterProvider();
			const composition = compositionPlannerExtension(run);
			const budget = singleClipPlannerBudget(run);
			if (composition) {
				const result = await generateText({
					model: openrouter(PLANNER_MODEL_ID),
					reasoning: "medium",
					instructions: buildShlokaPlannerSystemPrompt({
						stored: resolvedPrompt.content,
						composition,
					}),
					prompt: buildPlannerPrompt({
						shlokaText: run.shlokaText,
						customInstructions: run.customInstructions,
						mode: "multi-clip",
						durationSeconds: composition.clipDurationSeconds,
						maxPromptChars: composition.maxPromptChars,
						aspectRatio: budget.aspectRatio,
					}),
					output: Output.object({ schema: compositionPlannerOutputSchema }),
				});
				const plan = result.output;
				const warnings = warningMessages(result.warnings ?? []);
				await ctx.runMutation(internal.studio.internal.commitCompositionPlan, {
					runId: args.runId,
					plannerModel: PLANNER_MODEL_ID,
					plannerReasoning: "medium",
					imagePrompt: plan.imagePrompt,
					overallDescription: plan.overallDescription,
					clips: plan.clips,
					warnings: warnings.length > 0 ? warnings : undefined,
					planningKey,
				});
			} else {
				const result = await generateText({
					model: openrouter(PLANNER_MODEL_ID),
					reasoning: "medium",
					instructions: buildShlokaPlannerSystemPrompt({
						stored: resolvedPrompt.content,
						composition: null,
						singleClip: {
							durationSeconds: budget.durationSeconds,
							maxPromptChars: budget.maxPromptChars,
						},
					}),
					prompt: buildPlannerPrompt({
						shlokaText: run.shlokaText,
						customInstructions: run.customInstructions,
						mode: "single-clip",
						durationSeconds: budget.durationSeconds,
						maxPromptChars: budget.maxPromptChars,
						aspectRatio: budget.aspectRatio,
					}),
					output: Output.object({ schema: normalPlannerOutputSchema }),
				});
				const plan = result.output;
				const warnings = warningMessages(result.warnings ?? []);
				const videoScenes = normalizeVideoScenes(plan.videoScenes);
				await ctx.runMutation(internal.studio.internal.commitPlan, {
					runId: args.runId,
					plannerModel: PLANNER_MODEL_ID,
					plannerReasoning: "medium",
					imagePrompt: plan.imagePrompt,
					videoScenes,
					warnings: warnings.length > 0 ? warnings : undefined,
					planningKey,
					plannerSystemPrompt: resolvedPrompt.content,
					plannerSystemPromptTemplateId:
						resolvedPrompt.source === "template"
							? resolvedPrompt.templateId
							: undefined,
				});
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Planning failed.";
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

export const planModelStudioComposition = action({
	args: {
		runId: v.id("generationRuns"),
		force: v.optional(v.boolean()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.runQuery(internal.studio.queries.getRunDoc, {
			runId: args.runId,
		});
		const prompt = run?.videoPrompt?.trim() ?? run?.videoParams?.prompt?.trim();
		if (!run || !prompt) {
			throw new Error("A video prompt is required before planning.");
		}
		const composition = compositionPlannerExtension(run);
		if (!composition) {
			throw new Error("Enable multi-clip composition before planning.");
		}
		const planningKey = `model-composition-plan-${args.runId}`;
		if (
			!args.force &&
			run.planningKey === planningKey &&
			run.status === "plan_ready"
		) {
			return null;
		}
		await ctx.runMutation(internal.studio.internal.setRunStatus, {
			runId: args.runId,
			status: "planning",
		});
		try {
			const result = await generateText({
				model: getOpenRouterProvider()(PLANNER_MODEL_ID),
				reasoning: "medium",
				instructions: `${MODEL_STUDIO_PLANNER_SYSTEM_PROMPT}\n\n${multiClipPlannerInstructions(composition)}`,
				prompt: buildModelStudioPlannerPrompt(prompt),
				output: Output.object({ schema: compositionPlannerOutputSchema }),
			});
			const plan = result.output;
			await ctx.runMutation(internal.studio.internal.commitCompositionPlan, {
				runId: args.runId,
				plannerModel: PLANNER_MODEL_ID,
				plannerReasoning: "medium",
				imagePrompt: plan.imagePrompt,
				overallDescription: plan.overallDescription,
				clips: plan.clips,
				warnings:
					warningMessages(result.warnings ?? []).length > 0
						? warningMessages(result.warnings ?? [])
						: undefined,
				planningKey,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Composition planning failed.";
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
		if (!run?.imagePrompt && !run?.videoPrompt && !run?.videoParams?.prompt) {
			throw new Error(
				"Plan an image prompt (or provide a video prompt) before generating a reference image.",
			);
		}

		const imagePrompt =
			run.imagePrompt?.trim() ||
			run.videoPrompt?.trim() ||
			run.videoParams?.prompt?.trim() ||
			"";

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
				prompt: withImageStyleSafety(imagePrompt),
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

export const generateVideoForRun = action({
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

		const modelId = run.selectedModelId ?? run.videoParams?.modelId;
		if (!modelId || !isVideoModelId(modelId)) {
			throw new Error("Select a supported video model.");
		}

		const profile = MODEL_CAPABILITY_PROFILES[modelId];
		type RefImage = {
			id: string;
			objectKey: string;
		};
		const images = (run.referenceImages ?? []) as RefImage[];
		const first = images.find(
			(image: RefImage) => image.id === run.firstFrameImageId,
		);
		const last = images.find(
			(image: RefImage) => image.id === run.lastFrameImageId,
		);
		const extraIds = (run.extraReferenceImageIds ?? []) as string[];
		const imagesById = new Map(
			images.map((image: RefImage) => [image.id, image]),
		);
		const extras = extraIds
			.filter((id: string) => id !== first?.id && id !== last?.id)
			.map((id: string) => imagesById.get(id))
			.filter((image): image is RefImage => Boolean(image));

		if (profile.requiresFirstFrame && !first) {
			throw new Error("This model requires a first-frame reference image.");
		}

		const parsedParams = videoParamsSchema.parse({
			...run.videoParams,
			modelId,
		});

		const fullPrompt =
			run.videoPrompt?.trim() ||
			(run.videoScenes
				? buildVideoPromptFromScenes(run.videoScenes)
				: run.imagePrompt) ||
			"Warm Indian cinematic motion portrait.";

		const resolved = await resolveProviderVideoPrompt(ctx, {
			runId: args.runId,
			fullPrompt,
			maxPromptChars: profile.maxPromptChars,
			cachedSummary: run.summarizedVideoPrompt,
			cachedHash: run.videoPromptSourceHash,
			persist: true,
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

		await ctx.runMutation(internal.studio.internal.updateVideoConfig, {
			runId: args.runId,
			selectedModelId: modelId,
			videoParams: parsedParams,
			videoPrompt: fullPrompt,
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
							`Provider prompt was summarized to fit ${profile.maxPromptChars} characters.`,
						]
					: []),
			];

			await ctx.runMutation(internal.studio.internal.insertGalleryVideo, {
				runId: args.runId,
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
					warnings: genWarnings.length > 0 ? genWarnings : undefined,
					createdAt: Date.now(),
				},
				warnings: genWarnings.length > 0 ? genWarnings : undefined,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Video generation failed.";
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

/** Rebuild / refresh summarized provider prompt when scenes or model budget change. */
export const refreshVideoPromptSummary = internalAction({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.runQuery(internal.studio.queries.getRunDoc, {
			runId: args.runId,
		});
		if (!run) {
			return null;
		}
		const fullPrompt =
			run.videoPrompt?.trim() ||
			(run.videoScenes
				? buildVideoPromptFromScenes(run.videoScenes)
				: undefined);
		if (!fullPrompt) {
			return null;
		}
		const budget = singleClipPlannerBudget(run);
		await resolveProviderVideoPrompt(ctx, {
			runId: args.runId,
			fullPrompt,
			maxPromptChars: budget.maxPromptChars,
			cachedSummary: run.summarizedVideoPrompt,
			cachedHash: run.videoPromptSourceHash,
			persist: true,
		});
		return null;
	},
});

export const generateNextCompositionClip = internalAction({
	args: {
		jobId: v.id("compositionJobs"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const claimed = await ctx.runMutation(
			internal.studio.internal.claimNextCompositionClip,
			{ jobId: args.jobId },
		);
		if (!claimed) {
			return null;
		}

		const { job, clip, previousTerminalFrameObjectKey } = claimed as {
			job: {
				runId: Id<"generationRuns">;
				mode: "continuation" | "cut-scenes";
				clipCount: number;
				videoParams: {
					modelId: string;
					aspectRatio: string;
					resolution: string;
					durationSeconds: number;
					generateAudio?: boolean;
					negativePrompt?: string;
					cfgScale?: number;
				};
			};
			clip: {
				_id: Id<"compositionClips">;
				clipIndex: number;
				scenePrompt: string;
			};
			previousTerminalFrameObjectKey?: string;
		};
		let generatedObjectKey: string | undefined;
		try {
			if (!isVideoModelId(job.videoParams.modelId)) {
				throw new Error("Composition uses an unsupported video model.");
			}
			const run = await ctx.runQuery(internal.studio.queries.getRunDoc, {
				runId: job.runId,
			});
			if (!run) {
				throw new Error("Composition run was not found.");
			}
			const profile = MODEL_CAPABILITY_PROFILES[job.videoParams.modelId];
			const referenceWarnings: string[] = [];
			let firstFrameUrl: string | null = null;
			const referenceUrls: string[] = [];

			const explicitReferenceObjectKey =
				clip.clipIndex === 0
					? run.referenceImages?.find(
							(image: { id: string; objectKey: string }) =>
								image.id === run.firstFrameImageId,
						)?.objectKey
					: undefined;
			if (explicitReferenceObjectKey) {
				firstFrameUrl = await signedReadUrl(explicitReferenceObjectKey);
			}

			if (previousTerminalFrameObjectKey) {
				const terminalFrameUrl = await signedReadUrl(
					previousTerminalFrameObjectKey,
				);
				if (terminalFrameUrl) {
					if (profile.supportsFirstFrame) {
						firstFrameUrl = terminalFrameUrl;
					} else if (profile.supportsInputReferences) {
						referenceUrls.push(terminalFrameUrl);
					} else {
						referenceWarnings.push(
							"Previous terminal frame could not be sent because this model does not support image references; continuing from the scene prompt only.",
						);
					}
				} else {
					referenceWarnings.push(
						"Previous terminal frame was unavailable; continuing from the scene prompt only.",
					);
				}
			} else if (clip.clipIndex > 0 && job.mode === "continuation") {
				referenceWarnings.push(
					"Previous terminal frame is unavailable; continuing from the scene prompt only.",
				);
			}

			const adapted = adaptOpenRouterVideoRequest({
				params: videoParamsSchema.parse({
					...job.videoParams,
					prompt: clip.scenePrompt,
				}),
				fallbackPrompt: clip.scenePrompt,
				firstFrameUrl,
				referenceUrls,
			});
			const apiKey = getOpenRouterApiKey();
			const submitted = await submitOpenRouterVideoJob(apiKey, adapted.body);
			const completed = await waitForOpenRouterVideoJob(apiKey, submitted, {
				intervalMs: 8_000,
				timeoutMs: 540_000,
			});
			const downloaded = await downloadOpenRouterVideo(apiKey, completed);
			const objectKey = await storeBytes({
				kind: "videos",
				bytes: downloaded.bytes,
				mimeType: downloaded.mimeType,
			});
			generatedObjectKey = objectKey;
			// Continuation mid-clips pause for browser-side FFmpeg frame extraction.
			// Next clip generation resumes only after the client uploads the frame.
			const awaitTerminalFrame =
				clip.clipIndex < job.clipCount - 1 && job.mode === "continuation";
			const warnings = [
				...adapted.warnings,
				...referenceWarnings,
			];
			await ctx.runMutation(internal.studio.internal.completeCompositionClip, {
				jobId: args.jobId,
				clipId: clip._id,
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
					videoParams: videoParamsSchema.parse({
						...job.videoParams,
						prompt: adapted.body.prompt,
					}),
					videoPrompt: adapted.body.prompt,
					warnings: warnings.length > 0 ? warnings : undefined,
					createdAt: Date.now(),
				},
				warnings: warnings.length > 0 ? warnings : undefined,
				awaitTerminalFrame,
			});
			generatedObjectKey = undefined;
		} catch (error) {
			if (generatedObjectKey) {
				await deleteR2Objects([generatedObjectKey]);
			}
			await ctx.runMutation(internal.studio.internal.failCompositionClip, {
				jobId: args.jobId,
				clipId: clip._id,
				message:
					error instanceof Error
						? error.message
						: "Composition clip generation failed.",
			});
		}
		return null;
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
	const videoBrief =
		(run.videoPrompt as string | undefined)?.trim() ||
		(run.videoParams?.prompt as string | undefined)?.trim();
	const modelLabel = isVideoModelId(run.selectedModelId ?? "")
		? MODEL_CAPABILITY_PROFILES[run.selectedModelId as VideoModelId].displayName
		: null;
	const provenanceLabel =
		run.provenance === "model-studio" ? "Model Run" : "Shloka Run";
	const fallback = modelLabel ?? provenanceLabel;

	const sceneIntents = (run.videoScenes ?? [])
		.map((scene) => scene.intent)
		.filter(Boolean)
		.slice(0, 4)
		.join(", ");
	const context = shloka
		? `Shloka: ${shloka.slice(0, 600)}`
		: videoBrief
			? `Video brief: ${videoBrief.slice(0, 600)}`
			: sceneIntents;
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
