import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
	compositionClipPlanValidator,
	galleryImageSourceValidator,
	mediaMetaValidator,
	runStatusValidator,
	videoParamsValidator,
	videoSceneValidator,
} from "../schema";
import { estimateVideoCostUsd } from "../lib/videoAdapters";
import { leftoverObjectKeys } from "./migrateLegacy";
import { uniqueIds } from "./media";
import { resolvePlannerPromptSnapshot } from "./queries";

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

export const commitPlan = internalMutation({
	args: {
		runId: v.id("generationRuns"),
		plannerModel: v.string(),
		plannerReasoning: v.string(),
		imagePrompt: v.string(),
		videoScenes: v.array(videoSceneValidator),
		warnings: v.optional(v.array(v.string())),
		planningKey: v.string(),
		/** Resolved prompt text actually sent to the planner. */
		plannerSystemPrompt: v.optional(v.string()),
		plannerSystemPromptTemplateId: v.optional(v.id("systemPromptTemplates")),
	},
	returns: v.id("shlokaPlans"),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		let snapshot = args.plannerSystemPrompt;
		let templateId = args.plannerSystemPromptTemplateId;
		if (snapshot === undefined) {
			const resolved = await resolvePlannerPromptSnapshot(
				ctx,
				run.plannerPromptSelection,
			);
			snapshot = resolved.content;
			templateId = resolved.templateId;
		}
		const existing = await ctx.db
			.query("shlokaPlans")
			.withIndex("by_runId", (q) => q.eq("runId", args.runId))
			.take(50);
		const attemptNumber =
			existing.reduce((acc, plan) => Math.max(acc, plan.attemptNumber), 0) + 1;
		const now = Date.now();
		const planId = await ctx.db.insert("shlokaPlans", {
			runId: args.runId,
			attemptNumber,
			status: "ready",
			plannerSystemPrompt: snapshot,
			plannerSystemPromptTemplateId: templateId,
			plannerModel: args.plannerModel,
			plannerReasoning: args.plannerReasoning,
			imagePrompt: args.imagePrompt,
			videoScenes: args.videoScenes,
			planningKey: args.planningKey,
			warnings: args.warnings,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.patch(args.runId, {
			status: "plan_ready",
			activePlanId: planId,
			plannerModel: args.plannerModel,
			plannerReasoning: args.plannerReasoning,
			imagePrompt: args.imagePrompt,
			videoScenes: args.videoScenes,
			warnings: args.warnings,
			planningKey: args.planningKey,
			planningCompletedAt: now,
			lastError: undefined,
			updatedAt: now,
		});
		await ctx.scheduler.runAfter(
			4000,
			internal.studio.actions.generateRunTitleScheduled,
			{ runId: args.runId },
		);
		return planId;
	},
});

export const commitCompositionPlan = internalMutation({
	args: {
		runId: v.id("generationRuns"),
		plannerModel: v.string(),
		plannerReasoning: v.string(),
		imagePrompt: v.string(),
		overallDescription: v.string(),
		clips: v.array(compositionClipPlanValidator),
		planningKey: v.string(),
		warnings: v.optional(v.array(v.string())),
	},
	returns: v.id("compositionJobs"),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run?.compositionMode || !run.videoParams || !run.compositionClipCount) {
			throw new Error("Composition settings are missing from this run.");
		}
		if (args.clips.length !== run.compositionClipCount) {
			throw new Error(
				"The composition plan does not match the requested clip count.",
			);
		}

		const existingJobs = await ctx.db
			.query("compositionJobs")
			.withIndex("by_runId", (q) => q.eq("runId", args.runId))
			.take(50);
		const maxAttempt = existingJobs.reduce(
			(acc, job) => Math.max(acc, job.attemptNumber ?? 1),
			0,
		);

		const now = Date.now();
		const attemptNumber = maxAttempt + 1;
		const perClipEstimate = estimateVideoCostUsd(run.videoParams);
		const jobId = await ctx.db.insert("compositionJobs", {
			runId: args.runId,
			attemptNumber,
			mode: run.compositionMode,
			status: "planned",
			videoParams: run.videoParams,
			clipCount: run.compositionClipCount,
			totalDurationSeconds:
				run.videoParams.durationSeconds * run.compositionClipCount,
			estimatedCostUsd:
				perClipEstimate != null
					? perClipEstimate * run.compositionClipCount
					: undefined,
			overallDescription: args.overallDescription,
			plannerModel: args.plannerModel,
			plannerReasoning: args.plannerReasoning,
			createdAt: now,
			updatedAt: now,
		});
		for (const clip of args.clips) {
			await ctx.db.insert("compositionClips", {
				jobId,
				runId: args.runId,
				clipIndex: clip.clipIndex,
				status: "pending",
				globalDescription: clip.globalDescription,
				scenePrompt: clip.scenePrompt,
				continuityInstructions: clip.continuityInstructions,
				transition: clip.transition,
				attempts: 0,
				createdAt: now,
				updatedAt: now,
			});
		}
		await ctx.db.patch(args.runId, {
			status: "plan_ready",
			plannerModel: args.plannerModel,
			plannerReasoning: args.plannerReasoning,
			imagePrompt: args.imagePrompt,
			warnings: args.warnings,
			planningKey: args.planningKey,
			planningCompletedAt: now,
			activeCompositionJobId: jobId,
			lastError: undefined,
			updatedAt: now,
		});
		await ctx.scheduler.runAfter(
			4000,
			internal.studio.actions.generateRunTitleScheduled,
			{ runId: args.runId },
		);
		return jobId;
	},
});

export const insertGalleryImage = internalMutation({
	args: {
		runId: v.optional(v.id("generationRuns")),
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
		if (args.runId && args.attachToRun !== false) {
			const run = await ctx.db.get(args.runId);
			if (!run) {
				throw new Error("Run not found.");
			}
			const attached = uniqueIds([...(run.attachedImageIds ?? []), imageId]);
			await ctx.db.patch(args.runId, {
				status: "image_ready",
				attachedImageIds: attached,
				firstFrameImageId: args.setAsFirstFrame
					? imageId
					: run.firstFrameImageId,
				imageCompletedAt: Date.now(),
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
		video: galleryVideoInsertValidator,
		attachToRun: v.optional(v.boolean()),
		warnings: v.optional(v.array(v.string())),
	},
	returns: v.id("galleryVideos"),
	handler: async (ctx, args) => {
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
		if (args.runId && args.attachToRun !== false) {
			const run = await ctx.db.get(args.runId);
			if (!run) {
				throw new Error("Run not found.");
			}
			const attached = uniqueIds([...(run.attachedVideoIds ?? []), videoId]);
			await ctx.db.patch(args.runId, {
				status: "completed",
				attachedVideoIds: attached,
				videoCompletedAt: Date.now(),
				warnings: args.warnings,
				lastError: undefined,
				updatedAt: Date.now(),
			});
		}
		return videoId;
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

export const claimNextCompositionClip = internalMutation({
	args: {
		jobId: v.id("compositionJobs"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (
			!job ||
			job.status === "cancelled" ||
			job.status === "failed" ||
			job.status === "awaiting_terminal_frame"
		) {
			return null;
		}
		const clips = await ctx.db
			.query("compositionClips")
			.withIndex("by_jobId_and_clipIndex", (q) => q.eq("jobId", args.jobId))
			.order("asc")
			.take(6);
		const inProgress = clips.find((clip) => clip.status === "generating");
		if (inProgress) {
			return null;
		}
		const next = clips.find((clip) => clip.status === "pending");
		if (!next) {
			const allCompleted =
				clips.length === job.clipCount &&
				clips.every((clip) => clip.status === "completed");
			if (allCompleted) {
				const now = Date.now();
				await ctx.db.patch(args.jobId, {
					status: "completed",
					currentClipIndex: undefined,
					updatedAt: now,
				});
				await ctx.db.patch(job.runId, {
					status: "completed",
					videoCompletedAt: now,
					updatedAt: now,
				});
			}
			return null;
		}
		const previous = next.clipIndex
			? clips.find((clip) => clip.clipIndex === next.clipIndex - 1)
			: undefined;
		let previousTerminalFrameObjectKey: string | undefined;
		if (previous?.terminalFrameImageId) {
			const frame = await ctx.db.get(previous.terminalFrameImageId);
			previousTerminalFrameObjectKey = frame?.objectKey;
		}
		const now = Date.now();
		await ctx.db.patch(next._id, {
			status: "generating",
			attempts: next.attempts + 1,
			lastError: undefined,
			updatedAt: now,
		});
		await ctx.db.patch(args.jobId, {
			status: "generating",
			currentClipIndex: next.clipIndex,
			lastError: undefined,
			updatedAt: now,
		});
		await ctx.db.patch(job.runId, {
			status: "video_generating",
			lastError: undefined,
			updatedAt: now,
		});
		return {
			job: { ...job, status: "generating", currentClipIndex: next.clipIndex },
			clip: { ...next, status: "generating", attempts: next.attempts + 1 },
			previousTerminalFrameObjectKey,
		};
	},
});

export const completeCompositionClip = internalMutation({
	args: {
		jobId: v.id("compositionJobs"),
		clipId: v.id("compositionClips"),
		video: galleryVideoInsertValidator,
		terminalFrameImageId: v.optional(v.id("galleryImages")),
		warnings: v.optional(v.array(v.string())),
		scheduleNext: v.optional(v.boolean()),
		awaitTerminalFrame: v.optional(v.boolean()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const [job, clip] = await Promise.all([
			ctx.db.get(args.jobId),
			ctx.db.get(args.clipId),
		]);
		if (!job || !clip || clip.jobId !== job._id) {
			throw new Error("Composition clip was not found.");
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
			sourceRunId: job.runId,
			createdAt: args.video.createdAt,
		});
		if (job.status === "cancelled") {
			return null;
		}
		if (clip.status !== "generating") {
			throw new Error("Composition clip is not generating.");
		}
		const now = Date.now();
		const run = await ctx.db.get(job.runId);
		if (run) {
			await ctx.db.patch(job.runId, {
				attachedVideoIds: uniqueIds([
					...(run.attachedVideoIds ?? []),
					videoId,
				]),
				updatedAt: now,
			});
		}
		await ctx.db.patch(clip._id, {
			status: "completed",
			galleryVideoId: videoId,
			terminalFrameImageId: args.terminalFrameImageId,
			warnings: args.warnings,
			updatedAt: now,
		});
		const awaitTerminalFrame =
			args.awaitTerminalFrame === true && !args.terminalFrameImageId;
		await ctx.db.patch(job._id, {
			status: awaitTerminalFrame ? "awaiting_terminal_frame" : job.status,
			actualCostUsd: (job.actualCostUsd ?? 0) + (args.video.actualCostUsd ?? 0),
			currentClipIndex: awaitTerminalFrame
				? clip.clipIndex
				: job.currentClipIndex,
			updatedAt: now,
		});
		if (awaitTerminalFrame) {
			await ctx.db.patch(job.runId, {
				status: "video_generating",
				updatedAt: now,
			});
			return null;
		}
		if (args.scheduleNext === false) {
			return null;
		}
		await ctx.scheduler.runAfter(
			0,
			internal.studio.actions.generateNextCompositionClip,
			{ jobId: job._id },
		);
		return null;
	},
});

export const attachCompositionTerminalFrame = internalMutation({
	args: {
		jobId: v.id("compositionJobs"),
		clipId: v.id("compositionClips"),
		terminalFrameImageId: v.id("galleryImages"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const [job, clip] = await Promise.all([
			ctx.db.get(args.jobId),
			ctx.db.get(args.clipId),
		]);
		if (!job || !clip || clip.jobId !== job._id) {
			throw new Error("Composition clip was not found.");
		}
		if (job.status === "cancelled") {
			return null;
		}
		if (job.status !== "awaiting_terminal_frame") {
			throw new Error("Composition is not waiting for a terminal frame.");
		}
		if (clip.status !== "completed") {
			throw new Error(
				"Clip must be completed before attaching a terminal frame.",
			);
		}
		if (clip.terminalFrameImageId) {
			return null;
		}
		const now = Date.now();
		await ctx.db.patch(clip._id, {
			terminalFrameImageId: args.terminalFrameImageId,
			updatedAt: now,
		});
		await ctx.db.patch(job._id, {
			status: "generating",
			updatedAt: now,
		});
		await ctx.db.patch(job.runId, {
			status: "video_generating",
			updatedAt: now,
		});
		await ctx.scheduler.runAfter(
			0,
			internal.studio.actions.generateNextCompositionClip,
			{ jobId: job._id },
		);
		return null;
	},
});

export const failCompositionClip = internalMutation({
	args: {
		jobId: v.id("compositionJobs"),
		clipId: v.id("compositionClips"),
		message: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const [job, clip] = await Promise.all([
			ctx.db.get(args.jobId),
			ctx.db.get(args.clipId),
		]);
		if (!job || !clip || clip.jobId !== job._id) {
			throw new Error("Composition clip was not found.");
		}
		const now = Date.now();
		await ctx.db.patch(clip._id, {
			status: "failed",
			lastError: args.message,
			updatedAt: now,
		});
		await ctx.db.patch(job._id, {
			status: "failed",
			lastError: args.message,
			currentClipIndex: undefined,
			updatedAt: now,
		});
		await ctx.db.patch(job.runId, {
			status: "failed",
			lastError: args.message,
			updatedAt: now,
		});
		return null;
	},
});

export const resetFailedCompositionJob = internalMutation({
	args: {
		jobId: v.id("compositionJobs"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job || job.status !== "failed") {
			throw new Error("Only a failed composition can be resumed.");
		}
		const clips = await ctx.db
			.query("compositionClips")
			.withIndex("by_jobId_and_clipIndex", (q) => q.eq("jobId", job._id))
			.take(6);
		const failed = clips.find((clip) => clip.status === "failed");
		if (!failed) {
			throw new Error("The failed composition has no failed clip.");
		}
		const now = Date.now();
		await ctx.db.patch(failed._id, {
			status: "pending",
			lastError: undefined,
			updatedAt: now,
		});
		await ctx.db.patch(job._id, {
			status: "planned",
			lastError: undefined,
			currentClipIndex: undefined,
			updatedAt: now,
		});
		await ctx.db.patch(job.runId, {
			status: "plan_ready",
			lastError: undefined,
			updatedAt: now,
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

		const compositionClips = await ctx.db.query("compositionClips").collect();
		for (const clip of compositionClips) {
			keysToDelete.push(...leftoverObjectKeys(clip));
			await ctx.db.delete(clip._id);
		}
		const compositionJobs = await ctx.db.query("compositionJobs").collect();
		for (const job of compositionJobs) {
			await ctx.db.delete(job._id);
		}

		const runs = await ctx.db.query("generationRuns").collect();
		for (const run of runs) {
			keysToDelete.push(...leftoverObjectKeys(run));
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
			runsDeleted: runs.length,
			filesDeleted: keysToDelete.length,
			cachesDeleted: caches.length,
		};
	},
});

export const applyActiveShlokaPlan = internalMutation({
	args: {
		runId: v.id("generationRuns"),
		planId: v.id("shlokaPlans"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const [run, plan] = await Promise.all([
			ctx.db.get(args.runId),
			ctx.db.get(args.planId),
		]);
		if (!run || !plan || plan.runId !== args.runId) {
			throw new Error("Plan not found for this run.");
		}
		// Restore the attempt's prompt context so a following "Plan another"
		// continues to use the same default/template. Falls back to the run's
		// current selection when the attempt's template has been deleted.
		let plannerPromptSelection = run.plannerPromptSelection;
		if (plan.plannerSystemPromptTemplateId) {
			const template = await ctx.db.get(
				"systemPromptTemplates",
				plan.plannerSystemPromptTemplateId,
			);
			if (template) {
				plannerPromptSelection = {
					kind: "template",
					templateId: template._id,
				};
			}
		} else {
			plannerPromptSelection = { kind: "default" };
		}
		await ctx.db.patch(args.runId, {
			activePlanId: plan._id,
			plannerSystemPrompt: plan.plannerSystemPrompt,
			plannerPromptSelection,
			plannerModel: plan.plannerModel,
			plannerReasoning: plan.plannerReasoning,
			imagePrompt: plan.imagePrompt,
			videoScenes: plan.videoScenes,
			planningKey: plan.planningKey,
			warnings: plan.warnings,
			status: plan.status === "ready" ? "plan_ready" : run.status,
			updatedAt: Date.now(),
		});
		return null;
	},
});
