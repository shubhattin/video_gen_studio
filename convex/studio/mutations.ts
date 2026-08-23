import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	mutation,
	type MutationCtx,
} from "../_generated/server";
import { requireAdmin } from "../lib/auth";
import {
	VIDEO_MODEL_IDS,
	type VideoModelId,
} from "../lib/modelCatalog";
import {
	defaultImageConfig,
	defaultVideoParams,
	validateVideoParams,
} from "../lib/schemas";
import { normalizeVideoScenes } from "../lib/videoPlanMarkdown";
import {
	plannerPromptSelectionValidator,
	videoSceneValidator,
} from "../schema";
import {
	collectRunMediaIds,
	imageReferencedOutsideModelStudioRun,
	imageReferencedOutsideRun,
	listAllPlansForRunCtx,
	listPlansForRunCtx,
	uniqueIds,
	unlinkGalleryImageFromRuns,
	unlinkGalleryVideoFromRuns,
	videoReferencedOutsideRun,
} from "./media";
import { resolveGalleryVideoRunConnection } from "./queries";

const galleryIdOrNull = v.optional(v.union(v.id("galleryImages"), v.null()));

// ── Shloka runs ─────────────────────────────────────────────────────────

/**
 * Create a shloka run together with its default "Plan 1" (empty draft with
 * default video config) — one transaction, plan auto-selected as active.
 */
export const createShlokaDraft = mutation({
	args: {
		shlokaText: v.optional(v.string()),
		customInstructions: v.optional(v.string()),
		plannerPromptSelection: v.optional(plannerPromptSelectionValidator),
	},
	returns: v.object({
		runId: v.id("generationRuns"),
		planId: v.id("shlokaPlans"),
	}),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const shlokaText = args.shlokaText?.trim();
		if (args.shlokaText !== undefined && !shlokaText) {
			throw new Error("Shloka text is required.");
		}
		const now = Date.now();
		const imageConfig = defaultImageConfig();
		const defaultModel: VideoModelId = "bytedance/seedance-2.5";
		const runId = await ctx.db.insert("generationRuns", {
			status: "draft",
			shlokaText,
			customInstructions: args.customInstructions?.trim() || undefined,
			...(args.plannerPromptSelection
				? { plannerPromptSelection: args.plannerPromptSelection }
				: {}),
			imageSize: imageConfig.size,
			imageQuality: imageConfig.quality,
			attachedImageIds: [],
			firstFrameImageId: undefined,
			lastFrameImageId: undefined,
			extraReferenceImageIds: [],
			createdAt: now,
			updatedAt: now,
		});
		const planId = await ctx.db.insert("shlokaPlans", {
			runId,
			attemptNumber: 1,
			status: "draft",
			videoParams: defaultVideoParams(defaultModel),
			videoOutputIds: [],
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.patch(runId, { activePlanId: planId });
		await ctx.scheduler.runAfter(
			1500,
			internal.studio.actions.generateRunTitleScheduled,
			{ runId },
		);
		return { runId, planId };
	},
});

/** Run-level draft edits only — plan content lives on shlokaPlans rows. */
export const updateDraft = mutation({
	args: {
		runId: v.id("generationRuns"),
		shlokaText: v.optional(v.string()),
		customInstructions: v.optional(v.string()),
		plannerPromptSelection: v.optional(
			v.union(plannerPromptSelectionValidator, v.null()),
		),
		imageSize: v.optional(v.string()),
		imageQuality: v.optional(v.string()),
		firstFrameImageId: galleryIdOrNull,
		lastFrameImageId: galleryIdOrNull,
		extraReferenceImageIds: v.optional(v.array(v.id("galleryImages"))),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}

		let shlokaText = run.shlokaText;
		if (args.shlokaText !== undefined) {
			const trimmed = args.shlokaText.trim();
			if (!trimmed) {
				throw new Error("Shloka text is required.");
			}
			shlokaText = trimmed;
		}

		const plannerPromptSelection =
			args.plannerPromptSelection === undefined
				? run.plannerPromptSelection
				: (args.plannerPromptSelection ?? undefined);

		const firstFrameImageId =
			args.firstFrameImageId === null
				? undefined
				: (args.firstFrameImageId ?? run.firstFrameImageId);
		const lastFrameImageId =
			args.lastFrameImageId === null
				? undefined
				: (args.lastFrameImageId ?? run.lastFrameImageId);
		let extraReferenceImageIds = uniqueIds([
			...(args.extraReferenceImageIds ?? run.extraReferenceImageIds ?? []),
		]);

		await ctx.db.patch(args.runId, {
			shlokaText,
			customInstructions:
				args.customInstructions !== undefined
					? args.customInstructions.trim() || undefined
					: run.customInstructions,
			plannerPromptSelection,
			imageSize: args.imageSize ?? run.imageSize,
			imageQuality: args.imageQuality ?? run.imageQuality,
			firstFrameImageId,
			lastFrameImageId,
			extraReferenceImageIds,
			updatedAt: Date.now(),
		});

		// Dedupe roles against each other after the patch values are known.
		const extras = extraReferenceImageIds.filter(
			(id) => id !== firstFrameImageId && id !== lastFrameImageId,
		);
		if (extras.length !== extraReferenceImageIds.length) {
			await ctx.db.patch(args.runId, {
				extraReferenceImageIds: extras,
			});
		}

		const hasContent = Boolean(shlokaText?.trim());
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

// ── Plans ───────────────────────────────────────────────────────────────

async function nextAttemptNumber(
	ctx: MutationCtx,
	runId: Id<"generationRuns">,
): Promise<number> {
	const existing = await ctx.db
		.query("shlokaPlans")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.take(200);
	return (
		existing.reduce((acc, plan) => Math.max(acc, plan.attemptNumber), 0) + 1
	);
}

/** Create a fresh blank plan ("+" button); inherits the active plan's config. */
export const createPlan = mutation({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.id("shlokaPlans"),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		const attemptNumber = await nextAttemptNumber(ctx, args.runId);
		const now = Date.now();
		const activePlan = run.activePlanId
			? await ctx.db.get(run.activePlanId)
			: null;
		const planId = await ctx.db.insert("shlokaPlans", {
			runId: args.runId,
			attemptNumber,
			status: "draft",
			videoParams:
				activePlan?.videoParams ??
				defaultVideoParams("bytedance/seedance-2.5"),
			videoOutputIds: [],
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.patch(args.runId, {
			activePlanId: planId,
			updatedAt: now,
		});
		return planId;
	},
});

export const selectPlan = mutation({
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
		await ctx.db.patch(args.runId, {
			activePlanId: plan._id,
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const renamePlan = mutation({
	args: {
		planId: v.id("shlokaPlans"),
		title: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const plan = await ctx.db.get(args.planId);
		if (!plan) {
			throw new Error("Plan not found.");
		}
		const title = args.title?.trim();
		await ctx.db.patch(args.planId, {
			title: title ? title.slice(0, 90) : undefined,
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const deletePlan = mutation({
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
		const remaining = await listPlansForRunCtx(ctx, args.runId);
		const next = remaining[remaining.length - 1];
		await ctx.db.patch(args.runId, {
			activePlanId: next?._id,
			status: next ? run.status : "draft",
			updatedAt: Date.now(),
		});
		return null;
	},
});

/** Update a plan's desired video config (applies to its NEXT generation). */
export const updatePlanConfig = mutation({
	args: {
		runId: v.id("generationRuns"),
		planId: v.id("shlokaPlans"),
		videoParams: v.object({
			modelId: v.string(),
			aspectRatio: v.string(),
			resolution: v.string(),
			durationSeconds: v.number(),
			generateAudio: v.optional(v.boolean()),
			negativePrompt: v.optional(v.string()),
			cfgScale: v.optional(v.number()),
		}),
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
		try {
			validateVideoParams({ ...args.videoParams, prompt: undefined });
		} catch (error) {
			throw new Error(
				error instanceof Error ? error.message : "Invalid video configuration.",
			);
		}
		await ctx.db.patch(args.planId, {
			videoParams: args.videoParams,
			updatedAt: Date.now(),
		});
		return null;
	},
});

/** Edit a generated plan's prompts (requires generated content). */
export const updatePlanContent = mutation({
	args: {
		runId: v.id("generationRuns"),
		planId: v.id("shlokaPlans"),
		imagePrompt: v.optional(v.string()),
		videoScenes: v.optional(v.array(videoSceneValidator)),
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
		if (plan.status !== "ready") {
			throw new Error("Generate the plan before editing its content.");
		}
		let imagePrompt = plan.imagePrompt;
		if (args.imagePrompt !== undefined) {
			const trimmed = args.imagePrompt.trim();
			if (trimmed.length < 20) {
				throw new Error("Image prompt must be at least 20 characters.");
			}
			imagePrompt = trimmed;
		}
		let videoScenes = plan.videoScenes;
		if (args.videoScenes !== undefined) {
			if (args.videoScenes.length < 1 || args.videoScenes.length > 12) {
				throw new Error("Video plan must include between 1 and 12 scenes.");
			}
			videoScenes = normalizeVideoScenes(args.videoScenes);
		}
		await ctx.db.patch(args.planId, {
			imagePrompt,
			videoScenes,
			// Prompt source changed — invalidate the Luna summary cache.
			summarizedVideoPrompt: undefined,
			videoPromptSourceHash: undefined,
			updatedAt: Date.now(),
		});
		await ctx.scheduler.runAfter(
			0,
			internal.studio.actions.refreshPlanPromptSummary,
			{ planId: args.planId },
		);
		return null;
	},
});

// ── Run deletion ────────────────────────────────────────────────────────

export const deleteRun = mutation({
	args: {
		runId: v.id("generationRuns"),
		deleteMedia: v.optional(v.boolean()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return null;
		}
		const deleteMedia = args.deleteMedia === true;

		const plans = await listAllPlansForRunCtx(ctx, args.runId);
		const r2KeysToDelete = new Set<string>();

		if (deleteMedia) {
			const { images: runImageIds, videos: runVideoIds } =
				await collectRunMediaIds(run, plans);

			for (const imageId of runImageIds) {
				if (await imageReferencedOutsideRun(ctx, imageId, args.runId)) {
					continue;
				}
				const image = await ctx.db.get(imageId);
				if (!image) continue;
				await unlinkGalleryImageFromRuns(ctx, imageId);
				await ctx.db.delete(imageId);
				r2KeysToDelete.add(image.objectKey);
			}

			for (const videoId of runVideoIds) {
				if (await videoReferencedOutsideRun(ctx, videoId, args.runId)) {
					continue;
				}
				const video = await ctx.db.get(videoId);
				if (!video) continue;
				await unlinkGalleryVideoFromRuns(ctx, videoId);
				await ctx.db.delete(videoId);
				r2KeysToDelete.add(video.objectKey);
			}

			// Videos produced by this run that were never attached to a plan.
			const allVideos = await ctx.db.query("galleryVideos").collect();
			for (const video of allVideos) {
				if (video.sourceRunId !== args.runId) continue;
				if (await videoReferencedOutsideRun(ctx, video._id, args.runId)) {
					continue;
				}
				await unlinkGalleryVideoFromRuns(ctx, video._id);
				await ctx.db.delete(video._id);
				r2KeysToDelete.add(video.objectKey);
			}
		}

		for (const plan of plans) {
			await ctx.db.delete(plan._id);
		}
		await ctx.db.delete(args.runId);

		if (r2KeysToDelete.size > 0) {
			await ctx.scheduler.runAfter(0, internal.studio.r2.deleteObjects, {
				objectKeys: [...r2KeysToDelete],
			});
		}
		return null;
	},
});

// ── Images (shared gallery, run-scoped attachments) ────────────────────

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
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const removeReferenceImage = mutation({
	args: {
		runId: v.id("generationRuns"),
		imageId: v.id("galleryImages"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		const imageId = args.imageId;
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
		const connection = await resolveGalleryVideoRunConnection(
			ctx,
			args.videoId,
		);
		if (connection) {
			throw new Error(
				"This clip is still connected to a run and cannot be deleted.",
			);
		}
		await unlinkGalleryVideoFromRuns(ctx, args.videoId);
		await ctx.db.delete(args.videoId);
		await ctx.scheduler.runAfter(0, internal.studio.r2.deleteObjects, {
			objectKeys: [video.objectKey],
		});
		return null;
	},
});

// ── Model studio runs ───────────────────────────────────────────────────

export const createModelStudioDraft = mutation({
	args: {
		modelId: v.string(),
		prompt: v.optional(v.string()),
	},
	returns: v.id("modelStudioRuns"),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (!(VIDEO_MODEL_IDS as readonly string[]).includes(args.modelId)) {
			throw new Error("Unsupported model.");
		}
		const modelId = args.modelId as VideoModelId;
		const now = Date.now();
		const imageConfig = defaultImageConfig();
		return await ctx.db.insert("modelStudioRuns", {
			status: "draft",
			prompt: args.prompt?.trim() || undefined,
			selectedModelId: modelId,
			videoParams: defaultVideoParams(modelId),
			imageSize: imageConfig.size,
			imageQuality: imageConfig.quality,
			attachedImageIds: [],
			firstFrameImageId: undefined,
			lastFrameImageId: undefined,
			extraReferenceImageIds: [],
			videoOutputIds: [],
			createdAt: now,
			updatedAt: now,
		});
	},
});

export const updateModelStudioDraft = mutation({
	args: {
		runId: v.id("modelStudioRuns"),
		prompt: v.optional(v.string()),
		selectedModelId: v.optional(v.string()),
		videoParams: v.optional(v.object({
			modelId: v.string(),
			aspectRatio: v.string(),
			resolution: v.string(),
			durationSeconds: v.number(),
			generateAudio: v.optional(v.boolean()),
			negativePrompt: v.optional(v.string()),
			cfgScale: v.optional(v.number()),
			prompt: v.optional(v.string()),
		})),
		imageSize: v.optional(v.string()),
		imageQuality: v.optional(v.string()),
		firstFrameImageId: galleryIdOrNull,
		lastFrameImageId: galleryIdOrNull,
		extraReferenceImageIds: v.optional(v.array(v.id("galleryImages"))),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		if (run.status === "generating") {
			throw new Error("Run is busy. Wait for generation to finish.");
		}
		let prompt = run.prompt;
		if (args.prompt !== undefined) {
			const raw = args.prompt.trim();
			if (raw.length > 20_000) {
				throw new Error(
					"Prompt is too long (max 20,000 characters). Shorten it before saving.",
				);
			}
			prompt = raw || undefined;
		}
		const selectedModelId =
			args.selectedModelId !== undefined
				? (VIDEO_MODEL_IDS as readonly string[]).includes(args.selectedModelId)
					? args.selectedModelId
					: run.selectedModelId
				: run.selectedModelId;
		const firstFrameImageId =
			args.firstFrameImageId === null
				? undefined
				: (args.firstFrameImageId ?? run.firstFrameImageId);
		const lastFrameImageId =
			args.lastFrameImageId === null
				? undefined
				: (args.lastFrameImageId ?? run.lastFrameImageId);

		await ctx.db.patch(args.runId, {
			prompt,
			selectedModelId,
			videoParams: args.videoParams ?? run.videoParams,
			imageSize: args.imageSize ?? run.imageSize,
			imageQuality: args.imageQuality ?? run.imageQuality,
			firstFrameImageId,
			lastFrameImageId,
			extraReferenceImageIds: uniqueIds([
				...(args.extraReferenceImageIds ?? run.extraReferenceImageIds ?? []),
			]),
			updatedAt: Date.now(),
		});

		if (!run.title && prompt) {
			await ctx.scheduler.runAfter(
				1500,
				internal.studio.actions.generateModelStudioTitleScheduled,
				{ runId: args.runId },
			);
		}
		return null;
	},
});

export const attachImageToModelStudioRun = mutation({
	args: {
		runId: v.id("modelStudioRuns"),
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
		await ctx.db.patch(args.runId, {
			attachedImageIds: uniqueIds([
				...(run.attachedImageIds ?? []),
				args.imageId,
			]),
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const removeModelStudioReferenceImage = mutation({
	args: {
		runId: v.id("modelStudioRuns"),
		imageId: v.id("galleryImages"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		const attached = (run.attachedImageIds ?? []).filter(
			(id) => id !== args.imageId,
		);
		await ctx.db.patch(args.runId, {
			attachedImageIds: attached,
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
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const renameModelStudioRun = mutation({
	args: {
		runId: v.id("modelStudioRuns"),
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

export const deleteModelStudioRun = mutation({
	args: {
		runId: v.id("modelStudioRuns"),
		deleteMedia: v.optional(v.boolean()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return null;
		}
		const r2KeysToDelete = new Set<string>();
		if (args.deleteMedia === true) {
			const imageIds = new Set<Id<"galleryImages">>();
			for (const id of run.attachedImageIds ?? []) imageIds.add(id);
			for (const id of [run.firstFrameImageId, run.lastFrameImageId]) {
				if (id) imageIds.add(id);
			}
			for (const id of run.extraReferenceImageIds ?? []) imageIds.add(id);
			for (const imageId of imageIds) {
				if (
					await imageReferencedOutsideModelStudioRun(ctx, imageId, run._id)
				) {
					continue;
				}
				const image = await ctx.db.get(imageId);
				if (!image) continue;
				await unlinkGalleryImageFromRuns(ctx, imageId);
				await ctx.db.delete(imageId);
				r2KeysToDelete.add(image.objectKey);
			}
			for (const videoId of run.videoOutputIds ?? []) {
				const video = await ctx.db.get(videoId);
				if (!video) continue;
				await unlinkGalleryVideoFromRuns(ctx, videoId);
				await ctx.db.delete(videoId);
				r2KeysToDelete.add(video.objectKey);
			}
		}
		await ctx.db.delete(args.runId);
		if (r2KeysToDelete.size > 0) {
			await ctx.scheduler.runAfter(0, internal.studio.r2.deleteObjects, {
				objectKeys: [...r2KeysToDelete],
			});
		}
		return null;
	},
});

// ── Wipe ────────────────────────────────────────────────────────────────

/** One-time cleanup: deletes all runs, plans, gallery media files, and caches. */
export const wipeAllStudioData = mutation({
	args: {},
	returns: v.object({
		runsDeleted: v.number(),
		filesDeleted: v.number(),
		cachesDeleted: v.number(),
		jobsDeleted: v.number(),
	}),
	handler: async (ctx): Promise<{
		runsDeleted: number;
		filesDeleted: number;
		cachesDeleted: number;
		jobsDeleted: number;
	}> => {
		await requireAdmin(ctx);
		return await ctx.runMutation(internal.studio.internal.wipeAllStudioData, {});
	},
});

// ── System prompt templates ─────────────────────────────────────────────

const TEMPLATE_TITLE_MAX_LENGTH = 120;

function validateTemplateTitle(title: string): string {
	const trimmed = title.trim();
	if (!trimmed) {
		throw new Error("Title is required.");
	}
	if (trimmed.length > TEMPLATE_TITLE_MAX_LENGTH) {
		throw new Error(
			`Title must be ${TEMPLATE_TITLE_MAX_LENGTH} characters or fewer.`,
		);
	}
	return trimmed;
}

/** Create a new system prompt template with an empty body. */
export const createSystemPromptTemplate = mutation({
	args: {
		title: v.string(),
	},
	returns: v.id("systemPromptTemplates"),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const title = validateTemplateTitle(args.title);
		const now = Date.now();
		return await ctx.db.insert("systemPromptTemplates", {
			title,
			content: "",
			updatedAt: now,
		});
	},
});

/** Rename and/or edit the body of a system prompt template. */
export const updateSystemPromptTemplate = mutation({
	args: {
		templateId: v.id("systemPromptTemplates"),
		title: v.optional(v.string()),
		content: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const template = await ctx.db.get(args.templateId);
		if (!template) {
			throw new Error("Template not found.");
		}
		const title =
			args.title === undefined ? template.title : validateTemplateTitle(args.title);
		const content = args.content ?? template.content;
		await ctx.db.patch(args.templateId, {
			title,
			content,
			updatedAt: Date.now(),
		});
		return null;
	},
});

/** Delete a template and drop references to it from runs and plan snapshots. */
export const deleteSystemPromptTemplate = mutation({
	args: {
		templateId: v.id("systemPromptTemplates"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const template = await ctx.db.get(args.templateId);
		if (!template) {
			return null;
		}
		const runs = await ctx.db.query("generationRuns").collect();
		for (const run of runs) {
			const selection = run.plannerPromptSelection;
			if (
				selection &&
				selection.kind === "template" &&
				selection.templateId === args.templateId
			) {
				await ctx.db.patch(run._id, {
					plannerPromptSelection: undefined,
					updatedAt: Date.now(),
				});
			}
		}
		const plans = await ctx.db.query("shlokaPlans").collect();
		for (const plan of plans) {
			if (plan.plannerSystemPromptTemplateId !== args.templateId) {
				continue;
			}
			await ctx.db.patch(plan._id, {
				plannerSystemPromptTemplateId: undefined,
				updatedAt: Date.now(),
			});
		}
		await ctx.db.delete(args.templateId);
		return null;
	},
});
