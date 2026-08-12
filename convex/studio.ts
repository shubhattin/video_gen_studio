import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import {
	MODEL_CAPABILITY_PROFILES,
	VIDEO_MODEL_IDS,
	type VideoModelId,
} from "./lib/modelCatalog";
import { normalizePlannerSystemPromptForStorage } from "./lib/plannerPrompt";
import { defaultImageConfig, defaultVideoParams } from "./lib/schemas";
import { compositionModeValidator, videoParamsValidator } from "./schema";

export const getRun = query({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		return await ctx.db.get(args.runId);
	},
});

export const getCompositionForRun = query({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		const job = await ctx.db
			.query("compositionJobs")
			.withIndex("by_runId", (q) => q.eq("runId", args.runId))
			.unique();
		if (!job) {
			return null;
		}
		const clips = await ctx.db
			.query("compositionClips")
			.withIndex("by_jobId_and_clipIndex", (q) => q.eq("jobId", job._id))
			.order("asc")
			.take(6);
		return {
			...job,
			clips,
		};
	},
});

export const listRecentRuns = query({
	args: {
		limit: v.optional(v.number()),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		const limit = Math.min(args.limit ?? 20, 50);
		return await ctx.db
			.query("generationRuns")
			.withIndex("by_createdAt")
			.order("desc")
			.take(limit);
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
		plannerSystemPrompt: v.optional(v.string()),
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
		const plannerSystemPrompt = normalizePlannerSystemPromptForStorage(
			args.plannerSystemPrompt,
		);
		return await ctx.db.insert("generationRuns", {
			provenance: "shloka",
			status: "draft",
			revisionNumber: 1,
			shlokaText,
			customInstructions: args.customInstructions?.trim() || undefined,
			...(plannerSystemPrompt ? { plannerSystemPrompt } : {}),
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
		plannerSystemPrompt: v.optional(v.union(v.string(), v.null())),
		imageSize: v.optional(v.string()),
		imageQuality: v.optional(v.string()),
		selectedModelId: v.optional(v.string()),
		videoParams: v.optional(videoParamsValidator),
		videoPrompt: v.optional(v.string()),
		compositionMode: v.optional(v.union(compositionModeValidator, v.null())),
		compositionMultiplier: v.optional(v.union(v.number(), v.null())),
		compositionClipCount: v.optional(v.union(v.number(), v.null())),
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
		const compositionJob = await ctx.db
			.query("compositionJobs")
			.withIndex("by_runId", (q) => q.eq("runId", args.runId))
			.unique();
		const compositionHasVideo = compositionJob
			? Boolean(
					(
						await ctx.db
							.query("compositionClips")
							.withIndex("by_jobId_and_clipIndex", (q) =>
								q.eq("jobId", compositionJob._id),
							)
							.take(6)
					).some((clip) => clip.video),
				)
			: false;
		const requestedModelId = args.selectedModelId ?? args.videoParams?.modelId;
		const currentModelId = run.selectedModelId ?? run.videoParams?.modelId;
		if (
			(run.videos?.length || compositionHasVideo) &&
			requestedModelId &&
			currentModelId &&
			requestedModelId !== currentModelId
		) {
			throw new Error(
				"The video model is fixed after generation begins for this run.",
			);
		}
		const plannerSystemPrompt =
			args.plannerSystemPrompt === undefined
				? run.plannerSystemPrompt
				: normalizePlannerSystemPromptForStorage(args.plannerSystemPrompt);
		const compositionMultiplier =
			args.compositionMultiplier === null
				? undefined
				: (args.compositionMultiplier ?? run.compositionMultiplier);
		const compositionClipCount =
			args.compositionClipCount === null
				? undefined
				: (args.compositionClipCount ?? run.compositionClipCount);
		if (
			compositionMultiplier !== undefined &&
			(!Number.isInteger(compositionMultiplier) ||
				compositionMultiplier < 2 ||
				compositionMultiplier > 6)
		) {
			throw new Error("Composition multiplier must be between 2× and 6×.");
		}
		if (
			compositionClipCount !== undefined &&
			(!Number.isInteger(compositionClipCount) ||
				compositionClipCount < 2 ||
				compositionClipCount > 6)
		) {
			throw new Error("Composition clip count must be between 2 and 6.");
		}
		await ctx.db.patch(args.runId, {
			customInstructions:
				args.customInstructions !== undefined
					? args.customInstructions.trim() || undefined
					: run.customInstructions,
			plannerSystemPrompt,
			imageSize: args.imageSize ?? run.imageSize,
			imageQuality: args.imageQuality ?? run.imageQuality,
			selectedModelId: args.selectedModelId ?? run.selectedModelId,
			videoParams: args.videoParams ?? run.videoParams,
			videoPrompt:
				args.videoPrompt !== undefined
					? args.videoPrompt.trim() || undefined
					: run.videoPrompt,
			compositionMode:
				args.compositionMode === null
					? undefined
					: (args.compositionMode ?? run.compositionMode),
			compositionMultiplier,
			compositionClipCount,
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

export const startComposition = mutation({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const job = await ctx.db
			.query("compositionJobs")
			.withIndex("by_runId", (q) => q.eq("runId", args.runId))
			.unique();
		if (!job) {
			throw new Error(
				"Generate a multi-clip plan before starting the composition.",
			);
		}
		if (job.status === "completed" || job.status === "cancelled") {
			throw new Error("This composition cannot be started.");
		}
		if (job.status === "failed") {
			await ctx.runMutation(internal.studioInternal.resetFailedCompositionJob, {
				jobId: job._id,
			});
		}
		await ctx.scheduler.runAfter(
			0,
			internal.studioActions.generateNextCompositionClip,
			{ jobId: job._id },
		);
		return null;
	},
});

export const cancelComposition = mutation({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const job = await ctx.db
			.query("compositionJobs")
			.withIndex("by_runId", (q) => q.eq("runId", args.runId))
			.unique();
		if (!job || job.status === "completed") {
			return null;
		}
		await ctx.db.patch(job._id, {
			status: "cancelled",
			currentClipIndex: undefined,
			updatedAt: Date.now(),
		});
		await ctx.db.patch(args.runId, {
			status: "plan_ready",
			lastError: undefined,
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
		const keysToDelete: string[] = [];
		const compositionJob = await ctx.db
			.query("compositionJobs")
			.withIndex("by_runId", (q) => q.eq("runId", args.runId))
			.unique();
		if (compositionJob) {
			const compositionClips = await ctx.db
				.query("compositionClips")
				.withIndex("by_jobId_and_clipIndex", (q) =>
					q.eq("jobId", compositionJob._id),
				)
				.take(6);
			for (const clip of compositionClips) {
				if (clip.video) {
					keysToDelete.push(clip.video.objectKey);
				}
				if (clip.terminalFrameObjectKey) {
					keysToDelete.push(clip.terminalFrameObjectKey);
				}
				await ctx.db.delete(clip._id);
			}
			await ctx.db.delete(compositionJob._id);
		}
		for (const image of run.referenceImages ?? []) {
			keysToDelete.push(image.objectKey);
		}
		for (const video of run.videos ?? []) {
			keysToDelete.push(video.objectKey);
		}
		await ctx.db.delete(args.runId);
		if (keysToDelete.length > 0) {
			await ctx.scheduler.runAfter(0, internal.studioR2.deleteObjects, {
				objectKeys: keysToDelete,
			});
		}
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
		const referenceImages = (run.referenceImages ?? []).filter(
			(image) => image.id !== args.imageId,
		);
		await ctx.db.patch(args.runId, {
			referenceImages,
			firstFrameImageId:
				run.firstFrameImageId === args.imageId
					? undefined
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
		await ctx.scheduler.runAfter(0, internal.studioR2.deleteObjects, {
			objectKeys: [target.objectKey],
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
