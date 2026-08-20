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
	return {
		...job,
		clips,
	};
}

export const getRun = query({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		return await ctx.db.get(args.runId);
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

export const listRecentRuns = query({
	args: {
		limit: v.optional(v.number()),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
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
		return await ctx.db.get(args.runId);
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
		const inRun =
			(run.referenceImages ?? []).some(
				(image) => image.objectKey === args.objectKey,
			) ||
			(run.videos ?? []).some((video) => video.objectKey === args.objectKey);
		if (inRun) {
			return true;
		}
		const jobs = await listCompositionJobsForRunCtx(ctx, args.runId);
		for (const job of jobs) {
			const compositionClips = await ctx.db
				.query("compositionClips")
				.withIndex("by_jobId_and_clipIndex", (q) => q.eq("jobId", job._id))
				.take(6);
			if (
				compositionClips.some(
					(clip) =>
						clip.video?.objectKey === args.objectKey ||
						clip.terminalFrameObjectKey === args.objectKey,
				)
			) {
				return true;
			}
		}
		return false;
	},
});
