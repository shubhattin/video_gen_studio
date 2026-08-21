import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const runStatusValidator = v.union(
	// Thin lifecycle kept on runs for history display; driven by plan activity.
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

/** Current Seedance six-part scene shape. */
export const videoSceneValidator = v.object({
	sceneNumber: v.number(),
	intent: v.string(),
	subject: v.string(),
	action: v.string(),
	scene: v.string(),
	style: v.string(),
	camera: v.string(),
	audio: v.string(),
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

export const galleryImageSourceValidator = v.union(
	v.literal("generated"),
	v.literal("uploaded"),
	v.literal("terminal_frame"),
);

export const shlokaPlanStatusValidator = v.union(
	v.literal("draft"), // auto-created empty plan
	v.literal("planning"),
	v.literal("ready"),
	v.literal("failed"),
);

export const modelStudioStatusValidator = v.union(
	v.literal("draft"),
	v.literal("generating"),
	v.literal("completed"),
	v.literal("failed"),
);

/** Video config stored per plan — no raw prompt slot (that's model-studio's job). */
export const planVideoConfigValidator = videoParamsValidator.omit("prompt");

/**
 * Snapshot of the config a plan was GENERATED with (+ derived provider limit).
 * Video generation always uses this — not the user's current edits.
 */
export const lastModelParamsUsedValidator = v.object({
	modelId: v.string(),
	aspectRatio: v.string(),
	resolution: v.string(),
	durationSeconds: v.number(),
	generateAudio: v.optional(v.boolean()),
	negativePrompt: v.optional(v.string()),
	cfgScale: v.optional(v.number()),
	maxPromptChars: v.number(),
});

/** System prompt selection for a Shloka run; absent means "not chosen yet". */
export const plannerPromptSelectionValidator = v.union(
	v.object({ kind: v.literal("default") }),
	v.object({
		kind: v.literal("template"),
		templateId: v.id("systemPromptTemplates"),
	}),
);

export default defineSchema({
	// ── Protected tables (unchanged) ─────────────────────────────────────
	galleryImages: defineTable({
		objectKey: v.string(),
		meta: mediaMetaValidator,
		source: galleryImageSourceValidator,
		revisedImagePrompt: v.optional(v.string()),
		createdAt: v.number(),
	})
		.index("by_createdAt", ["createdAt"])
		.index("by_objectKey", ["objectKey"]),

	galleryVideos: defineTable({
		objectKey: v.string(),
		meta: mediaMetaValidator,
		openRouterJobId: v.string(),
		openRouterGenerationId: v.optional(v.string()),
		actualCostUsd: v.optional(v.number()),
		videoParams: videoParamsValidator,
		videoPrompt: v.optional(v.string()),
		warnings: v.optional(v.array(v.string())),
		sourceRunId: v.optional(v.id("generationRuns")),
		createdAt: v.number(),
	})
		.index("by_createdAt", ["createdAt"])
		.index("by_objectKey", ["objectKey"]),

	catalogCache: defineTable({
		key: v.string(),
		payload: v.string(),
		fetchedAt: v.number(),
	}),

	systemPromptTemplates: defineTable({
		title: v.string(),
		content: v.string(),
		updatedAt: v.number(),
	}),

	// ── Shloka runs ──────────────────────────────────────────────────────
	generationRuns: defineTable({
		provenance: provenanceValidator,
		status: runStatusValidator,
		title: v.optional(v.string()),
		shlokaText: v.optional(v.string()),
		customInstructions: v.optional(v.string()),
		/** Template/default picker — run-scoped, applies to any plan's generation. */
		plannerPromptSelection: v.optional(plannerPromptSelectionValidator),
		/** Currently open plan tab. */
		activePlanId: v.optional(v.id("shlokaPlans")),
		// Image config + attachments — images belong to the RUN.
		imageSize: v.optional(v.string()),
		imageQuality: v.optional(v.string()),
		attachedImageIds: v.optional(v.array(v.id("galleryImages"))),
		firstFrameImageId: v.optional(v.id("galleryImages")),
		lastFrameImageId: v.optional(v.id("galleryImages")),
		extraReferenceImageIds: v.optional(v.array(v.id("galleryImages"))),
		warnings: v.optional(v.array(v.string())),
		lastError: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_createdAt", ["createdAt"])
		.index("by_status_createdAt", ["status", "createdAt"]),

	shlokaPlans: defineTable({
		runId: v.id("generationRuns"),
		attemptNumber: v.number(),
		title: v.optional(v.string()),
		status: shlokaPlanStatusValidator,
		/** Current desired config (UI-editable). Used for the NEXT plan generation. */
		videoParams: planVideoConfigValidator,
		/** Config actually used when the plan was generated. Generation uses THIS. */
		lastModelParamsUsed: v.optional(lastModelParamsUsedValidator),
		// Planner output — absent until generated (status "draft").
		imagePrompt: v.optional(v.string()),
		videoScenes: v.optional(v.array(videoSceneValidator)),
		plannerSystemPrompt: v.optional(v.string()),
		plannerSystemPromptTemplateId: v.optional(v.id("systemPromptTemplates")),
		plannerModel: v.optional(v.string()),
		plannerReasoning: v.optional(v.string()),
		// Luna compression cache (keyed to the scenes-derived provider prompt).
		summarizedVideoPrompt: v.optional(v.string()),
		videoPromptSourceHash: v.optional(v.string()),
		// Outputs — many videos per plan, append-only.
		videoOutputIds: v.optional(v.array(v.id("galleryVideos"))),
		warnings: v.optional(v.array(v.string())),
		lastError: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_runId", ["runId"])
		.index("by_runId_and_createdAt", ["runId", "createdAt"]),

	// ── Model studio (direct-to-API runs, no planner) ────────────────────
	modelStudioRuns: defineTable({
		status: modelStudioStatusValidator,
		title: v.optional(v.string()),
		/** Raw director brief — sent to the provider directly. */
		prompt: v.optional(v.string()),
		selectedModelId: v.optional(v.string()),
		videoParams: v.optional(videoParamsValidator),
		imageSize: v.optional(v.string()),
		imageQuality: v.optional(v.string()),
		attachedImageIds: v.optional(v.array(v.id("galleryImages"))),
		firstFrameImageId: v.optional(v.id("galleryImages")),
		lastFrameImageId: v.optional(v.id("galleryImages")),
		extraReferenceImageIds: v.optional(v.array(v.id("galleryImages"))),
		videoOutputIds: v.optional(v.array(v.id("galleryVideos"))),
		warnings: v.optional(v.array(v.string())),
		lastError: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_createdAt", ["createdAt"]),
});
