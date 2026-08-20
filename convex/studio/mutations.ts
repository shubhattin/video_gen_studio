import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
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
	asGalleryImageId,
	listShlokaPlansForRunCtx,
	uniqueIds,
	unlinkGalleryImageFromRuns,
	unlinkGalleryVideoFromRuns,
} from "./media";
import {
	listCompositionJobsForRunCtx,
	resolveActiveCompositionJob,
} from "./queries";

const galleryIdOrNull = v.optional(
	v.union(v.id("galleryImages"), v.string(), v.null()),
);

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

export const selectShlokaPlan = mutation({
	args: {
		runId: v.id("generationRuns"),
		planId: v.id("shlokaPlans"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		await ctx.runMutation(internal.studio.internal.applyActiveShlokaPlan, {
			runId: args.runId,
			planId: args.planId,
		});
		return null;
	},
});

export const deleteShlokaPlan = mutation({
	args: {
		runId: v.id("generationRuns"),
		planId: v.id("shlokaPlans"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const [run, plan] = await Promise.all([
			ctx.db.get(args.runId),
			ctx.db.get(args.planId),
		]);
		if (!run) {
			throw new Error("Run not found.");
		}
		if (!plan || plan.runId !== args.runId) {
			throw new Error("Plan not found for this run.");
		}
		const wasActive = run.activePlanId === plan._id;
		await ctx.db.delete(plan._id);
		if (!wasActive) {
			return null;
		}
		const remaining = await listShlokaPlansForRunCtx(ctx, args.runId);
		const next = remaining[0];
		if (!next) {
			await ctx.db.patch(args.runId, {
				activePlanId: undefined,
				updatedAt: Date.now(),
			});
			return null;
		}
		await ctx.runMutation(internal.studio.internal.applyActiveShlokaPlan, {
			runId: args.runId,
			planId: next._id,
		});
		return null;
	},
});

function emptyRunMedia() {
	return {
		attachedImageIds: [] as Id<"galleryImages">[],
		attachedVideoIds: [] as Id<"galleryVideos">[],
		extraReferenceImageIds: [] as Id<"galleryImages">[],
	};
}

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
			shlokaText,
			customInstructions: args.customInstructions?.trim() || undefined,
			...(plannerSystemPrompt ? { plannerSystemPrompt } : {}),
			selectedModelId: defaultModel,
			imageSize: imageConfig.size,
			imageQuality: imageConfig.quality,
			videoParams: defaultVideoParams(defaultModel),
			...emptyRunMedia(),
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
			selectedModelId: modelId,
			videoParams: {
				...defaultVideoParams(modelId),
				prompt: args.prompt?.trim() || undefined,
			},
			videoPrompt: args.prompt?.trim() || undefined,
			...emptyRunMedia(),
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
		firstFrameImageId: galleryIdOrNull,
		lastFrameImageId: galleryIdOrNull,
		extraReferenceImageIds: v.optional(
			v.array(v.union(v.id("galleryImages"), v.string())),
		),
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
		if (
			(run.attachedVideoIds?.length ?? 0) > 0 &&
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
			if (args.videoPrompt === undefined) {
				videoPrompt = buildVideoPromptFromScenes(args.videoScenes);
			}
		}

		const firstFrameImageId =
			args.firstFrameImageId === null
				? undefined
				: args.firstFrameImageId !== undefined
					? asGalleryImageId(ctx, args.firstFrameImageId)
					: asGalleryImageId(ctx, run.firstFrameImageId);
		const lastFrameImageId =
			args.lastFrameImageId === null
				? undefined
				: args.lastFrameImageId !== undefined
					? asGalleryImageId(ctx, args.lastFrameImageId)
					: asGalleryImageId(ctx, run.lastFrameImageId);
		const extraReferenceImageIds = (
			args.extraReferenceImageIds ??
			run.extraReferenceImageIds ??
			[]
		).flatMap((id) => {
			const ok = asGalleryImageId(ctx, id);
			return ok ? [ok] : [];
		});

		const patch = {
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
			firstFrameImageId,
			lastFrameImageId,
			extraReferenceImageIds,
			updatedAt: Date.now(),
		};
		const first = patch.firstFrameImageId;
		const last = patch.lastFrameImageId;
		const extras = patch.extraReferenceImageIds ?? [];
		if (first && last === first) patch.lastFrameImageId = undefined;
		if (first && extras.includes(first)) {
			patch.extraReferenceImageIds = extras.filter((id) => id !== first);
		}
		if (last && extras.includes(last)) {
			patch.extraReferenceImageIds = (patch.extraReferenceImageIds ?? []).filter(
				(id) => id !== last,
			);
		}
		await ctx.db.patch(args.runId, patch);

		if (
			run.activePlanId &&
			(args.imagePrompt !== undefined ||
				args.videoScenes !== undefined ||
				args.plannerSystemPrompt !== undefined)
		) {
			const activePlan = await ctx.db.get(run.activePlanId);
			if (activePlan && activePlan.runId === args.runId) {
				await ctx.db.patch(run.activePlanId, {
					imagePrompt: imagePrompt ?? activePlan.imagePrompt,
					videoScenes: videoScenes ?? activePlan.videoScenes,
					plannerSystemPrompt,
					updatedAt: Date.now(),
				});
			}
		}

		const hasContent = Boolean(shlokaText?.trim() || videoPrompt?.trim());
		if (!run.title && hasContent) {
			await ctx.scheduler.runAfter(
				1500,
				internal.studio.actions.generateRunTitleScheduled,
				{ runId: args.runId },
			);
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
			selectedModelId: modelId,
			videoParams: prompt ? { ...videoParams, prompt } : videoParams,
			...(prompt ? { videoPrompt: prompt } : {}),
			imageSize: imageConfig.size,
			imageQuality: imageConfig.quality,
			...emptyRunMedia(),
			compositionMode: args.compositionMode,
			compositionMultiplier: args.compositionMultiplier,
			compositionClipCount: args.compositionClipCount,
			createdAt: now,
			updatedAt: now,
		});

		await ctx.scheduler.runAfter(
			1500,
			internal.studio.actions.generateRunTitleScheduled,
			{ runId },
		);
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
		const compositionJobs = await listCompositionJobsForRunCtx(ctx, args.runId);
		for (const compositionJob of compositionJobs) {
			const compositionClips = await ctx.db
				.query("compositionClips")
				.withIndex("by_jobId_and_clipIndex", (q) =>
					q.eq("jobId", compositionJob._id),
				)
				.take(6);
			for (const clip of compositionClips) {
				await ctx.db.delete(clip._id);
			}
			await ctx.db.delete(compositionJob._id);
		}
		const plans = await listShlokaPlansForRunCtx(ctx, args.runId);
		for (const plan of plans) {
			await ctx.db.delete(plan._id);
		}
		await ctx.db.delete(args.runId);
		return null;
	},
});

export const attachGalleryImageToRun = mutation({
	args: {
		runId: v.id("generationRuns"),
		imageId: v.id("galleryImages"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const [run, image] = await Promise.all([
			ctx.db.get(args.runId),
			ctx.db.get(args.imageId),
		]);
		if (!run) {
			throw new Error("Run not found.");
		}
		if (!image) {
			throw new Error("Gallery image not found.");
		}
		const attached = uniqueIds([...(run.attachedImageIds ?? []), args.imageId]);
		await ctx.db.patch(args.runId, {
			attachedImageIds: attached,
			status:
				run.status === "draft" || run.status === "plan_ready"
					? "image_ready"
					: run.status,
			imageCompletedAt: Date.now(),
			updatedAt: Date.now(),
		});
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
		const imageId = args.imageId as Id<"galleryImages">;
		const attached = (run.attachedImageIds ?? []).filter((id) => id !== imageId);
		await ctx.db.patch(args.runId, {
			attachedImageIds: attached,
			firstFrameImageId:
				run.firstFrameImageId === imageId ? undefined : run.firstFrameImageId,
			lastFrameImageId:
				run.lastFrameImageId === imageId ? undefined : run.lastFrameImageId,
			extraReferenceImageIds: (run.extraReferenceImageIds ?? []).filter(
				(id) => id !== imageId,
			),
			status: attached.length > 0 ? run.status : "plan_ready",
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const deleteGalleryImage = mutation({
	args: {
		imageId: v.id("galleryImages"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const image = await ctx.db.get(args.imageId);
		if (!image) {
			return null;
		}
		await unlinkGalleryImageFromRuns(ctx, args.imageId);
		await ctx.db.delete(args.imageId);
		await ctx.scheduler.runAfter(0, internal.studio.r2.deleteObjects, {
			objectKeys: [image.objectKey],
		});
		return null;
	},
});

export const deleteGalleryVideo = mutation({
	args: {
		videoId: v.id("galleryVideos"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const video = await ctx.db.get(args.videoId);
		if (!video) {
			return null;
		}
		await unlinkGalleryVideoFromRuns(ctx, args.videoId);
		await ctx.db.delete(args.videoId);
		await ctx.scheduler.runAfter(0, internal.studio.r2.deleteObjects, {
			objectKeys: [video.objectKey],
		});
		return null;
	},
});

/** One-time cleanup: deletes all runs, gallery media files, and catalog cache. */
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

/** Lift embedded run/clip media into the gallery and drop leftover img_* ids. */
export const migrateLegacyStudioMedia = mutation({
	args: {},
	returns: v.object({
		runsMigrated: v.number(),
		clipsMigrated: v.number(),
		imagesCreated: v.number(),
		videosCreated: v.number(),
	}),
	handler: async (
		ctx,
	): Promise<{
		runsMigrated: number;
		clipsMigrated: number;
		imagesCreated: number;
		videosCreated: number;
	}> => {
		await requireAdmin(ctx);
		return await ctx.runMutation(
			internal.studio.migrateLegacy.migrateLegacyStudioMedia,
			{},
		);
	},
});
