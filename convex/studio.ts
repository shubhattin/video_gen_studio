import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	MODEL_CAPABILITY_PROFILES,
	VIDEO_MODEL_IDS,
	type VideoModelId,
} from "./lib/modelCatalog";
import { defaultImageConfig, defaultVideoParams } from "./lib/schemas";
import { videoParamsValidator } from "./schema";

async function resolveMediaUrls(
	ctx: { storage: { getUrl: (id: string) => Promise<string | null> } },
	run: {
		referenceImageStorageId?: string | null;
		videoStorageId?: string | null;
	},
) {
	const referenceImageUrl = run.referenceImageStorageId
		? await ctx.storage.getUrl(run.referenceImageStorageId)
		: null;
	const videoUrl = run.videoStorageId
		? await ctx.storage.getUrl(run.videoStorageId)
		: null;
	return { referenceImageUrl, videoUrl };
}

export const getRun = query({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return null;
		}
		const urls = await resolveMediaUrls(ctx, run);
		return { ...run, ...urls };
	},
});

export const listRecentRuns = query({
	args: {
		limit: v.optional(v.number()),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		const limit = Math.min(args.limit ?? 20, 50);
		const runs = await ctx.db
			.query("generationRuns")
			.withIndex("by_createdAt")
			.order("desc")
			.take(limit);
		return await Promise.all(
			runs.map(async (run) => {
				const urls = await resolveMediaUrls(ctx, run);
				return { ...run, ...urls };
			}),
		);
	},
});

export const getStaticModelCatalog = query({
	args: {},
	returns: v.any(),
	handler: async () => {
		return {
			modelIds: VIDEO_MODEL_IDS,
			profiles: MODEL_CAPABILITY_PROFILES,
		};
	},
});

export const getCachedGatewayCatalog = query({
	args: {},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx) => {
		const cached = await ctx.db
			.query("catalogCache")
			.filter((q) => q.eq(q.field("key"), "gateway_models"))
			.first();
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

export const createShlokaDraft = mutation({
	args: {
		shlokaText: v.string(),
		customInstructions: v.optional(v.string()),
	},
	returns: v.id("generationRuns"),
	handler: async (ctx, args) => {
		const shlokaText = args.shlokaText.trim();
		if (!shlokaText) {
			throw new Error("Shloka text is required.");
		}
		const now = Date.now();
		const imageConfig = defaultImageConfig();
		const defaultModel: VideoModelId = "google/veo-3.1-generate-001";
		return await ctx.db.insert("generationRuns", {
			provenance: "shloka",
			status: "draft",
			revisionNumber: 1,
			shlokaText,
			customInstructions: args.customInstructions?.trim() || undefined,
			selectedModelId: defaultModel,
			imageSize: imageConfig.size,
			imageQuality: imageConfig.quality,
			videoParams: defaultVideoParams(defaultModel),
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
			createdAt: now,
			updatedAt: now,
		});
	},
});

export const updateDraft = mutation({
	args: {
		runId: v.id("generationRuns"),
		customInstructions: v.optional(v.string()),
		imageSize: v.optional(v.string()),
		imageQuality: v.optional(v.string()),
		selectedModelId: v.optional(v.string()),
		videoParams: v.optional(videoParamsValidator),
		videoPrompt: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Run not found.");
		}
		if (run.status === "video_generating" || run.status === "planning") {
			throw new Error("Run is busy. Wait for the current stage to finish.");
		}
		await ctx.db.patch(args.runId, {
			customInstructions: args.customInstructions?.trim() || run.customInstructions,
			imageSize: args.imageSize ?? run.imageSize,
			imageQuality: args.imageQuality ?? run.imageQuality,
			selectedModelId: args.selectedModelId ?? run.selectedModelId,
			videoParams: args.videoParams ?? run.videoParams,
			videoPrompt: args.videoPrompt?.trim() || run.videoPrompt,
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const createImageRevision = mutation({
	args: {
		parentRunId: v.id("generationRuns"),
	},
	returns: v.id("generationRuns"),
	handler: async (ctx, args) => {
		const parent = await ctx.db.get(args.parentRunId);
		if (!parent) {
			throw new Error("Parent run not found.");
		}
		const now = Date.now();
		return await ctx.db.insert("generationRuns", {
			provenance: parent.provenance,
			status: parent.imagePrompt ? "plan_ready" : parent.status,
			revisionNumber: parent.revisionNumber + 1,
			parentRunId: args.parentRunId,
			shlokaText: parent.shlokaText,
			customInstructions: parent.customInstructions,
			plannerModel: parent.plannerModel,
			plannerReasoning: parent.plannerReasoning,
			imagePrompt: parent.imagePrompt,
			videoScenes: parent.videoScenes,
			imageSize: parent.imageSize,
			imageQuality: parent.imageQuality,
			selectedModelId: parent.selectedModelId,
			videoParams: parent.videoParams,
			videoPrompt: parent.videoPrompt,
			planningKey: parent.planningKey,
			planningCompletedAt: parent.planningCompletedAt,
			createdAt: now,
			updatedAt: now,
		});
	},
});

export const markRunFailed = mutation({
	args: {
		runId: v.id("generationRuns"),
		lastError: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.runId, {
			status: "failed",
			lastError: args.lastError,
			updatedAt: Date.now(),
		});
		return null;
	},
});
