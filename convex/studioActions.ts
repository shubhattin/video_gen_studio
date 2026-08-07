"use node";

import { generateText, generateImage, experimental_generateVideo, Output } from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
	MODEL_CAPABILITY_PROFILES,
	PLANNER_MODEL_ID,
	VIDEO_MODEL_IDS,
	type VideoModelId,
	isVideoModelId,
} from "./lib/modelCatalog";
import {
	getGatewayProvider,
	getOpenAIProvider,
	getOpenRouterProvider,
	validateGatewayCredentials,
} from "./lib/providers";
import {
	imageConfigSchema,
	plannerOutputSchema,
	videoParamsSchema,
	type ImageConfig,
} from "./lib/schemas";
import { adaptVideoRequest } from "./lib/videoAdapters";

const PLANNER_SYSTEM = `You are a creative director for devotional short-form video (9:16 portrait).
Produce structured plans for AI image and video generation from a supplied Sanskrit/Hindi shloka.

Rules:
- Preserve the supplied shloka verbatim in your reasoning; never fabricate religious claims or scripture.
- Use the custom instructions for mood, symbolism, pacing, and visual constraints.
- imagePrompt must describe a single portrait-friendly reference still (no text overlays, no logos).
- videoScenes must be cinematic beats suitable for a short reel; each scene is one structured shot plan.
- Keep content respectful; avoid sensational or inaccurate religious depictions.`;

function buildPlannerPrompt(
	shlokaText: string,
	customInstructions: string | undefined,
) {
	return [
		`Shloka (preserve meaning, do not rewrite as translation unless asked):\n${shlokaText}`,
		customInstructions
			? `Custom instructions:\n${customInstructions}`
			: "Custom instructions: none provided.",
		"Return imagePrompt plus videoScenes for a portrait 9:16 devotional short.",
	].join("\n\n");
}

function buildVideoPromptFromScenes(
	scenes: Array<{ intent: string; actionMotion: string; composition: string }>,
) {
	return scenes
		.map(
			(scene, index) =>
				`Scene ${index + 1}: ${scene.intent}. ${scene.composition}. Motion: ${scene.actionMotion}.`,
		)
		.join("\n");
}

function warningMessages(
	warnings: Array<{ message?: string; feature?: string; details?: string }>,
) {
	return warnings
		.map((warning) => warning.message ?? warning.details ?? warning.feature)
		.filter((value): value is string => Boolean(value));
}

async function storeBytes(
	ctx: { storage: { store: (blob: Blob) => Promise<Id<"_storage">> } },
	bytes: Uint8Array,
	mimeType: string,
) {
	const normalized = Uint8Array.from(bytes);
	const blob = new Blob([normalized], { type: mimeType });
	return await ctx.storage.store(blob);
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
			const result = await generateText({
				model: openrouter(PLANNER_MODEL_ID),
				reasoning: "medium",
				system: PLANNER_SYSTEM,
				prompt: buildPlannerPrompt(
					run.shlokaText,
					run.customInstructions,
				),
				output: Output.object({ schema: plannerOutputSchema }),
			});

			const plan = result.output;
			const warnings = warningMessages(result.warnings ?? []);

			await ctx.runMutation(internal.studioInternal.commitPlan, {
				runId: args.runId,
				plannerModel: PLANNER_MODEL_ID,
				plannerReasoning: "medium",
				imagePrompt: plan.imagePrompt,
				videoScenes: plan.videoScenes,
				openRouterGenerationId: result.response?.id,
				warnings: warnings.length > 0 ? warnings : undefined,
				planningKey,
			});
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

export const generateReferenceImage = action({
	args: {
		runId: v.id("generationRuns"),
		force: v.optional(v.boolean()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.runQuery(internal.studioQueries.getRunDoc, {
			runId: args.runId,
		});
		if (!run?.imagePrompt) {
			throw new Error("Plan an image prompt before generating a reference image.");
		}

		const imageKey = `image-${args.runId}-${run.revisionNumber}`;
		if (
			!args.force &&
			run.imageKey === imageKey &&
			run.referenceImageStorageId &&
			run.status === "image_ready"
		) {
			return null;
		}

		const imageConfig = imageConfigSchema.parse({
			size: run.imageSize ?? "1024x1536",
			quality: run.imageQuality ?? "medium",
		});

		await ctx.runMutation(internal.studioInternal.setRunStatus, {
			runId: args.runId,
			status: "image_generating",
		});

		try {
			const openai = getOpenAIProvider();
			const result = await generateImage({
				model: openai.image("gpt-image-2"),
				prompt: run.imagePrompt,
				size: imageConfig.size as ImageConfig["size"],
				providerOptions: {
					openai: {
						quality: imageConfig.quality,
					},
				},
			});

			const image = result.image;
			const storageId = await storeBytes(
				ctx,
				image.uint8Array,
				image.mediaType,
			);

			const [width, height] = imageConfig.size.split("x").map(Number);
			const warnings = warningMessages(result.warnings ?? []);

			const openaiMeta = result.providerMetadata?.openai as
				| { revisedPrompt?: string }
				| undefined;

			await ctx.runMutation(internal.studioInternal.commitReferenceImage, {
				runId: args.runId,
				storageId,
				meta: {
					mimeType: image.mediaType,
					width,
					height,
					bytes: image.uint8Array.byteLength,
				},
				revisedImagePrompt: openaiMeta?.revisedPrompt,
				imageKey,
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

		const modelId = run.selectedModelId ?? run.videoParams?.modelId;
		if (!modelId || !isVideoModelId(modelId)) {
			throw new Error("Select a supported video model.");
		}

		const profile = MODEL_CAPABILITY_PROFILES[modelId];
		if (profile.requiresFirstFrame && !run.referenceImageStorageId) {
			throw new Error("This model requires a reference image.");
		}

		const videoKey = `video-${args.runId}-${run.revisionNumber}`;
		if (
			!args.force &&
			run.videoKey === videoKey &&
			run.videoStorageId &&
			run.status === "completed"
		) {
			return null;
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
			"Devotional cinematic motion portrait.";

		const adapted = adaptVideoRequest(parsedParams, fallbackPrompt);

		await ctx.runMutation(internal.studioInternal.updateVideoConfig, {
			runId: args.runId,
			selectedModelId: modelId,
			videoParams: parsedParams,
			videoPrompt: adapted.prompt,
		});

		await ctx.runMutation(internal.studioInternal.setRunStatus, {
			runId: args.runId,
			status: "video_generating",
		});

		try {
			const gateway = getGatewayProvider();
			let frameImages:
				| Array<{ image: string; frameType: "first_frame" }>
				| undefined;

			if (run.referenceImageStorageId) {
				const imageUrl = await ctx.storage.getUrl(run.referenceImageStorageId);
				if (!imageUrl) {
					throw new Error("Reference image is no longer available.");
				}
				frameImages = [{ image: imageUrl, frameType: "first_frame" }];
			}

			const result = await experimental_generateVideo({
				model: gateway.video(modelId),
				prompt: adapted.prompt,
				aspectRatio: adapted.aspectRatio,
				resolution: adapted.resolution,
				duration: adapted.duration,
				fps: adapted.fps,
				generateAudio: adapted.generateAudio,
				frameImages,
				providerOptions: adapted.providerOptions,
				headers: {
					"idempotency-key": videoKey,
				},
				poll: {
					intervalMs: 5000,
					timeoutMs: 600000,
				},
			});

			const video = result.video;
			const storageId = await storeBytes(
				ctx,
				video.uint8Array,
				video.mediaType,
			);

			const warnings = warningMessages(result.warnings ?? []);
			const gatewayGenerationId =
				(result.providerMetadata?.gateway as { generationId?: string } | undefined)
					?.generationId;

			await ctx.runMutation(internal.studioInternal.commitVideo, {
				runId: args.runId,
				storageId,
				meta: {
					mimeType: video.mediaType,
					durationSeconds: adapted.duration,
					bytes: video.uint8Array.byteLength,
				},
				gatewayGenerationId,
				videoKey,
				warnings: warnings.length > 0 ? warnings : undefined,
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

export const refreshModelCatalog = action({
	args: {},
	returns: v.any(),
	handler: async (ctx) => {
		const auth = await validateGatewayCredentials();
		const gateway = getGatewayProvider();
		const { models } = await gateway.getAvailableModels();
		const allowed = new Set(VIDEO_MODEL_IDS);
		const filtered = models.filter(
			(model) => allowed.has(model.id as VideoModelId) || model.modelType === "video",
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
			gatewayAuth: auth,
			note:
				auth.ok
					? "Gateway catalog loaded and API key verified."
					: "Catalog is public, but your AI Gateway API key failed authentication. Video and paid inference will not work until you create a valid key at Vercel AI Gateway API Keys and update Convex env.",
		};
	},
});
