import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
	generatedVideoValidator,
	referenceImageValidator,
	runStatusValidator,
	videoParamsValidator,
	videoSceneValidator,
} from "./schema";

export const setRunStatus = internalMutation({
	args: {
		runId: v.id("generationRuns"),
		status: runStatusValidator,
		lastError: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		await ctx.db.patch(args.runId, {
			status: args.status,
			lastError: args.lastError,
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const commitPlan = internalMutation({
	args: {
		runId: v.id("generationRuns"),
		plannerModel: v.string(),
		plannerReasoning: v.string(),
		imagePrompt: v.string(),
		videoScenes: v.array(videoSceneValidator),
		warnings: v.optional(v.array(v.string())),
		planningKey: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.runId, {
			status: "plan_ready",
			plannerModel: args.plannerModel,
			plannerReasoning: args.plannerReasoning,
			imagePrompt: args.imagePrompt,
			videoScenes: args.videoScenes,
			warnings: args.warnings,
			planningKey: args.planningKey,
			planningCompletedAt: Date.now(),
			lastError: undefined,
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const appendReferenceImage = internalMutation({
	args: {
		runId: v.id("generationRuns"),
		image: referenceImageValidator,
		setAsFirstFrame: v.optional(v.boolean()),
		warnings: v.optional(v.array(v.string())),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		const referenceImages = [...(run.referenceImages ?? []), args.image];
		await ctx.db.patch(args.runId, {
			status: "image_ready",
			referenceImages,
			firstFrameImageId: args.setAsFirstFrame
				? args.image.id
				: run.firstFrameImageId,
			imageCompletedAt: Date.now(),
			warnings: args.warnings,
			lastError: undefined,
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const appendVideo = internalMutation({
	args: {
		runId: v.id("generationRuns"),
		video: generatedVideoValidator,
		warnings: v.optional(v.array(v.string())),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		const videos = [...(run.videos ?? []), args.video];
		await ctx.db.patch(args.runId, {
			status: "completed",
			videos,
			videoCompletedAt: Date.now(),
			warnings: args.warnings,
			lastError: undefined,
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const updateVideoConfig = internalMutation({
	args: {
		runId: v.id("generationRuns"),
		selectedModelId: v.string(),
		videoParams: videoParamsValidator,
		videoPrompt: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.runId, {
			selectedModelId: args.selectedModelId,
			videoParams: args.videoParams,
			videoPrompt: args.videoPrompt,
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const setCatalogCache = internalMutation({
	args: {
		payload: v.string(),
		fetchedAt: v.number(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const existing = await ctx.db.query("catalogCache").first();
		if (existing) {
			await ctx.db.patch(existing._id, {
				key: "openrouter_video_models",
				payload: args.payload,
				fetchedAt: args.fetchedAt,
			});
		} else {
			await ctx.db.insert("catalogCache", {
				key: "openrouter_video_models",
				payload: args.payload,
				fetchedAt: args.fetchedAt,
			});
		}
		return null;
	},
});

export const wipeAllStudioData = internalMutation({
	args: {},
	returns: v.object({
		runsDeleted: v.number(),
		filesDeleted: v.number(),
		cachesDeleted: v.number(),
	}),
	handler: async (ctx) => {
		const runs = await ctx.db.query("generationRuns").collect();
		let filesDeleted = 0;
		for (const run of runs) {
			const doc = run as Record<string, unknown>;
			for (const image of run.referenceImages ?? []) {
				await ctx.storage.delete(image.storageId);
				filesDeleted += 1;
			}
			for (const video of run.videos ?? []) {
				await ctx.storage.delete(video.storageId);
				filesDeleted += 1;
			}
			const legacyImage = doc.referenceImageStorageId as
				| import("./_generated/dataModel").Id<"_storage">
				| undefined;
			const legacyVideo = doc.videoStorageId as
				| import("./_generated/dataModel").Id<"_storage">
				| undefined;
			if (legacyImage) {
				await ctx.storage.delete(legacyImage);
				filesDeleted += 1;
			}
			if (legacyVideo) {
				await ctx.storage.delete(legacyVideo);
				filesDeleted += 1;
			}
			await ctx.db.delete(run._id);
		}

		const caches = await ctx.db.query("catalogCache").collect();
		for (const cache of caches) {
			await ctx.db.delete(cache._id);
		}

		return {
			runsDeleted: runs.length,
			filesDeleted,
			cachesDeleted: caches.length,
		};
	},
});
