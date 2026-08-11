"use node";

import { generateImage, generateText, Output } from "ai";
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
	getOpenAIProvider,
	getOpenRouterApiKey,
	getOpenRouterProvider,
} from "./lib/providers";
import {
	downloadOpenRouterVideo,
	fetchOpenRouterVideoModels,
	submitOpenRouterVideoJob,
	waitForOpenRouterVideoJob,
} from "./lib/openrouterVideo";
import {
	imageConfigSchema,
	plannerOutputSchema,
	videoParamsSchema,
	type ImageConfig,
} from "./lib/schemas";
import { resolvePlannerSystemPrompt } from "./lib/plannerPrompt";
import { adaptOpenRouterVideoRequest } from "./lib/videoAdapters";

function buildPlannerPrompt(
	shlokaText: string,
	customInstructions: string | undefined,
) {
	return [
		`Shloka (preserve meaning; do not replace with an invented translation unless asked):\n"""\n${shlokaText}\n"""`,
		customInstructions?.trim()
			? `Custom instructions (follow closely):\n"""\n${customInstructions.trim()}\n"""`
			: "Custom instructions: none. Default to warm Indian devotional atmosphere.",
		"Produce imagePrompt + videoScenes for a portrait 9:16 short rooted in this shloka.",
	].join("\n\n");
}

/** Appended at image gen time so Seedance/etc. do not treat refs as real-person photos. */
const IMAGE_STYLE_SAFETY_SUFFIX =
	"Stylized Indian miniature / temple-mural illustration, painted characters only, not a photograph of a real person, no photoreal skin, no celebrity likeness.";

function withImageStyleSafety(prompt: string) {
	const trimmed = prompt.trim();
	if (/not a (photo|photograph)|miniature painting|temple mural|stylized/i.test(trimmed)) {
		return trimmed;
	}
	return `${trimmed} ${IMAGE_STYLE_SAFETY_SUFFIX}`;
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

async function storeBytes(
	ctx: { storage: { store: (blob: Blob) => Promise<Id<"_storage">> } },
	bytes: Uint8Array,
	mimeType: string,
) {
	const normalized = Uint8Array.from(bytes);
	const blob = new Blob([normalized], { type: mimeType });
	return await ctx.storage.store(blob);
}

function newMediaId(prefix: string) {
	return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
				system: resolvePlannerSystemPrompt(run.plannerSystemPrompt),
				prompt: buildPlannerPrompt(run.shlokaText, run.customInstructions),
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

			await ctx.runMutation(internal.studioInternal.appendReferenceImage, {
				runId: args.runId,
				image: {
					id: newMediaId("img"),
					storageId,
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
			storageId: Id<"_storage">;
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

		const firstUrl = first
			? await ctx.storage.getUrl(first.storageId)
			: null;
		const lastUrl = last ? await ctx.storage.getUrl(last.storageId) : null;
		const referenceUrls = (
			await Promise.all(
				extras.map(async (image: RefImage) =>
					ctx.storage.getUrl(image.storageId),
				),
			)
		).filter((url: string | null): url is string => Boolean(url));

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
			const storageId = await storeBytes(
				ctx,
				downloaded.bytes,
				downloaded.mimeType,
			);

			await ctx.runMutation(internal.studioInternal.appendVideo, {
				runId: args.runId,
				video: {
					id: newMediaId("vid"),
					storageId,
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
