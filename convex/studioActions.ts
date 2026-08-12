"use node";

import { generateImage, generateText, Output } from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
	MODEL_CAPABILITY_PROFILES,
	PLANNER_MODEL_ID,
	VIDEO_MODEL_IDS,
	type VideoModelId,
	isVideoModelId,
} from "./lib/modelCatalog";
import {
	getOpenAIProvider,
	getOpenRouterApiKey,
	getOpenRouterProvider,
	getVideoProcessorSecret,
	getVideoProcessorUrl,
	isVideoProcessorConfigured,
} from "./lib/providers";
import {
	downloadOpenRouterVideo,
	fetchOpenRouterVideoModels,
	submitOpenRouterVideoJob,
	waitForOpenRouterVideoJob,
} from "./lib/openrouterVideo";
import {
	imageConfigSchema,
	compositionPlannerOutputSchema,
	normalPlannerOutputSchema,
	videoParamsSchema,
	type ImageConfig,
} from "./lib/schemas";
import {
	MODEL_STUDIO_PLANNER_SYSTEM_PROMPT,
	buildShlokaPlannerSystemPrompt,
	multiClipPlannerInstructions,
} from "./lib/plannerPrompt";
import { adaptOpenRouterVideoRequest } from "./lib/videoAdapters";
import {
	buildStudioObjectKey,
	createPresignedGetUrl,
	deleteObjects as deleteR2Objects,
	putObjectBytes,
} from "./lib/r2";

function buildPlannerPrompt(
	shlokaText: string,
	customInstructions: string | undefined,
	mode: "single-clip" | "multi-clip",
) {
	const outputHint =
		mode === "multi-clip"
			? "Produce imagePrompt + overallDescription + ordered clips for a portrait 9:16 multi-clip short rooted in this shloka."
			: "Produce imagePrompt + videoScenes for a portrait 9:16 short rooted in this shloka.";
	return [
		`Shloka (preserve meaning; do not replace with an invented translation unless asked):\n"""\n${shlokaText}\n"""`,
		customInstructions?.trim()
			? `Custom instructions (follow closely):\n"""\n${customInstructions.trim()}\n"""`
			: "Custom instructions: none. Default to warm Indian devotional atmosphere.",
		outputHint,
	].join("\n\n");
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

function buildVideoPromptFromScenes(
	scenes: Array<{ intent: string; actionMotion: string; composition: string }>,
) {
	// Keep compact — Kling and similar providers reject very long prompts.
	const compact = scenes
		.slice(0, 6)
		.map(
			(scene, index) =>
				`${index + 1}. ${scene.intent}: ${scene.actionMotion}`,
		)
		.join(" | ");
	return `${compact} | stylized illustrated characters, not photoreal people`;
}

function warningMessages(
	warnings: Array<{ message?: string; feature?: string; details?: string }>,
) {
	return warnings
		.map((warning) => warning.message ?? warning.details ?? warning.feature)
		.filter((value): value is string => Boolean(value));
}

async function storeBytes(args: {
	runId: string;
	kind: "refs" | "videos" | "frames";
	bytes: Uint8Array;
	mimeType: string;
	mediaId?: string;
}) {
	const objectKey = buildStudioObjectKey({
		runId: args.runId,
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

function newMediaId(prefix: string) {
	return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function signedReadUrl(objectKey: string) {
	return await createPresignedGetUrl({ objectKey });
}

async function extractTerminalFrame(args: {
	runId: string;
	videoObjectKey: string;
}) {
	const sourceUrl = await signedReadUrl(args.videoObjectKey);
	const response = await fetch(
		`${getVideoProcessorUrl()}/api/extract-terminal-frame`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-video-processor-secret": getVideoProcessorSecret(),
			},
			body: JSON.stringify({ sourceUrl }),
			signal: AbortSignal.timeout(90_000),
		},
	);
	if (!response.ok) {
		throw new Error(`Terminal-frame extraction failed (${response.status}).`);
	}
	const mimeType = response.headers.get("content-type") ?? "image/jpeg";
	return await storeBytes({
		runId: args.runId,
		kind: "frames",
		bytes: new Uint8Array(await response.arrayBuffer()),
		mimeType,
	});
}

export const planShlokaRun = action({
	args: {
		runId: v.id("generationRuns"),
		force: v.optional(v.boolean()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.runQuery(internal.studioQueries.getRunDoc, {
			runId: args.runId,
		});
		if (!run) {
			throw new Error("Run not found.");
		}
		if (!run.shlokaText?.trim()) {
			throw new Error("Shloka text is required before planning.");
		}

		const planningKey = `plan-${args.runId}-${run.revisionNumber}`;
		if (
			!args.force &&
			run.planningKey === planningKey &&
			run.status === "plan_ready" &&
			run.imagePrompt &&
			run.videoScenes
		) {
			return null;
		}

		await ctx.runMutation(internal.studioInternal.setRunStatus, {
			runId: args.runId,
			status: "planning",
		});

		try {
			const openrouter = getOpenRouterProvider();
			const composition = compositionPlannerExtension(run);
			if (composition) {
				const result = await generateText({
					model: openrouter(PLANNER_MODEL_ID),
					reasoning: "medium",
					system: buildShlokaPlannerSystemPrompt({
						stored: run.plannerSystemPrompt,
						composition,
					}),
					prompt: buildPlannerPrompt(
						run.shlokaText,
						run.customInstructions,
						"multi-clip",
					),
					output: Output.object({ schema: compositionPlannerOutputSchema }),
				});
				const plan = result.output;
				const warnings = warningMessages(result.warnings ?? []);
				await ctx.runMutation(internal.studioInternal.commitCompositionPlan, {
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
					system: buildShlokaPlannerSystemPrompt({
						stored: run.plannerSystemPrompt,
						composition: null,
					}),
					prompt: buildPlannerPrompt(
						run.shlokaText,
						run.customInstructions,
						"single-clip",
					),
					output: Output.object({ schema: normalPlannerOutputSchema }),
				});
				const plan = result.output;
				const warnings = warningMessages(result.warnings ?? []);
				await ctx.runMutation(internal.studioInternal.commitPlan, {
					runId: args.runId,
					plannerModel: PLANNER_MODEL_ID,
					plannerReasoning: "medium",
					imagePrompt: plan.imagePrompt,
					videoScenes: plan.videoScenes,
					warnings: warnings.length > 0 ? warnings : undefined,
					planningKey,
				});
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Planning failed.";
			await ctx.runMutation(internal.studioInternal.setRunStatus, {
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
		const run = await ctx.runQuery(internal.studioQueries.getRunDoc, {
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
		const planningKey = `model-composition-plan-${args.runId}-${run.revisionNumber}`;
		if (
			!args.force &&
			run.planningKey === planningKey &&
			run.status === "plan_ready"
		) {
			return null;
		}
		await ctx.runMutation(internal.studioInternal.setRunStatus, {
			runId: args.runId,
			status: "planning",
		});
		try {
			const result = await generateText({
				model: getOpenRouterProvider()(PLANNER_MODEL_ID),
				reasoning: "medium",
				system: `${MODEL_STUDIO_PLANNER_SYSTEM_PROMPT}\n\n${multiClipPlannerInstructions(composition)}`,
				prompt: buildModelStudioPlannerPrompt(prompt),
				output: Output.object({ schema: compositionPlannerOutputSchema }),
			});
			const plan = result.output;
			await ctx.runMutation(internal.studioInternal.commitCompositionPlan, {
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
			await ctx.runMutation(internal.studioInternal.setRunStatus, {
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
		const run = await ctx.runQuery(internal.studioQueries.getRunDoc, {
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
			quality: run.imageQuality ?? "low",
		});

		await ctx.runMutation(internal.studioInternal.setRunStatus, {
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
				runId: args.runId,
				kind: "refs",
				bytes: image.uint8Array,
				mimeType: image.mediaType,
			});
			const [width, height] = imageConfig.size.split("x").map(Number);
			const warnings = warningMessages(result.warnings ?? []);
			const openaiMeta = result.providerMetadata?.openai as
				| { revisedPrompt?: string }
				| undefined;

			await ctx.runMutation(internal.studioInternal.appendReferenceImage, {
				runId: args.runId,
				image: {
					id: newMediaId("img"),
					objectKey,
					meta: {
						mimeType: image.mediaType,
						width,
						height,
						bytes: image.uint8Array.byteLength,
					},
					source: "generated",
					revisedImagePrompt: openaiMeta?.revisedPrompt,
					createdAt: Date.now(),
				},
				setAsFirstFrame: false,
				warnings: warnings.length > 0 ? warnings : undefined,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Image generation failed.";
			await ctx.runMutation(internal.studioInternal.setRunStatus, {
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
		const run = await ctx.runQuery(internal.studioQueries.getRunDoc, {
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
		const extraIds = new Set((run.extraReferenceImageIds ?? []) as string[]);
		const extras = images.filter(
			(image: RefImage) =>
				extraIds.has(image.id) &&
				image.id !== first?.id &&
				image.id !== last?.id,
		);

		if (profile.requiresFirstFrame && !first) {
			throw new Error("This model requires a first-frame reference image.");
		}

		const parsedParams = videoParamsSchema.parse({
			...run.videoParams,
			modelId,
		});

		const fallbackPrompt =
			run.videoPrompt?.trim() ||
			(run.videoScenes
				? buildVideoPromptFromScenes(run.videoScenes)
				: run.imagePrompt) ||
			"Warm Indian cinematic motion portrait.";

		const firstUrl = first ? await signedReadUrl(first.objectKey) : null;
		const lastUrl = last ? await signedReadUrl(last.objectKey) : null;
		const referenceUrls = await Promise.all(
			extras.map(async (image: RefImage) => signedReadUrl(image.objectKey)),
		);

		const adapted = adaptOpenRouterVideoRequest({
			params: parsedParams,
			fallbackPrompt,
			firstFrameUrl: firstUrl,
			lastFrameUrl: lastUrl,
			referenceUrls,
		});

		await ctx.runMutation(internal.studioInternal.updateVideoConfig, {
			runId: args.runId,
			selectedModelId: modelId,
			videoParams: parsedParams,
			videoPrompt: adapted.body.prompt,
		});

		await ctx.runMutation(internal.studioInternal.setRunStatus, {
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
				runId: args.runId,
				kind: "videos",
				bytes: downloaded.bytes,
				mimeType: downloaded.mimeType,
			});

			await ctx.runMutation(internal.studioInternal.appendVideo, {
				runId: args.runId,
				video: {
					id: newMediaId("vid"),
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
				warnings: adapted.warnings.length > 0 ? adapted.warnings : undefined,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Video generation failed.";
			await ctx.runMutation(internal.studioInternal.setRunStatus, {
				runId: args.runId,
				status: "failed",
				lastError: message,
			});
			throw error;
		}

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
			internal.studioInternal.claimNextCompositionClip,
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
		let extractedTerminalFrameObjectKey: string | undefined;
		try {
			if (!isVideoModelId(job.videoParams.modelId)) {
				throw new Error("Composition uses an unsupported video model.");
			}
			const run = await ctx.runQuery(internal.studioQueries.getRunDoc, {
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
				runId: job.runId,
				kind: "videos",
				bytes: downloaded.bytes,
				mimeType: downloaded.mimeType,
			});
			generatedObjectKey = objectKey;
			let terminalFrameObjectKey: string | undefined;
			let awaitTerminalFrame = false;
			if (clip.clipIndex < job.clipCount - 1 && job.mode === "continuation") {
				if (isVideoProcessorConfigured()) {
					try {
						terminalFrameObjectKey = await extractTerminalFrame({
							runId: job.runId,
							videoObjectKey: objectKey,
						});
						extractedTerminalFrameObjectKey = terminalFrameObjectKey;
					} catch (error) {
						referenceWarnings.push(
							error instanceof Error
								? `${error.message} Extracting the continuity frame in the browser instead.`
								: "Server terminal-frame extraction failed. Extracting in the browser instead.",
						);
						awaitTerminalFrame = true;
					}
				} else {
					awaitTerminalFrame = true;
				}
			}
			const warnings = [
				...adapted.warnings,
				...referenceWarnings,
			];
			await ctx.runMutation(internal.studioInternal.completeCompositionClip, {
				jobId: args.jobId,
				clipId: clip._id,
				video: {
					id: newMediaId("composition_vid"),
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
				terminalFrameObjectKey,
				warnings: warnings.length > 0 ? warnings : undefined,
				awaitTerminalFrame,
			});
			generatedObjectKey = undefined;
			extractedTerminalFrameObjectKey = undefined;
		} catch (error) {
			const keys = [
				generatedObjectKey,
				extractedTerminalFrameObjectKey,
			].filter((key): key is string => Boolean(key));
			if (keys.length > 0) {
				await deleteR2Objects(keys);
			}
			await ctx.runMutation(internal.studioInternal.failCompositionClip, {
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
		const apiKey = getOpenRouterApiKey();
		const models = await fetchOpenRouterVideoModels(apiKey);
		const allowed = new Set(VIDEO_MODEL_IDS);
		const filtered = (models as Array<{ id: string }>).filter((model) =>
			allowed.has(model.id as VideoModelId),
		);

		const payload = JSON.stringify(filtered);
		const fetchedAt = Date.now();
		await ctx.runMutation(internal.studioInternal.setCatalogCache, {
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
