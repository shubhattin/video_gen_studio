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
