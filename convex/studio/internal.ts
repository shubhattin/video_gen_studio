import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
	compositionClipPlanValidator,
	generatedVideoValidator,
	referenceImageValidator,
	runStatusValidator,
	videoParamsValidator,
	videoSceneValidator,
} from "../schema";
import { estimateVideoCostUsd } from "../lib/videoAdapters";

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
		// Summarize the run into a short title once real content exists.
		await ctx.scheduler.runAfter(
			4000,
			internal.studio.actions.generateRunTitleScheduled,
			{ runId: args.runId },
		);
		return null;
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
			previousTerminalFrameObjectKey: previous?.terminalFrameObjectKey,
		};
	},
});

export const completeCompositionClip = internalMutation({
	args: {
		jobId: v.id("compositionJobs"),
		clipId: v.id("compositionClips"),
		video: generatedVideoValidator,
		terminalFrameObjectKey: v.optional(v.string()),
		warnings: v.optional(v.array(v.string())),
		/** When true, pause for browser terminal-frame extraction. */
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
		if (job.status === "cancelled") {
			await scheduleObjectDeletes(ctx, [
				args.video.objectKey,
				args.terminalFrameObjectKey,
			]);
			return null;
		}
		if (clip.status !== "generating") {
			throw new Error("Composition clip is not generating.");
		}
		const now = Date.now();
		await ctx.db.patch(clip._id, {
			status: "completed",
			video: args.video,
			terminalFrameObjectKey: args.terminalFrameObjectKey,
			warnings: args.warnings,
			updatedAt: now,
		});
		const awaitTerminalFrame =
			args.awaitTerminalFrame === true && !args.terminalFrameObjectKey;
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
		terminalFrameObjectKey: v.string(),
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
			await scheduleObjectDeletes(ctx, [args.terminalFrameObjectKey]);
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
		if (clip.terminalFrameObjectKey) {
			await scheduleObjectDeletes(ctx, [args.terminalFrameObjectKey]);
			return null;
		}
		const now = Date.now();
		await ctx.db.patch(clip._id, {
			terminalFrameObjectKey: args.terminalFrameObjectKey,
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
		const runs = await ctx.db.query("generationRuns").collect();
		const keysToDelete: string[] = [];
		for (const run of runs) {
			for (const image of run.referenceImages ?? []) {
				keysToDelete.push(image.objectKey);
			}
			for (const video of run.videos ?? []) {
				keysToDelete.push(video.objectKey);
			}
			await ctx.db.delete(run._id);
		}

		const compositionClips = await ctx.db.query("compositionClips").collect();
		for (const clip of compositionClips) {
			if (clip.video) {
				keysToDelete.push(clip.video.objectKey);
			}
			if (clip.terminalFrameObjectKey) {
				keysToDelete.push(clip.terminalFrameObjectKey);
			}
			await ctx.db.delete(clip._id);
		}
		const compositionJobs = await ctx.db.query("compositionJobs").collect();
		for (const job of compositionJobs) {
			await ctx.db.delete(job._id);
		}

		await scheduleObjectDeletes(ctx, keysToDelete);

		const caches = await ctx.db.query("catalogCache").collect();
		for (const cache of caches) {
			await ctx.db.delete(cache._id);
		}

		return {
			runsDeleted: runs.length,
			filesDeleted: keysToDelete.length,
			cachesDeleted: caches.length,
		};
	},
});
