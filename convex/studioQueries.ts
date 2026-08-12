import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalQuery,
	type MutationCtx,
	type QueryCtx,
} from "./_generated/server";

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
