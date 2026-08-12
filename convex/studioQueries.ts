import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

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
		return await ctx.db
			.query("compositionJobs")
			.withIndex("by_runId", (q) => q.eq("runId", args.runId))
			.unique();
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
		const job = await ctx.db
			.query("compositionJobs")
			.withIndex("by_runId", (q) => q.eq("runId", args.runId))
			.unique();
		if (!job) {
			return false;
		}
		const compositionClips = await ctx.db
			.query("compositionClips")
			.withIndex("by_jobId_and_clipIndex", (q) => q.eq("jobId", job._id))
			.take(6);
		return compositionClips.some(
			(clip) =>
				clip.video?.objectKey === args.objectKey ||
				clip.terminalFrameObjectKey === args.objectKey,
		);
	},
});
