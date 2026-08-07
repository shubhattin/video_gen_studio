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

export const referenceImageValidator = v.object({
	id: v.string(),
	storageId: v.id("_storage"),
	meta: mediaMetaValidator,
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

export default defineSchema({
	generationRuns: defineTable({
		provenance: provenanceValidator,
		status: runStatusValidator,
		revisionNumber: v.number(),
		parentRunId: v.optional(v.id("generationRuns")),
		shlokaText: v.optional(v.string()),
		customInstructions: v.optional(v.string()),
		plannerModel: v.optional(v.string()),
		plannerReasoning: v.optional(v.string()),
		imagePrompt: v.optional(v.string()),
		videoScenes: v.optional(v.array(videoSceneValidator)),
		imageSize: v.optional(v.string()),
		imageQuality: v.optional(v.string()),
		selectedModelId: v.optional(v.string()),
		videoParams: v.optional(videoParamsValidator),
		videoPrompt: v.optional(v.string()),
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
});
