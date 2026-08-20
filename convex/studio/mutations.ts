import { v } from "convex/values";
import { internal } from "../_generated/api";
import { mutation } from "../_generated/server";
import { requireAdmin } from "../lib/auth";
import { VIDEO_MODEL_IDS, type VideoModelId } from "../lib/modelCatalog";
import { normalizePlannerSystemPromptForStorage } from "../lib/plannerPrompt";
import { defaultImageConfig, defaultVideoParams } from "../lib/schemas";
import { buildVideoPromptFromScenes } from "../lib/videoPlanMarkdown";
import {
	compositionModeValidator,
	provenanceValidator,
	videoParamsValidator,
	videoSceneValidator,
} from "../schema";
import {
	listCompositionJobsForRunCtx,
	resolveActiveCompositionJob,
} from "./queries";

export const selectCompositionJob = mutation({
	args: {
		runId: v.id("generationRuns"),
		jobId: v.id("compositionJobs"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		const job = await ctx.db.get(args.jobId);
		if (!job || job.runId !== args.runId) {
			throw new Error("Composition attempt not found for this run.");
		}
		await ctx.db.patch(args.runId, {
			activeCompositionJobId: args.jobId,
			updatedAt: Date.now(),
		});
		return null;
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
		await requireAdmin(ctx);
		const shlokaText = args.shlokaText.trim();
		if (!shlokaText) {
			throw new Error("Shloka text is required.");
		}
		const now = Date.now();
		const imageConfig = defaultImageConfig();
		const defaultModel: VideoModelId = "bytedance/seedance-2.5";
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
		await requireAdmin(ctx);
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
		shlokaText: v.optional(v.string()),
		customInstructions: v.optional(v.string()),
		plannerSystemPrompt: v.optional(v.union(v.string(), v.null())),
		imagePrompt: v.optional(v.string()),
		videoScenes: v.optional(v.array(videoSceneValidator)),
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
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		if (run.status === "video_generating" || run.status === "planning") {
			throw new Error("Run is busy. Wait for the current stage to finish.");
		}
		const requestedModelId = args.selectedModelId ?? args.videoParams?.modelId;
		const currentModelId = run.selectedModelId ?? run.videoParams?.modelId;
		// Single-clip videos lock the model; composition attempts may use different models.
		if (
			(run.videos?.length ?? 0) > 0 &&
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

		let shlokaText = run.shlokaText;
		if (args.shlokaText !== undefined) {
			const trimmed = args.shlokaText.trim();
			if (!trimmed) {
				throw new Error("Shloka text is required.");
			}
			shlokaText = trimmed;
		}

		let imagePrompt = run.imagePrompt;
		if (args.imagePrompt !== undefined) {
			const trimmed = args.imagePrompt.trim();
			if (trimmed.length < 20) {
				throw new Error("Image prompt must be at least 20 characters.");
			}
			imagePrompt = trimmed;
		}

		let videoScenes = run.videoScenes;
		let videoPrompt =
			args.videoPrompt !== undefined
				? args.videoPrompt.trim() || undefined
				: run.videoPrompt;
		if (args.videoScenes !== undefined) {
			if (args.videoScenes.length < 1 || args.videoScenes.length > 12) {
				throw new Error("Video plan must include between 1 and 12 scenes.");
			}
			videoScenes = args.videoScenes;
			// Prefer the derived provider prompt when scenes are edited unless an
			// explicit videoPrompt was also supplied in this same update.
			if (args.videoPrompt === undefined) {
				videoPrompt = buildVideoPromptFromScenes(args.videoScenes);
			}
		}

		await ctx.db.patch(args.runId, {
			shlokaText,
			customInstructions:
				args.customInstructions !== undefined
					? args.customInstructions.trim() || undefined
					: run.customInstructions,
			plannerSystemPrompt,
			imagePrompt,
			videoScenes,
			imageSize: args.imageSize ?? run.imageSize,
			imageQuality: args.imageQuality ?? run.imageQuality,
			selectedModelId: args.selectedModelId ?? run.selectedModelId,
			videoParams: args.videoParams ?? run.videoParams,
			videoPrompt,
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

		// Generate a title once real content (shloka / prompt) first arrives and
		// the run still has none. The action no-ops when a title already exists.
		const hasContent = Boolean(shlokaText?.trim() || videoPrompt?.trim());
		if (!run.title && hasContent) {
			await ctx.scheduler.runAfter(1500, internal.studio.actions.generateRunTitleScheduled, {
				runId: args.runId,
			});
		}
		return null;
	},
});

export const startComposition = mutation({
	args: {
		runId: v.id("generationRuns"),
		jobId: v.optional(v.id("compositionJobs")),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		let job = null;
		if (args.jobId) {
			const selected = await ctx.db.get(args.jobId);
			if (selected && selected.runId === args.runId) {
				job = selected;
			}
		}
		if (!job) {
			job = await resolveActiveCompositionJob(ctx, args.runId);
		}
		if (!job) {
			throw new Error(
				"Generate a multi-clip plan before starting the composition.",
			);
		}
		if (job.status === "completed" || job.status === "cancelled") {
			throw new Error("This composition cannot be started.");
		}
		if (job.status === "failed") {
			await ctx.runMutation(internal.studio.internal.resetFailedCompositionJob, {
				jobId: job._id,
			});
		}
		await ctx.db.patch(args.runId, {
			activeCompositionJobId: job._id,
			updatedAt: Date.now(),
		});
		await ctx.scheduler.runAfter(
			0,
			internal.studio.actions.generateNextCompositionClip,
			{ jobId: job._id },
		);
		return null;
	},
});

export const cancelComposition = mutation({
	args: {
		runId: v.id("generationRuns"),
		jobId: v.optional(v.id("compositionJobs")),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		let job = null;
		if (args.jobId) {
			const selected = await ctx.db.get(args.jobId);
			if (selected && selected.runId === args.runId) {
				job = selected;
			}
		}
		if (!job) {
			job = await resolveActiveCompositionJob(ctx, args.runId);
		}
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

export const renameRun = mutation({
	args: {
		runId: v.id("generationRuns"),
		title: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		const title = args.title.trim();
		if (!title) {
			throw new Error("Title cannot be empty.");
		}
		await ctx.db.patch(args.runId, {
			title: title.slice(0, 90),
			updatedAt: Date.now(),
		});
		return null;
	},
});

/** Create a run from the new-run setup screen (no text content yet). */
export const createStudioRun = mutation({
	args: {
		provenance: provenanceValidator,
		selectedModelId: v.string(),
		videoParams: v.optional(videoParamsValidator),
		compositionMode: v.optional(compositionModeValidator),
		compositionMultiplier: v.optional(v.number()),
		compositionClipCount: v.optional(v.number()),
		prompt: v.optional(v.string()),
	},
	returns: v.id("generationRuns"),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (!(VIDEO_MODEL_IDS as readonly string[]).includes(args.selectedModelId)) {
			throw new Error("Unsupported model.");
		}
		const modelId = args.selectedModelId as VideoModelId;
		const now = Date.now();
		const imageConfig = defaultImageConfig();
		const videoParams = args.videoParams
			? { ...defaultVideoParams(modelId), ...args.videoParams, modelId }
			: defaultVideoParams(modelId);
		const prompt = args.prompt?.trim();

		const runId = await ctx.db.insert("generationRuns", {
			provenance: args.provenance,
			status: "draft",
			revisionNumber: 1,
			selectedModelId: modelId,
			videoParams: prompt ? { ...videoParams, prompt } : videoParams,
			...(prompt ? { videoPrompt: prompt } : {}),
			imageSize: imageConfig.size,
			imageQuality: imageConfig.quality,
			referenceImages: [],
			extraReferenceImageIds: [],
			videos: [],
			compositionMode: args.compositionMode,
			compositionMultiplier: args.compositionMultiplier,
			compositionClipCount: args.compositionClipCount,
			createdAt: now,
			updatedAt: now,
		});

		// Generate a title for the new run shortly after creation.
		await ctx.scheduler.runAfter(1500, internal.studio.actions.generateRunTitleScheduled, {
			runId,
		});
		return runId;
	},
});

export const deleteRun = mutation({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return null;
		}
		const keysToDelete: string[] = [];
		const compositionJobs = await listCompositionJobsForRunCtx(ctx, args.runId);
		for (const compositionJob of compositionJobs) {
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
			await ctx.scheduler.runAfter(0, internal.studio.r2.deleteObjects, {
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
		await requireAdmin(ctx);
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
		await ctx.scheduler.runAfter(0, internal.studio.r2.deleteObjects, {
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
		await requireAdmin(ctx);
		return await ctx.runMutation(internal.studio.internal.wipeAllStudioData, {});
	},
});
