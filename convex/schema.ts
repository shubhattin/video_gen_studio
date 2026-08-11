import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const runStatusValidator = v.union(
	v.literal("draft"),
	v.literal("planning"),
	v.literal("plan_ready"),
	v.literal("image_generating"),
	v.literal("image_ready"),
	v.literal("video_generating"),
	v.literal("completed"),
	v.literal("failed"),
);

export const provenanceValidator = v.union(
	v.literal("shloka"),
	v.literal("model-studio"),
);

export const videoSceneValidator = v.object({
	sceneNumber: v.number(),
	intent: v.string(),
	subjects: v.string(),
	locationTime: v.string(),
	composition: v.string(),
	lensCamera: v.string(),
	lighting: v.string(),
	paletteAesthetics: v.string(),
	actionMotion: v.string(),
	soundDirection: v.string(),
	transition: v.string(),
	negativeConstraints: v.string(),
});

export const mediaMetaValidator = v.object({
	mimeType: v.string(),
	width: v.optional(v.number()),
	height: v.optional(v.number()),
	durationSeconds: v.optional(v.number()),
	bytes: v.optional(v.number()),
});

export const videoParamsValidator = v.object({
	modelId: v.string(),
	aspectRatio: v.string(),
	resolution: v.string(),
	durationSeconds: v.number(),
	generateAudio: v.optional(v.boolean()),
	negativePrompt: v.optional(v.string()),
	cfgScale: v.optional(v.number()),
	prompt: v.optional(v.string()),
});

export const referenceImageSourceValidator = v.union(
	v.literal("generated"),
	v.literal("uploaded"),
);

export const referenceImageValidator = v.object({
	id: v.string(),
	storageId: v.id("_storage"),
	meta: mediaMetaValidator,
	source: v.optional(referenceImageSourceValidator),
	revisedImagePrompt: v.optional(v.string()),
	createdAt: v.number(),
});

export const generatedVideoValidator = v.object({
	id: v.string(),
	storageId: v.id("_storage"),
	meta: mediaMetaValidator,
	openRouterJobId: v.string(),
	openRouterGenerationId: v.optional(v.string()),
	actualCostUsd: v.optional(v.number()),
	videoParams: videoParamsValidator,
	videoPrompt: v.optional(v.string()),
	warnings: v.optional(v.array(v.string())),
	createdAt: v.number(),
});

export const compositionModeValidator = v.union(
	v.literal("continuation"),
	v.literal("cut-scenes"),
);

export const compositionJobStatusValidator = v.union(
	v.literal("planned"),
	v.literal("generating"),
	v.literal("awaiting_terminal_frame"),
	v.literal("completed"),
	v.literal("failed"),
	v.literal("cancelled"),
);

export const compositionClipStatusValidator = v.union(
	v.literal("pending"),
	v.literal("generating"),
	v.literal("completed"),
	v.literal("failed"),
	v.literal("cancelled"),
);

export const compositionClipPlanValidator = v.object({
	clipIndex: v.number(),
	globalDescription: v.string(),
	scenePrompt: v.string(),
	continuityInstructions: v.string(),
	transition: v.string(),
});

export default defineSchema({
	generationRuns: defineTable({
		provenance: provenanceValidator,
		status: runStatusValidator,
		revisionNumber: v.number(),
		parentRunId: v.optional(v.id("generationRuns")),
		shlokaText: v.optional(v.string()),
		customInstructions: v.optional(v.string()),
		/** Custom planner system prompt; omit to use the built-in default. */
		plannerSystemPrompt: v.optional(v.string()),
		plannerModel: v.optional(v.string()),
		plannerReasoning: v.optional(v.string()),
		imagePrompt: v.optional(v.string()),
		videoScenes: v.optional(v.array(videoSceneValidator)),
		imageSize: v.optional(v.string()),
		imageQuality: v.optional(v.string()),
		selectedModelId: v.optional(v.string()),
		videoParams: v.optional(videoParamsValidator),
		videoPrompt: v.optional(v.string()),
		compositionMode: v.optional(compositionModeValidator),
		compositionMultiplier: v.optional(v.number()),
		compositionClipCount: v.optional(v.number()),
		referenceImages: v.optional(v.array(referenceImageValidator)),
		firstFrameImageId: v.optional(v.string()),
		lastFrameImageId: v.optional(v.string()),
		extraReferenceImageIds: v.optional(v.array(v.string())),
		videos: v.optional(v.array(generatedVideoValidator)),
		warnings: v.optional(v.array(v.string())),
		lastError: v.optional(v.string()),
		planningKey: v.optional(v.string()),
		planningCompletedAt: v.optional(v.number()),
		imageCompletedAt: v.optional(v.number()),
		videoCompletedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_createdAt", ["createdAt"])
		.index("by_status_createdAt", ["status", "createdAt"])
		.index("by_model_status", ["selectedModelId", "status"]),

	catalogCache: defineTable({
		key: v.string(),
		payload: v.string(),
		fetchedAt: v.number(),
	}),

	compositionJobs: defineTable({
		runId: v.id("generationRuns"),
		mode: compositionModeValidator,
		status: compositionJobStatusValidator,
		videoParams: videoParamsValidator,
		clipCount: v.number(),
		totalDurationSeconds: v.number(),
		estimatedCostUsd: v.optional(v.number()),
		actualCostUsd: v.optional(v.number()),
		currentClipIndex: v.optional(v.number()),
		overallDescription: v.optional(v.string()),
		lastError: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_runId", ["runId"])
		.index("by_status_and_updatedAt", ["status", "updatedAt"]),

	compositionClips: defineTable({
		jobId: v.id("compositionJobs"),
		runId: v.id("generationRuns"),
		clipIndex: v.number(),
		status: compositionClipStatusValidator,
		globalDescription: v.string(),
		scenePrompt: v.string(),
		continuityInstructions: v.string(),
		transition: v.string(),
		referenceImageId: v.optional(v.string()),
		referenceStorageId: v.optional(v.id("_storage")),
		terminalFrameStorageId: v.optional(v.id("_storage")),
		video: v.optional(generatedVideoValidator),
		attempts: v.number(),
		lastError: v.optional(v.string()),
		warnings: v.optional(v.array(v.string())),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_jobId_and_clipIndex", ["jobId", "clipIndex"])
		.index("by_jobId_and_status", ["jobId", "status"]),
});
