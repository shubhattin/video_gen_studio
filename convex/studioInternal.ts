import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
	mediaMetaValidator,
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
			lastError: args.lastError ?? undefined,
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
		openRouterGenerationId: v.optional(v.string()),
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
			openRouterGenerationId: args.openRouterGenerationId,
			warnings: args.warnings,
			planningKey: args.planningKey,
			planningCompletedAt: Date.now(),
			lastError: undefined,
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const commitReferenceImage = internalMutation({
	args: {
		runId: v.id("generationRuns"),
		storageId: v.id("_storage"),
		meta: mediaMetaValidator,
		revisedImagePrompt: v.optional(v.string()),
		imageKey: v.string(),
		warnings: v.optional(v.array(v.string())),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.runId, {
			status: "image_ready",
			referenceImageStorageId: args.storageId,
			referenceImageMeta: args.meta,
			revisedImagePrompt: args.revisedImagePrompt,
			imageKey: args.imageKey,
			imageCompletedAt: Date.now(),
			warnings: args.warnings,
			lastError: undefined,
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const commitVideo = internalMutation({
	args: {
		runId: v.id("generationRuns"),
		storageId: v.id("_storage"),
		meta: mediaMetaValidator,
		gatewayGenerationId: v.optional(v.string()),
		actualCostUsd: v.optional(v.number()),
		videoKey: v.string(),
		warnings: v.optional(v.array(v.string())),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.runId, {
			status: "completed",
			videoStorageId: args.storageId,
			videoMeta: args.meta,
			gatewayGenerationId: args.gatewayGenerationId,
			actualCostUsd: args.actualCostUsd,
			videoKey: args.videoKey,
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
		const existing = await ctx.db
			.query("catalogCache")
			.filter((q) => q.eq(q.field("key"), "gateway_models"))
			.first();
		if (existing) {
			await ctx.db.patch(existing._id, {
				payload: args.payload,
				fetchedAt: args.fetchedAt,
			});
		} else {
			await ctx.db.insert("catalogCache", {
				key: "gateway_models",
				payload: args.payload,
				fetchedAt: args.fetchedAt,
			});
		}
		return null;
	},
});
