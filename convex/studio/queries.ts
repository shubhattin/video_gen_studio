import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
	internalQuery,
	query,
	type MutationCtx,
	type QueryCtx,
} from "../_generated/server";
import { requireAdmin } from "../lib/auth";
import {
	MODEL_CAPABILITY_PROFILES,
	VIDEO_MODEL_IDS,
} from "../lib/modelCatalog";
import {
	DEFAULT_PLANNER_SYSTEM_PROMPT,
	type PlannerPromptSelection,
} from "../lib/plannerPrompt";
import { plannerPromptSelectionValidator } from "../schema";
import {
	collectRunMediaIds,
	findGalleryByObjectKey,
	galleryVideoToResult,
	imageReferencedOutsideRun,
	listCompositionClipsForRunCtx,
	listShlokaPlansForRunCtx,
	loadImagesByIds,
	loadVideosByIds,
	asGalleryImageId,
	asGalleryVideoId,
	videoReferencedOutsideRun,
} from "./media";

type DbCtx = QueryCtx | MutationCtx;

export async function listCompositionJobsForRunCtx(
	ctx: DbCtx,
	runId: Id<"generationRuns">,
) {
	const jobs = await ctx.db
		.query("compositionJobs")
		.withIndex("by_runId_and_createdAt", (q) => q.eq("runId", runId))
		.order("desc")
		.take(50);
	return jobs;
}

export async function resolveActiveCompositionJob(
	ctx: DbCtx,
	runId: Id<"generationRuns">,
): Promise<Doc<"compositionJobs"> | null> {
	const run = await ctx.db.get(runId);
	if (!run) {
		return null;
	}
	if (run.activeCompositionJobId) {
		const selected = await ctx.db.get(run.activeCompositionJobId);
		if (selected && selected.runId === runId) {
			return selected;
		}
	}
	const jobs = await listCompositionJobsForRunCtx(ctx, runId);
	return jobs[0] ?? null;
}

async function compositionWithClips(
	ctx: QueryCtx,
	job: Doc<"compositionJobs">,
) {
	const clips = await ctx.db
		.query("compositionClips")
		.withIndex("by_jobId_and_clipIndex", (q) => q.eq("jobId", job._id))
		.order("asc")
		.take(6);
	const hydrated = await Promise.all(
		clips.map(async (clip) => {
			const videoId = asGalleryVideoId(ctx, clip.galleryVideoId);
			const frameId = asGalleryImageId(ctx, clip.terminalFrameImageId);
			const videoDoc = videoId ? await ctx.db.get(videoId) : null;
			const frameDoc = frameId ? await ctx.db.get(frameId) : null;
			return {
				...clip,
				video: videoDoc ? galleryVideoToResult(videoDoc) : undefined,
				terminalFrameObjectKey: frameDoc?.objectKey,
			};
		}),
	);
	return {
		...job,
		clips: hydrated,
	};
}

async function hydrateRun(ctx: QueryCtx, run: Doc<"generationRuns">) {
	const attachedImageIds = (run.attachedImageIds ?? []).flatMap((id) => {
		const ok = asGalleryImageId(ctx, id);
		return ok ? [ok] : [];
	});
	const attachedVideoIds = (run.attachedVideoIds ?? []).flatMap((id) => {
		const ok = asGalleryVideoId(ctx, id);
		return ok ? [ok] : [];
	});
	const [referenceImages, videos] = await Promise.all([
		loadImagesByIds(ctx, attachedImageIds),
		loadVideosByIds(ctx, attachedVideoIds),
	]);
	return {
		...run,
		attachedImageIds,
		attachedVideoIds,
		firstFrameImageId: asGalleryImageId(ctx, run.firstFrameImageId),
		lastFrameImageId: asGalleryImageId(ctx, run.lastFrameImageId),
		extraReferenceImageIds: (run.extraReferenceImageIds ?? []).flatMap((id) => {
			const ok = asGalleryImageId(ctx, id);
			return ok ? [ok] : [];
		}),
		referenceImages,
		videos,
	};
}

export const getRun = query({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return null;
		}
		return await hydrateRun(ctx, run);
	},
});

export const getCompositionForRun = query({
	args: {
		runId: v.id("generationRuns"),
		jobId: v.optional(v.id("compositionJobs")),
	},
	returns: v.union(v.null(), v.any()),
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
			return null;
		}
		return await compositionWithClips(ctx, job);
	},
});

export const listCompositionJobsForRun = query({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const jobs = await listCompositionJobsForRunCtx(ctx, args.runId);
		return jobs.map((job) => ({
			_id: job._id,
			attemptNumber: job.attemptNumber ?? 1,
			status: job.status,
			mode: job.mode,
			clipCount: job.clipCount,
			videoParams: job.videoParams,
			overallDescription: job.overallDescription,
			plannerModel: job.plannerModel,
			plannerReasoning: job.plannerReasoning,
			estimatedCostUsd: job.estimatedCostUsd,
			actualCostUsd: job.actualCostUsd,
			createdAt: job.createdAt,
			updatedAt: job.updatedAt,
			lastError: job.lastError,
		}));
	},
});

export const listShlokaPlansForRun = query({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const plans = await listShlokaPlansForRunCtx(ctx, args.runId);
		return plans.map((plan) => ({
			_id: plan._id,
			attemptNumber: plan.attemptNumber,
			status: plan.status,
			title: plan.title,
			plannerSystemPrompt: plan.plannerSystemPrompt,
			plannerSystemPromptTemplateId: plan.plannerSystemPromptTemplateId,
			plannerModel: plan.plannerModel,
			plannerReasoning: plan.plannerReasoning,
			imagePrompt: plan.imagePrompt,
			videoScenes: plan.videoScenes,
			planningKey: plan.planningKey,
			warnings: plan.warnings,
			lastError: plan.lastError,
			createdAt: plan.createdAt,
			updatedAt: plan.updatedAt,
		}));
	},
});

export async function listSystemPromptTemplatesCtx(ctx: DbCtx) {
	return await ctx.db.query("systemPromptTemplates").order("desc").take(200);
}

/**
 * Resolve the actual planner prompt text for a run selection. Absent or
 * "default" selections resolve to the built-in default prompt; template
 * selections resolve to the template body (throws if the template is gone).
 */
export async function resolvePlannerPromptSnapshot(
	ctx: DbCtx,
	selection: PlannerPromptSelection | undefined,
): Promise<{ content: string; templateId?: Id<"systemPromptTemplates"> }> {
	if (!selection || selection.kind === "default") {
		return { content: DEFAULT_PLANNER_SYSTEM_PROMPT };
	}
	const template = await ctx.db.get(
		"systemPromptTemplates",
		selection.templateId,
	);
	if (!template) {
		throw new Error("The selected system prompt template no longer exists.");
	}
	return { content: template.content, templateId: template._id };
}

export const listSystemPromptTemplates = query({
	args: {},
	returns: v.array(v.any()),
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const templates = await listSystemPromptTemplatesCtx(ctx);
		return templates.map((template) => ({
			_id: template._id,
			title: template.title,
			content: template.content,
			updatedAt: template.updatedAt,
			createdAt: template._creationTime,
		}));
	},
});

export const getSystemPromptTemplate = query({
	args: {
		templateId: v.id("systemPromptTemplates"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const template = await ctx.db.get(args.templateId);
		if (!template) {
			return null;
		}
		return {
			_id: template._id,
			title: template.title,
			content: template.content,
			updatedAt: template.updatedAt,
			createdAt: template._creationTime,
		};
	},
});

/** Internal: resolve a selection to prompt text inside an action runtime. */
export const resolvePlannerPromptSelectionForRun = internalQuery({
	args: {
		selection: v.optional(plannerPromptSelectionValidator),
	},
	returns: v.union(
		v.object({ source: v.literal("default"), content: v.string() }),
		v.object({
			source: v.literal("template"),
			content: v.string(),
			templateId: v.id("systemPromptTemplates"),
		}),
	),
	handler: async (ctx, args) => {
		const resolved = await resolvePlannerPromptSnapshot(ctx, args.selection);
		if (resolved.templateId) {
			return {
				source: "template" as const,
				content: resolved.content,
				templateId: resolved.templateId,
			};
		}
		return { source: "default" as const, content: resolved.content };
	},
});

export const listRecentRuns = query({
	args: {
		limit: v.optional(v.number()),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const limit = Math.min(args.limit ?? 20, 50);
		const runs = await ctx.db
			.query("generationRuns")
			.withIndex("by_createdAt")
			.order("desc")
			.take(limit);
		return runs.map((run) => ({
			...run,
			videos: (run.attachedVideoIds ?? []).map((id) => ({ id })),
		}));
	},
});

export const listGalleryImages = query({
	args: {
		limit: v.optional(v.number()),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const limit = Math.min(args.limit ?? 80, 200);
		const docs = await ctx.db
			.query("galleryImages")
			.withIndex("by_createdAt")
			.order("desc")
			.take(limit);
		return docs.map((doc) => ({
			id: doc._id,
			objectKey: doc.objectKey,
			meta: doc.meta,
			source: doc.source,
			revisedImagePrompt: doc.revisedImagePrompt,
			createdAt: doc.createdAt,
		}));
	},
});

export const listGalleryVideos = query({
	args: {
		limit: v.optional(v.number()),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const limit = Math.min(args.limit ?? 80, 200);
		const docs = await ctx.db
			.query("galleryVideos")
			.withIndex("by_createdAt")
			.order("desc")
			.take(limit);
		return docs.map((doc) => galleryVideoToResult(doc));
	},
});

export const getRunMediaCounts = query({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.object({
		images: v.number(),
		videos: v.number(),
	}),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return { images: 0, videos: 0 };
		}
		const clips = await listCompositionClipsForRunCtx(ctx, args.runId);
		const { images, videos } = await collectRunMediaIds(ctx, run, clips);

		const allVideos = await ctx.db.query("galleryVideos").collect();
		for (const video of allVideos) {
			if (video.sourceRunId === args.runId) {
				videos.add(video._id);
			}
		}

		let imageCount = 0;
		for (const imageId of images) {
			if (await imageReferencedOutsideRun(ctx, imageId, args.runId)) {
				continue;
			}
			imageCount += 1;
		}
		let videoCount = 0;
		for (const videoId of videos) {
			if (await videoReferencedOutsideRun(ctx, videoId, args.runId)) {
				continue;
			}
			videoCount += 1;
		}
		return { images: imageCount, videos: videoCount };
	},
});

export const getStaticModelCatalog = query({
	args: {},
	returns: v.any(),
	handler: async (ctx) => {
		await requireAdmin(ctx);
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
		await requireAdmin(ctx);
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

export const getRunDoc = internalQuery({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return null;
		}
		return await hydrateRun(ctx, run);
	},
});

export const getCompositionJobByRun = internalQuery({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		return await resolveActiveCompositionJob(ctx, args.runId);
	},
});

export const getCompositionClip = internalQuery({
	args: {
		clipId: v.id("compositionClips"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		return await ctx.db.get(args.clipId);
	},
});

export const objectKeyInGallery = internalQuery({
	args: {
		objectKey: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const found = await findGalleryByObjectKey(ctx, args.objectKey);
		return found !== null;
	},
});

/** @deprecated Use objectKeyInGallery. Kept so existing callers/tests compile. */
export const objectKeyBelongsToRun = internalQuery({
	args: {
		runId: v.id("generationRuns"),
		objectKey: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return false;
		}
		return (await findGalleryByObjectKey(ctx, args.objectKey)) !== null;
	},
});
