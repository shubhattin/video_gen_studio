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

/** Current Seedance six-part scene shape. */
export const videoSceneValidator = v.object({
	sceneNumber: v.number(),
	intent: v.string(),
	subject: v.string(),
	action: v.string(),
	scene: v.string(),
	style: v.string(),
	camera: v.string(),
	audio: v.optional(v.string()),
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

/** OpenRouter async video job lifecycle (mirrors provider job status). */
export const openRouterVideoJobStatusValidator = v.union(
	v.literal("pending"),
	v.literal("in_progress"),
	v.literal("completed"),
	v.literal("failed"),
	v.literal("cancelled"),
	v.literal("expired"),
);

/** Video config stored per plan — no raw prompt slot (that's model-studio's job). */
export const planVideoConfigValidator = videoParamsValidator
	.omit("prompt")
	.extend({
		/** When true, the planner chooses duration instead of the user. */
		generateDuration: v.optional(v.boolean()),
	});

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
	generateDuration: v.optional(v.boolean()),
});

/** Which studio a system prompt template is written for. */
export const promptTemplateKindValidator = v.union(
	v.literal("video"),
	v.literal("audio"),
);

/** System prompt selection for a Shloka run; absent means "not chosen yet". */
export const plannerPromptSelectionValidator = v.union(
	v.object({ kind: v.literal("default") }),
	v.object({
		kind: v.literal("template"),
		templateId: v.id("systemPromptTemplates"),
	}),
);

export const audioRunModeValidator = v.union(
	// Raw prompt straight to the provider (Model Studio equivalent).
	v.literal("direct"),
	// Shloka → Opus song script → provider (Shloka Studio equivalent).
	v.literal("guided"),
);

export const audioRunStatusValidator = v.union(
	v.literal("draft"),
	v.literal("scripting"),
	v.literal("generating"),
	v.literal("completed"),
	v.literal("failed"),
);

export const audioParamsValidator = v.object({
	modelId: v.string(),
	/** Speech models only (e.g. GPT Audio). */
	voice: v.optional(v.string()),
	/** Guided runs on length-steerable music models (Lyria Pro). */
	targetDurationSeconds: v.optional(v.number()),
	/** Guided runs on music models: no vocals. */
	instrumental: v.optional(v.boolean()),
});

/** Song / recitation script written by the scripter (editable). */
export const audioScriptValidator = v.object({
	title: v.string(),
	/** Music direction (music models) or voice direction (speech models). */
	styleDirection: v.string(),
	/** Section-tagged lyrics (music) or recitation text (speech). */
	lyrics: v.string(),
	pronunciationNotes: v.optional(v.string()),
});

/**
 * One planner turn on a Shloka plan. The LLM conversation for a revision is
 * derived, never stored verbatim: plan.plannerSystemPrompt, then for each
 * revision on the parentIndex chain (root → this) a user turn (userMessage)
 * and an assistant turn rebuilt as JSON of that revision's CURRENT content
 * (so manual edits are what the model sees on the next revise).
 */
export const shlokaPlanRevisionValidator = v.object({
	/** Revision this one was revised from. Absent on the root (generate/regenerate). */
	parentIndex: v.optional(v.number()),
	/** Raw instruction typed in the Revise popover. Absent on the root. */
	revisionPrompt: v.optional(v.string()),
	/**
	 * Exact user message sent for this turn. Absent only on revisions migrated
	 * from pre-revision plans — re-render the base prompt from the run then.
	 */
	userMessage: v.optional(v.string()),
	imagePrompt: v.string(),
	videoScenes: v.array(videoSceneValidator),
	/** Optional free-text directives prepended to the provider video prompt. */
	generalVideoInstructions: v.optional(v.string()),
	/** Planner-chosen clip length when generateDuration was on. Absent otherwise. */
	expectedIdealVideoDuration: v.optional(v.number()),
	/** Config this revision was generated with. Video generation uses THIS. */
	lastModelParamsUsed: lastModelParamsUsedValidator,
	plannerModel: v.optional(v.string()),
	plannerReasoning: v.optional(v.string()),
	// Luna compression cache (keyed to the scenes-derived provider prompt).
	summarizedVideoPrompt: v.optional(v.string()),
	videoPromptSourceHash: v.optional(v.string()),
	createdAt: v.number(),
});

/** One scripter turn on a guided audio run. Same derived-history rules as plans. */
export const audioScriptRevisionValidator = v.object({
	parentIndex: v.optional(v.number()),
	revisionPrompt: v.optional(v.string()),
	userMessage: v.optional(v.string()),
	script: audioScriptValidator,
	/** Params the script was written for (model kind / length / vocals). */
	scriptParamsUsed: audioParamsValidator,
	scriptModel: v.optional(v.string()),
	createdAt: v.number(),
});

export default defineSchema({
	// ── Protected tables (unchanged) ─────────────────────────────────────
	galleryImages: defineTable({
		objectKey: v.string(),
		meta: mediaMetaValidator,
		source: galleryImageSourceValidator,
		revisedImagePrompt: v.optional(v.string()),
		/** Wall-clock generation time (ms). Absent for uploads/frames. */
		timeTakenMs: v.optional(v.number()),
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
		/** Submit → completion wall-clock time (ms), spans poll continuations. */
		timeTakenMs: v.optional(v.number()),
		videoParams: videoParamsValidator,
		videoPrompt: v.optional(v.string()),
		warnings: v.optional(v.array(v.string())),
		sourceRunId: v.optional(v.id("generationRuns")),
		/** 0-based plan revision the video was generated from (display as +1). */
		planRevisionIndex: v.optional(v.number()),
		createdAt: v.number(),
	})
		.index("by_createdAt", ["createdAt"])
		.index("by_objectKey", ["objectKey"]),

	galleryAudios: defineTable({
		objectKey: v.string(),
		meta: mediaMetaValidator,
		audioParams: audioParamsValidator,
		/** Exact prompt text sent to the provider. */
		prompt: v.string(),
		/** Provider text output: Lyria lyrics/structure or GPT Audio transcript. */
		outputText: v.optional(v.string()),
		referenceImageCount: v.optional(v.number()),
		openRouterGenerationId: v.optional(v.string()),
		actualCostUsd: v.optional(v.number()),
		timeTakenMs: v.optional(v.number()),
		warnings: v.optional(v.array(v.string())),
		/** Owning run; cleared when the run is deleted without its media. */
		audioRunId: v.optional(v.id("audioRuns")),
		/** 0-based script revision a guided take was generated from. */
		scriptRevisionIndex: v.optional(v.number()),
		createdAt: v.number(),
	})
		.index("by_createdAt", ["createdAt"])
		.index("by_objectKey", ["objectKey"])
		.index("by_audioRunId_and_createdAt", ["audioRunId", "createdAt"]),

	catalogCache: defineTable({
		key: v.string(),
		payload: v.string(),
		fetchedAt: v.number(),
	}),

	/**
	 * In-flight OpenRouter video jobs. Lets a polling action hand its job to
	 * a continuation action (fresh 10-minute Node runtime budget) instead of
	 * dying at the Convex action limit with the generation still pending.
	 */
	openRouterVideoJobs: defineTable({
		jobId: v.string(),
		pollingUrl: v.string(),
		status: openRouterVideoJobStatusValidator,
		generationId: v.optional(v.string()),
		errorMessage: v.optional(v.string()),
		runId: v.optional(v.id("generationRuns")),
		planId: v.optional(v.id("shlokaPlans")),
		/** 0-based plan revision being generated; copied onto the gallery video. */
		planRevisionIndex: v.optional(v.number()),
		modelStudioRunId: v.optional(v.id("modelStudioRuns")),
		videoParams: videoParamsValidator,
		videoPrompt: v.optional(v.string()),
		warnings: v.optional(v.array(v.string())),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_jobId", ["jobId"])
		.index("by_status_createdAt", ["status", "createdAt"]),

	systemPromptTemplates: defineTable({
		title: v.string(),
		content: v.string(),
		/** Video (Shloka planner) or audio (song scripter) template. */
		kind: promptTemplateKindValidator,
		updatedAt: v.number(),
	}).index("by_kind", ["kind"]),

	// ── Shloka runs ──────────────────────────────────────────────────────
	generationRuns: defineTable({
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
		// Planner output — absent until generated (status "draft"). Regenerate
		// replaces the whole array with a single fresh root revision.
		revisions: v.optional(v.array(shlokaPlanRevisionValidator)),
		/** Revision shown in the <i/n> switcher and used for image/video generation. */
		activeRevisionIndex: v.optional(v.number()),
		// System prompt of the conversation — fixed for every revision of a plan.
		plannerSystemPrompt: v.optional(v.string()),
		plannerSystemPromptTemplateId: v.optional(v.id("systemPromptTemplates")),
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

	// ── Audio studio (direct + guided song runs) ─────────────────────────
	audioRuns: defineTable({
		mode: audioRunModeValidator,
		status: audioRunStatusValidator,
		title: v.optional(v.string()),
		audioParams: audioParamsValidator,
		/** Direct mode: raw prompt sent to the provider. */
		prompt: v.optional(v.string()),
		/** Guided mode: the instructions brief the scripter composes from. */
		customInstructions: v.optional(v.string()),
		promptSelection: v.optional(plannerPromptSelectionValidator),
		// Guided mode output — one script conversation per run. Regenerate
		// replaces the whole array with a single fresh root revision.
		scriptRevisions: v.optional(v.array(audioScriptRevisionValidator)),
		/** Revision shown in the <i/n> switcher and used for take generation. */
		activeScriptRevisionIndex: v.optional(v.number()),
		// System prompt of the conversation — fixed for every revision.
		scriptSystemPrompt: v.optional(v.string()),
		scriptSystemPromptTemplateId: v.optional(v.id("systemPromptTemplates")),
		/** Images sent to image-capable models (Lyria). Bounded by the model max. */
		referenceImageIds: v.optional(v.array(v.id("galleryImages"))),
		warnings: v.optional(v.array(v.string())),
		lastError: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_createdAt", ["createdAt"]),
});
