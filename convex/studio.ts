import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	MODEL_CAPABILITY_PROFILES,
	VIDEO_MODEL_IDS,
	type VideoModelId,
} from "./lib/modelCatalog";
import { defaultImageConfig, defaultVideoParams } from "./lib/schemas";
import { videoParamsValidator } from "./schema";

async function resolveRunUrls(
	ctx: { storage: { getUrl: (id: Id<"_storage">) => Promise<string | null> } },
	run: {
		referenceImages?: Array<{
			id: string;
			storageId: Id<"_storage">;
			meta: {
				mimeType: string;
				width?: number;
				height?: number;
				durationSeconds?: number;
				bytes?: number;
			};
			revisedImagePrompt?: string;
			createdAt: number;
		}>;
		videos?: Array<{
			id: string;
			storageId: Id<"_storage">;
			meta: {
				mimeType: string;
				width?: number;
				height?: number;
				durationSeconds?: number;
				bytes?: number;
			};
			openRouterJobId: string;
			openRouterGenerationId?: string;
			actualCostUsd?: number;
			videoParams: {
				modelId: string;
				aspectRatio: string;
				resolution: string;
				durationSeconds: number;
				generateAudio?: boolean;
				negativePrompt?: string;
				cfgScale?: number;
				prompt?: string;
			};
			videoPrompt?: string;
			warnings?: string[];
			createdAt: number;
		}>;
	},
) {
	const referenceImages = await Promise.all(
		(run.referenceImages ?? []).map(async (image) => ({
			...image,
			url: await ctx.storage.getUrl(image.storageId),
		})),
	);
	const videos = await Promise.all(
		(run.videos ?? []).map(async (video) => ({
			...video,
			url: await ctx.storage.getUrl(video.storageId),
		})),
	);
	return { referenceImages, videos };
}

export const getRun = query({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return null;
		}
		const media = await resolveRunUrls(ctx, run);
		return { ...run, ...media };
	},
});

export const listRecentRuns = query({
	args: {
		limit: v.optional(v.number()),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		const limit = Math.min(args.limit ?? 20, 50);
		const runs = await ctx.db
			.query("generationRuns")
			.withIndex("by_createdAt")
			.order("desc")
			.take(limit);
		return await Promise.all(
			runs.map(async (run) => {
				const media = await resolveRunUrls(ctx, run);
				return { ...run, ...media };
			}),
		);
	},
});

export const getStaticModelCatalog = query({
	args: {},
	returns: v.any(),
	handler: async () => {
		return {
			modelIds: VIDEO_MODEL_IDS,
			profiles: MODEL_CAPABILITY_PROFILES,
		};
	},
});

export const getCachedOpenRouterCatalog = query({
	args: {},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx) => {
		const cached = await ctx.db.query("catalogCache").first();
		if (!cached) {
			return null;
		}
		try {
			return {
				fetchedAt: cached.fetchedAt,
				models: JSON.parse(cached.payload),
			};
		} catch {
			return null;
		}
	},
});

export const createShlokaDraft = mutation({
	args: {
		shlokaText: v.string(),
		customInstructions: v.optional(v.string()),
	},
	returns: v.id("generationRuns"),
	handler: async (ctx, args) => {
		const shlokaText = args.shlokaText.trim();
		if (!shlokaText) {
			throw new Error("Shloka text is required.");
		}
		const now = Date.now();
		const imageConfig = defaultImageConfig();
		const defaultModel: VideoModelId = "google/veo-3.1-lite";
		return await ctx.db.insert("generationRuns", {
			provenance: "shloka",
			status: "draft",
			revisionNumber: 1,
			shlokaText,
			customInstructions: args.customInstructions?.trim() || undefined,
			selectedModelId: defaultModel,
			imageSize: imageConfig.size,
			imageQuality: imageConfig.quality,
			videoParams: defaultVideoParams(defaultModel),
			referenceImages: [],
			extraReferenceImageIds: [],
			videos: [],
			createdAt: now,
			updatedAt: now,
		});
	},
});

export const createModelStudioDraft = mutation({
	args: {
		modelId: v.string(),
		prompt: v.optional(v.string()),
	},
	returns: v.id("generationRuns"),
	handler: async (ctx, args) => {
		if (!(VIDEO_MODEL_IDS as readonly string[]).includes(args.modelId)) {
			throw new Error("Unsupported model.");
		}
		const modelId = args.modelId as VideoModelId;
		const now = Date.now();
		return await ctx.db.insert("generationRuns", {
			provenance: "model-studio",
			status: "draft",
			revisionNumber: 1,
			selectedModelId: modelId,
			videoParams: {
				...defaultVideoParams(modelId),
				prompt: args.prompt?.trim() || undefined,
			},
			videoPrompt: args.prompt?.trim() || undefined,
			referenceImages: [],
			extraReferenceImageIds: [],
			videos: [],
			createdAt: now,
			updatedAt: now,
		});
	},
});

export const updateDraft = mutation({
	args: {
		runId: v.id("generationRuns"),
		customInstructions: v.optional(v.string()),
		imageSize: v.optional(v.string()),
		imageQuality: v.optional(v.string()),
		selectedModelId: v.optional(v.string()),
		videoParams: v.optional(videoParamsValidator),
		videoPrompt: v.optional(v.string()),
		firstFrameImageId: v.optional(v.union(v.string(), v.null())),
		lastFrameImageId: v.optional(v.union(v.string(), v.null())),
		extraReferenceImageIds: v.optional(v.array(v.string())),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		if (run.status === "video_generating" || run.status === "planning") {
			throw new Error("Run is busy. Wait for the current stage to finish.");
		}
		await ctx.db.patch(args.runId, {
			customInstructions:
				args.customInstructions !== undefined
					? args.customInstructions.trim() || undefined
					: run.customInstructions,
			imageSize: args.imageSize ?? run.imageSize,
			imageQuality: args.imageQuality ?? run.imageQuality,
			selectedModelId: args.selectedModelId ?? run.selectedModelId,
			videoParams: args.videoParams ?? run.videoParams,
			videoPrompt:
				args.videoPrompt !== undefined
					? args.videoPrompt.trim() || undefined
					: run.videoPrompt,
			firstFrameImageId:
				args.firstFrameImageId === null
					? undefined
					: (args.firstFrameImageId ?? run.firstFrameImageId),
			lastFrameImageId:
				args.lastFrameImageId === null
					? undefined
					: (args.lastFrameImageId ?? run.lastFrameImageId),
			extraReferenceImageIds:
				args.extraReferenceImageIds ?? run.extraReferenceImageIds,
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const deleteRun = mutation({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return null;
		}
		for (const image of run.referenceImages ?? []) {
			await ctx.storage.delete(image.storageId);
		}
		for (const video of run.videos ?? []) {
			await ctx.storage.delete(video.storageId);
		}
		await ctx.db.delete(args.runId);
		return null;
	},
});

export const removeReferenceImage = mutation({
	args: {
		runId: v.id("generationRuns"),
		imageId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		const target = (run.referenceImages ?? []).find(
			(image) => image.id === args.imageId,
		);
		if (!target) {
			return null;
		}
		await ctx.storage.delete(target.storageId);
		const referenceImages = (run.referenceImages ?? []).filter(
			(image) => image.id !== args.imageId,
		);
		await ctx.db.patch(args.runId, {
			referenceImages,
			firstFrameImageId:
				run.firstFrameImageId === args.imageId
					? referenceImages[0]?.id
					: run.firstFrameImageId,
			lastFrameImageId:
				run.lastFrameImageId === args.imageId
					? undefined
					: run.lastFrameImageId,
			extraReferenceImageIds: (run.extraReferenceImageIds ?? []).filter(
				(id) => id !== args.imageId,
			),
			status: referenceImages.length > 0 ? run.status : "plan_ready",
			updatedAt: Date.now(),
		});
		return null;
	},
});

/** One-time cleanup: deletes all runs, media files, and catalog cache. */
export const wipeAllStudioData = mutation({
	args: {},
	returns: v.object({
		runsDeleted: v.number(),
		filesDeleted: v.number(),
		cachesDeleted: v.number(),
	}),
	handler: async (ctx): Promise<{
		runsDeleted: number;
		filesDeleted: number;
		cachesDeleted: number;
	}> => {
		return await ctx.runMutation(internal.studioInternal.wipeAllStudioData, {});
	},
});
