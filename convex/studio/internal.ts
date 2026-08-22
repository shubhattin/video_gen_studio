import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
	galleryImageSourceValidator,
	lastModelParamsUsedValidator,
	mediaMetaValidator,
	modelStudioStatusValidator,
	runStatusValidator,
	shlokaPlanStatusValidator,
	videoParamsValidator,
	videoSceneValidator,
} from "../schema";
import { uniqueIds } from "./media";

async function scheduleObjectDeletes(
	ctx: MutationCtx,
	objectKeys: Array<string | undefined | null>,
) {
	const keys = [
		...new Set(objectKeys.filter((key): key is string => Boolean(key))),
	];
	if (keys.length === 0) {
		return;
	}
	await ctx.scheduler.runAfter(0, internal.studio.r2.deleteObjects, {
		objectKeys: keys,
	});
}

const galleryVideoInsertValidator = v.object({
	objectKey: v.string(),
	meta: mediaMetaValidator,
	openRouterJobId: v.string(),
	openRouterGenerationId: v.optional(v.string()),
	actualCostUsd: v.optional(v.number()),
	videoParams: videoParamsValidator,
	videoPrompt: v.optional(v.string()),
	warnings: v.optional(v.array(v.string())),
	createdAt: v.number(),
});

// ── Run-level ───────────────────────────────────────────────────────────

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

export const setRunTitle = internalMutation({
	args: {
		runId: v.id("generationRuns"),
		title: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		const trimmed = args.title.trim();
		if (!trimmed) {
			return null;
		}
		await ctx.db.patch(args.runId, {
			title: trimmed.slice(0, 90),
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const setRunWarnings = internalMutation({
	args: {
		runId: v.id("generationRuns"),
		warnings: v.optional(v.array(v.string())),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.runId, {
			warnings: args.warnings,
			updatedAt: Date.now(),
		});
		return null;
	},
});

// ── Shloka plans ────────────────────────────────────────────────────────

export const setPlanStatus = internalMutation({
	args: {
		planId: v.id("shlokaPlans"),
		status: shlokaPlanStatusValidator,
		lastError: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const plan = await ctx.db.get(args.planId);
		if (!plan) {
			throw new Error("Plan not found.");
		}
		await ctx.db.patch(args.planId, {
			status: args.status,
			lastError: args.lastError,
			updatedAt: Date.now(),
		});
		return null;
	},
});

/**
 * Overwrite a plan's generated content (generate / regenerate semantics),
 * snapshot the config it was generated with, and reset the summary cache.
 */
export const commitPlanContent = internalMutation({
	args: {
		planId: v.id("shlokaPlans"),
		imagePrompt: v.string(),
		videoScenes: v.array(videoSceneValidator),
		plannerModel: v.string(),
		plannerReasoning: v.string(),
		/** Resolved prompt text actually sent to the planner. */
		plannerSystemPrompt: v.optional(v.string()),
		plannerSystemPromptTemplateId: v.optional(v.id("systemPromptTemplates")),
		lastModelParamsUsed: lastModelParamsUsedValidator,
		warnings: v.optional(v.array(v.string())),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const plan = await ctx.db.get(args.planId);
		if (!plan) {
			throw new Error("Plan not found.");
		}
		const now = Date.now();
		await ctx.db.patch(args.planId, {
			status: "ready",
			imagePrompt: args.imagePrompt,
			videoScenes: args.videoScenes,
			plannerSystemPrompt: args.plannerSystemPrompt,
			plannerSystemPromptTemplateId: args.plannerSystemPromptTemplateId,
			plannerModel: args.plannerModel,
			plannerReasoning: args.plannerReasoning,
			lastModelParamsUsed: args.lastModelParamsUsed,
			summarizedVideoPrompt: undefined,
			videoPromptSourceHash: undefined,
			warnings: args.warnings,
			lastError: undefined,
			updatedAt: now,
		});
		await ctx.db.patch(plan.runId, {
			status: "plan_ready",
			lastError: undefined,
			updatedAt: now,
		});
		await ctx.scheduler.runAfter(
			0,
			internal.studio.actions.refreshPlanPromptSummary,
			{ planId: args.planId },
		);
		return null;
	},
});

export const setPlanPromptSummaryCache = internalMutation({
	args: {
		planId: v.id("shlokaPlans"),
		sourceHash: v.string(),
		summarizedVideoPrompt: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const plan = await ctx.db.get(args.planId);
		if (!plan) {
			return null;
		}
		await ctx.db.patch(args.planId, {
			videoPromptSourceHash: args.sourceHash,
			summarizedVideoPrompt: args.summarizedVideoPrompt,
			updatedAt: Date.now(),
		});
		return null;
	},
});

/** Clear stale summary when the prompt is under limit or its source changed. */
export const clearPlanPromptSummary = internalMutation({
	args: {
		planId: v.id("shlokaPlans"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.planId, {
			summarizedVideoPrompt: undefined,
			videoPromptSourceHash: undefined,
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const appendPlanVideoOutput = internalMutation({
	args: {
		planId: v.id("shlokaPlans"),
		videoId: v.id("galleryVideos"),
		warnings: v.optional(v.array(v.string())),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const plan = await ctx.db.get(args.planId);
		if (!plan) {
			throw new Error("Plan not found.");
		}
		const now = Date.now();
		await ctx.db.patch(args.planId, {
			videoOutputIds: uniqueIds([...(plan.videoOutputIds ?? []), args.videoId]),
			warnings: args.warnings,
			updatedAt: now,
		});
		await ctx.db.patch(plan.runId, {
			status: "completed",
			lastError: undefined,
			updatedAt: now,
		});
		return null;
	},
});

export const failPlanVideoGeneration = internalMutation({
	args: {
		planId: v.id("shlokaPlans"),
		message: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const plan = await ctx.db.get(args.planId);
		if (!plan) {
			return null;
		}
		const now = Date.now();
		await ctx.db.patch(args.planId, {
			lastError: args.message,
			updatedAt: now,
		});
		await ctx.db.patch(plan.runId, {
			status: "failed",
			lastError: args.message,
			updatedAt: now,
		});
		return null;
	},
});

// ── Model studio runs ───────────────────────────────────────────────────

export const setModelStudioStatus = internalMutation({
	args: {
		runId: v.id("modelStudioRuns"),
		status: modelStudioStatusValidator,
		lastError: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Model studio run not found.");
		}
		await ctx.db.patch(args.runId, {
			status: args.status,
			lastError: args.lastError,
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const setModelStudioTitle = internalMutation({
	args: {
		runId: v.id("modelStudioRuns"),
		title: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		const trimmed = args.title.trim();
		if (!trimmed) {
			return null;
		}
		await ctx.db.patch(args.runId, {
			title: trimmed.slice(0, 90),
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const appendModelStudioVideoOutput = internalMutation({
	args: {
		runId: v.id("modelStudioRuns"),
		videoId: v.id("galleryVideos"),
		warnings: v.optional(v.array(v.string())),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Model studio run not found.");
		}
		await ctx.db.patch(args.runId, {
			videoOutputIds: uniqueIds([
				...(run.videoOutputIds ?? []),
				args.videoId,
			]),
			status: "completed",
			warnings: args.warnings,
			lastError: undefined,
			updatedAt: Date.now(),
		});
		return null;
	},
});

// ── Gallery inserts ─────────────────────────────────────────────────────

export const insertGalleryImage = internalMutation({
	args: {
		runId: v.optional(v.id("generationRuns")),
		modelStudioRunId: v.optional(v.id("modelStudioRuns")),
		objectKey: v.string(),
		meta: mediaMetaValidator,
		source: galleryImageSourceValidator,
		revisedImagePrompt: v.optional(v.string()),
		setAsFirstFrame: v.optional(v.boolean()),
		attachToRun: v.optional(v.boolean()),
		warnings: v.optional(v.array(v.string())),
	},
	returns: v.id("galleryImages"),
	handler: async (ctx, args) => {
		const imageId = await ctx.db.insert("galleryImages", {
			objectKey: args.objectKey,
			meta: args.meta,
			source: args.source,
			revisedImagePrompt: args.revisedImagePrompt,
			createdAt: Date.now(),
		});

		if (args.modelStudioRunId !== undefined && args.attachToRun !== false) {
			const modelRun = await ctx.db.get(args.modelStudioRunId);
			if (!modelRun) {
				throw new Error("Run not found.");
			}
			await ctx.db.patch(modelRun._id, {
				attachedImageIds: uniqueIds([
					...(modelRun.attachedImageIds ?? []),
					imageId,
				]),
				firstFrameImageId: args.setAsFirstFrame
					? imageId
					: modelRun.firstFrameImageId,
				warnings: args.warnings,
				lastError: undefined,
				updatedAt: Date.now(),
			});
		} else if (args.runId !== undefined && args.attachToRun !== false) {
			const run = await ctx.db.get(args.runId);
			if (!run) {
				throw new Error("Run not found.");
			}
			await ctx.db.patch(run._id, {
				status: "image_ready",
				attachedImageIds: uniqueIds([
					...(run.attachedImageIds ?? []),
					imageId,
				]),
				firstFrameImageId: args.setAsFirstFrame
					? imageId
					: run.firstFrameImageId,
				warnings: args.warnings,
				lastError: undefined,
				updatedAt: Date.now(),
			});
		}
		return imageId;
	},
});

export const insertGalleryVideo = internalMutation({
	args: {
		runId: v.optional(v.id("generationRuns")),
		planId: v.optional(v.id("shlokaPlans")),
		modelStudioRunId: v.optional(v.id("modelStudioRuns")),
		video: galleryVideoInsertValidator,
		warnings: v.optional(v.array(v.string())),
	},
	returns: v.id("galleryVideos"),
	handler: async (ctx, args) => {
		// Idempotency: retried action (OpenRouter poll) must not create duplicate gallery row.
		if (args.video.openRouterJobId) {
			const existing = await ctx.db
				.query("galleryVideos")
				.filter((q) =>
					q.eq(q.field("openRouterJobId"), args.video.openRouterJobId),
				)
				.first();
			if (existing) {
				// Ensure the link exists if this is a retry that previously inserted but failed to link.
				if (args.planId) {
					const plan = await ctx.db.get(args.planId);
					if (
						plan &&
						!(plan.videoOutputIds ?? []).includes(existing._id)
					) {
						const now = Date.now();
						await ctx.db.patch(plan._id, {
							videoOutputIds: uniqueIds([
								...(plan.videoOutputIds ?? []),
								existing._id,
							]),
							warnings: args.warnings,
							updatedAt: now,
						});
						const run = await ctx.db.get(plan.runId);
						if (run) {
							await ctx.db.patch(run._id, {
								status: "completed",
								lastError: undefined,
								updatedAt: now,
							});
						}
					}
				}
				if (args.modelStudioRunId) {
					const run = await ctx.db.get(args.modelStudioRunId);
					if (run && !(run.videoOutputIds ?? []).includes(existing._id)) {
						await ctx.db.patch(run._id, {
							videoOutputIds: uniqueIds([
								...(run.videoOutputIds ?? []),
								existing._id,
							]),
							status: "completed",
							warnings: args.warnings,
							lastError: undefined,
							updatedAt: Date.now(),
						});
					}
				}
				return existing._id;
			}
		}

		const videoId = await ctx.db.insert("galleryVideos", {
			objectKey: args.video.objectKey,
			meta: args.video.meta,
			openRouterJobId: args.video.openRouterJobId,
			openRouterGenerationId: args.video.openRouterGenerationId,
			actualCostUsd: args.video.actualCostUsd,
			videoParams: args.video.videoParams,
			videoPrompt: args.video.videoPrompt,
			warnings: args.video.warnings,
			sourceRunId: args.runId,
			createdAt: args.video.createdAt,
		});

		// Atomic link: gallery row + plan/run list in same transaction (no scheduler window).
		if (args.planId) {
			const plan = await ctx.db.get(args.planId);
			if (!plan) {
				throw new Error("Plan not found for video link.");
			}
			const now = Date.now();
			await ctx.db.patch(plan._id, {
				videoOutputIds: uniqueIds([
					...(plan.videoOutputIds ?? []),
					videoId,
				]),
				warnings: args.warnings,
				updatedAt: now,
			});
			const run = await ctx.db.get(plan.runId);
			if (run) {
				await ctx.db.patch(run._id, {
					status: "completed",
					lastError: undefined,
					updatedAt: now,
				});
			}
		} else if (args.modelStudioRunId !== undefined) {
			const run = await ctx.db.get(args.modelStudioRunId);
			if (!run) {
				throw new Error("Model studio run not found for video link.");
			}
			await ctx.db.patch(run._id, {
				videoOutputIds: uniqueIds([
					...(run.videoOutputIds ?? []),
					videoId,
				]),
				status: "completed",
				warnings: args.warnings,
				lastError: undefined,
				updatedAt: Date.now(),
			});
		}
		return videoId;
	},
});

// ── Catalog cache ───────────────────────────────────────────────────────

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

// ── Wipe ────────────────────────────────────────────────────────────────

export const wipeAllStudioData = internalMutation({
	args: {},
	returns: v.object({
		runsDeleted: v.number(),
		filesDeleted: v.number(),
		cachesDeleted: v.number(),
	}),
	handler: async (ctx) => {
		const keysToDelete: string[] = [];

		const images = await ctx.db.query("galleryImages").collect();
		for (const image of images) {
			keysToDelete.push(image.objectKey);
			await ctx.db.delete(image._id);
		}
		const videos = await ctx.db.query("galleryVideos").collect();
		for (const video of videos) {
			keysToDelete.push(video.objectKey);
			await ctx.db.delete(video._id);
		}

		const plans = await ctx.db.query("shlokaPlans").collect();
		for (const plan of plans) {
			await ctx.db.delete(plan._id);
		}

		const modelRuns = await ctx.db.query("modelStudioRuns").collect();
		for (const run of modelRuns) {
			await ctx.db.delete(run._id);
		}

		const runs = await ctx.db.query("generationRuns").collect();
		for (const run of runs) {
			await ctx.db.delete(run._id);
		}

		await scheduleObjectDeletes(ctx, keysToDelete);

		const caches = await ctx.db.query("catalogCache").collect();
		for (const cache of caches) {
			await ctx.db.delete(cache._id);
		}

		const templates = await ctx.db.query("systemPromptTemplates").collect();
		for (const template of templates) {
			await ctx.db.delete(template._id);
		}

		return {
			runsDeleted: runs.length + modelRuns.length + plans.length,
			filesDeleted: keysToDelete.length,
			cachesDeleted: caches.length,
		};
	},
});
