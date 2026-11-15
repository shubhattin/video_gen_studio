export const VIDEO_MODEL_IDS = [
	"alibaba/wan-2.6",
	"alibaba/wan-2.7",
	"bytedance/seedance-2.5",
	"bytedance/seedance-2.0",
	"bytedance/seedance-2.0-fast",
	"google/veo-3.1-lite",
	"google/gemini-omni-1.2-flash",
	"kwaivgi/kling-v3.0-pro",
	"kwaivgi/kling-v3.0-std",
	"minimax/hailuo-3-max",
	"runway/gen-4.5",
] as const;

export type VideoModelId = (typeof VIDEO_MODEL_IDS)[number];

export type VideoModelFamily =
	| "google"
	| "bytedance"
	| "kling"
	| "alibaba"
	| "minimax"
	| "runway";

export const VIDEO_MODEL_FAMILY_META: Record<
	VideoModelFamily,
	{ label: string; order: number }
> = {
	google: { label: "Google", order: 1 },
	bytedance: { label: "ByteDance", order: 2 },
	kling: { label: "Kling", order: 3 },
	alibaba: { label: "Alibaba", order: 4 },
	minimax: { label: "MiniMax", order: 5 },
	runway: { label: "Runway", order: 6 },
};

// export const PLANNER_MODEL_ID = "openai/gpt-5.6-sol";
// export const PLANNER_MODEL_ID = "anthropic/claude-fable-5";
export const PLANNER_MODEL_ID = "anthropic/claude-opus-5.5";
/**
 * OpenRouter unified reasoning effort for planner / reasoning LLM calls.
 * Sent as `reasoning.effort` — OpenRouter maps this for both OpenAI
 * (native effort) and Anthropic (budget_tokens / output_config.effort).
 * @see https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
 */
export type LlmReasoningLevel =
	| "none"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";
export const LLM_REASONING_LEVEL: LlmReasoningLevel = "low";
/** Fast, no-reasoning model used to summarize a run into a short title. */
export const TITLE_MODEL_ID = "openai/gpt-6-luna";
/** Same luna model — compress over-limit provider video prompts. */
export const VIDEO_PROMPT_SUMMARIZER_MODEL_ID = TITLE_MODEL_ID;
/** Title / prompt-compression calls: keep reasoning off. */
export const LLM_NO_REASONING_LEVEL: LlmReasoningLevel = "none";

// Image Gen 
// export const REFERENCE_IMAGE_MODEL_ID = "gpt-image-2";
export const REFERENCE_IMAGE_MODEL_ID = "gpt-image-2.5-sunburst";

/** Show character counter/meter in Model Studio when prompt usage >= this % of model limit. */
export const PROMPT_METER_THRESHOLD_PERCENT = 93;
/** video polling attempts for Openrouter Video API */
export const VIDEO_POLLING_INTERVAL = 4000;
/**
 * Max time ONE action spends polling an OpenRouter video job before it
 * schedules a continuation action and exits. Convex Node actions die at
 * 10 minutes; an 8-minute poll window leaves headroom for submit + download
 * + R2 upload + DB writes. Continuations reschedule indefinitely until the
 * job reaches a terminal state, so expensive generations are never wasted.
 */
export const POLL_RETRY_EVENT_MS = 8 * 60 * 1000;

export type AspectRatio =
	| "16:9"
	| "9:16"
	| "1:1"
	| "4:3"
	| "3:4"
	| "3:2"
	| "2:3"
	| "21:9"
	| "9:21";
export type ResolutionLabel = "360p" | "480p" | "720p" | "1080p" | "4K";
export type ImageQuality = "low" | "medium" | "high" | "auto";
export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

/** Capabilities sourced from GET /api/v1/videos/models (OpenRouter). */
export interface ModelCapabilityProfile {
	id: VideoModelId;
	displayName: string;
	description: string;
	family: VideoModelFamily;
	requiresFirstFrame: boolean;
	supportsTextToVideo: boolean;
	supportsFirstFrame: boolean;
	supportsLastFrame: boolean;
	supportsInputReferences: boolean;
	maxInputReferences: number;
	aspectRatios: AspectRatio[];
	resolutions: ResolutionLabel[];
	/** Exact allowed durations from OpenRouter `supported_durations`. */
	supportedDurations: number[];
	supportsAudio: boolean;
	/**
	 * Model always renders an audio track and rejects `generate_audio: false`
	 * (Gemini Omni). Audio is forced on and `generate_audio` is not sent.
	 */
	audioAlwaysOn?: boolean;
	supportsSeed: boolean;
	supportsNegativePrompt: boolean;
	passthroughParams: string[];
	/**
	 * Upstream provider prompt character limit. Sourced from each provider's
	 * API docs (not OpenRouter — https://openrouter.ai/api/v1/videos/models
	 * exposes no prompt-limit field). Verification links are in the
	 * per-model comments below.
	 */
	maxPromptChars: number;
	pricingNotes: string;
	/** Silent / base $/s estimate used for sorting + cost preview. */
	fallbackEstimateUsdPerSecond?: number;
	/** Optional with-audio $/s; defaults to base if omitted. */
	fallbackEstimateUsdPerSecondWithAudio?: number;
	/**
	 * Token-billed models (Seedance): USD per 1M video tokens by output
	 * resolution, mirroring OpenRouter `pricing_skus` (`video_tokens`,
	 * `video_tokens_1080p`, `video_tokens_4k`). Audio does not change the rate.
	 * When set, `fallbackEstimateUsdPerSecond` is the 720p rate.
	 */
	videoTokenUsdPerMillion?: Partial<Record<ResolutionLabel, number>>;
	/** Flat $/s by output resolution, for models whose rate varies by size. */
	usdPerSecondByResolution?: Partial<Record<ResolutionLabel, number>>;
}

/**
 * Output pixels per frame used by token-billed (Seedance) video pricing.
 * 16:9 and 9:16 share the same count; other aspect ratios are approximated.
 */
export const VIDEO_TOKEN_PIXELS_BY_RESOLUTION: Record<ResolutionLabel, number> =
	{
		"360p": 640 * 360,
		"480p": 854 * 480,
		"720p": 1280 * 720,
		"1080p": 1920 * 1080,
		"4K": 3840 * 2160,
	};
/** Seedance renders at 24 fps. */
export const VIDEO_TOKEN_FPS = 24;
/** Reference resolution for comparable $/s of token-billed models. */
export const VIDEO_TOKEN_REFERENCE_RESOLUTION: ResolutionLabel = "720p";

/**
 * Billed video tokens for one clip: (w·h / 1024) × frames, frames = 24·s + 1.
 * Verified against real OpenRouter bills (Seedance 2.0 Fast 720p:
 * 4s → 87,300 tokens = $0.36666; 8s → 173,700 tokens = $0.72954).
 */
export function videoTokensForClip(
	resolution: ResolutionLabel,
	durationSeconds: number,
): number {
	const frames = VIDEO_TOKEN_FPS * durationSeconds + 1;
	return (VIDEO_TOKEN_PIXELS_BY_RESOLUTION[resolution] / 1024) * frames;
}

/** Steady-state video tokens per second (ignores the +1 frame). */
export function videoTokensPerSecond(resolution: ResolutionLabel): number {
	return (
		(VIDEO_TOKEN_PIXELS_BY_RESOLUTION[resolution] / 1024) * VIDEO_TOKEN_FPS
	);
}

function range(from: number, to: number): number[] {
	const out: number[] = [];
	for (let n = from; n <= to; n += 1) out.push(n);
	return out;
}

export const MODEL_CAPABILITY_PROFILES: Record<
	VideoModelId,
	ModelCapabilityProfile
> = {
	"google/veo-3.1-lite": {
		id: "google/veo-3.1-lite",
		displayName: "Veo 3.1 Lite",
		description: "Faster/cheaper Veo 3.1 variant for draft shorts.",
		family: "google",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: true,
		supportsInputReferences: false,
		maxInputReferences: 0,
		aspectRatios: ["16:9", "9:16"],
		resolutions: ["720p", "1080p"],
		supportedDurations: [4, 6, 8],
		supportsAudio: true,
		supportsSeed: true,
		supportsNegativePrompt: true,
		passthroughParams: [
			"personGeneration",
			"negativePrompt",
			"conditioningScale",
			"enhancePrompt",
		],
		// Google caps Veo 3 / 3.1 (incl. Lite) text input at 1,024 TOKENS, not
		// chars (Gemini API Veo model card: https://ai.google.dev/gemini-api/docs/veo).
		// English is ~4 chars/token, but transliterated Sanskrit / IAST
		// tokenizes at ~2–3 chars/token, so 2,000 chars stays safely under the cap.
		maxPromptChars: 2000,
		pricingNotes: "~$0.03–0.05/s silent · ~$0.05–0.08/s with audio.",
		fallbackEstimateUsdPerSecond: 0.05,
		fallbackEstimateUsdPerSecondWithAudio: 0.08,
	},
	"google/gemini-omni-1.2-flash": {
		id: "google/gemini-omni-1.2-flash",
		displayName: "Gemini Omni 1.2 Flash",
		description:
			"Google Gemini Omni 1.2 Flash — Veo's successor; 3–15s with native audio, first/last frames and reference images.",
		family: "google",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: true,
		supportsInputReferences: true,
		// Gemini API: up to 6 reference images (≤3 per character, ≤2 characters).
		maxInputReferences: 6,
		aspectRatios: ["16:9", "9:16"],
		resolutions: ["360p", "720p", "1080p", "4K"],
		supportedDurations: range(3, 15),
		supportsAudio: true,
		// Verified 2026-11-15: OpenRouter returns 400 "This model always
		// generates audio with the video. generate_audio cannot be set to false."
		audioAlwaysOn: true,
		supportsSeed: true,
		supportsNegativePrompt: false,
		passthroughParams: [],
		// Google documents no prompt-specific cap; the model's input context is
		// 131,072 tokens (Google Cloud model spec). 5,000 chars is our own
		// ceiling, matching Wan 2.7. Negatives belong in the prompt itself.
		maxPromptChars: 5000,
		pricingNotes:
			"Audio always on · $0.023/s 360p · $0.070/s 720p · $0.104/s 1080p · $0.209/s 4K.",
		fallbackEstimateUsdPerSecond: 0.069504,
		fallbackEstimateUsdPerSecondWithAudio: 0.069504,
		usdPerSecondByResolution: {
			"360p": 0.023172,
			"720p": 0.069504,
			"1080p": 0.104256,
			"4K": 0.208512,
		},
	},
	"bytedance/seedance-2.0-fast": {
		id: "bytedance/seedance-2.0-fast",
		displayName: "Seedance 2.0 Fast",
		description:
			"ByteDance Seedance 2.0 Fast — cheaper/faster Seedance for drafts.",
		family: "bytedance",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: true,
		supportsInputReferences: true,
		maxInputReferences: 4,
		aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"],
		resolutions: ["480p", "720p"],
		supportedDurations: range(4, 15),
		supportsAudio: true,
		supportsSeed: true,
		supportsNegativePrompt: false,
		passthroughParams: ["watermark"],
		// BytePlus ModelArk (Seedance upstream) documents no hard prompt cap for
		// video (checked 2026-11). 4,000 chars (~600–700 English words) is our
		// own conservative ceiling; prompt guides note long prompts dilute detail.
		// https://docs.byteplus.com/en/docs/ModelArk/1520757
		maxPromptChars: 4000,
		pricingNotes:
			"Token-based: ~$0.040/s at 480p · ~$0.091/s at 720p ($4.2 / 1M video tokens).",
		fallbackEstimateUsdPerSecond: 0.0907,
		videoTokenUsdPerMillion: { "480p": 4.2, "720p": 4.2 },
	},
	"bytedance/seedance-2.0": {
		id: "bytedance/seedance-2.0",
		displayName: "Seedance 2.0",
		description:
			"ByteDance Seedance 2.0 — character consistency and multi-reference guidance.",
		family: "bytedance",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: true,
		supportsInputReferences: true,
		maxInputReferences: 4,
		aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"],
		resolutions: ["480p", "720p", "1080p", "4K"],
		supportedDurations: range(4, 15),
		supportsAudio: true,
		supportsSeed: true,
		supportsNegativePrompt: false,
		passthroughParams: ["watermark"],
		// BytePlus ModelArk (Seedance upstream) documents no hard prompt cap for
		// video (checked 2026-11). 4,000 chars (~600–700 English words) is our
		// own conservative ceiling; prompt guides note long prompts dilute detail.
		// https://docs.byteplus.com/en/docs/ModelArk/1520757
		maxPromptChars: 4000,
		pricingNotes:
			"Token-based: ~$0.067/s 480p · ~$0.151/s 720p · ~$0.374/s 1080p · ~$0.778/s 4K.",
		fallbackEstimateUsdPerSecond: 0.1512,
		videoTokenUsdPerMillion: {
			"480p": 7,
			"720p": 7,
			"1080p": 7.7,
			"4K": 4,
		},
	},
	"bytedance/seedance-2.5": {
		id: "bytedance/seedance-2.5",
		displayName: "Seedance 2.5",
		description:
			"ByteDance Seedance 2.5 — long-form storytelling (up to 30s), first/last-frame control, and multimodal references.",
		family: "bytedance",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: true,
		supportsInputReferences: true,
		maxInputReferences: 9,
		aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
		resolutions: ["480p", "720p"],
		supportedDurations: range(4, 30),
		supportsAudio: true,
		supportsSeed: true,
		supportsNegativePrompt: false,
		passthroughParams: ["watermark", "req_key", "output_format"],
		// BytePlus ModelArk (Seedance upstream) documents no hard prompt cap for
		// video (checked 2026-11). 4,000 chars (~600–700 English words) is our
		// own conservative ceiling; prompt guides note long prompts dilute detail.
		// https://docs.byteplus.com/en/docs/ModelArk/1520757
		maxPromptChars: 4000,
		pricingNotes:
			"Token-based: ~$0.103/s at 480p · ~$0.231/s at 720p ($10.7 / 1M video tokens).",
		fallbackEstimateUsdPerSecond: 0.2311,
		videoTokenUsdPerMillion: { "480p": 10.7, "720p": 10.7 },
	},
	"kwaivgi/kling-v3.0-std": {
		id: "kwaivgi/kling-v3.0-std",
		displayName: "Kling v3.0 Std",
		description: "Kuaishou Kling v3.0 standard — 720p with optional audio.",
		family: "kling",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: true,
		supportsInputReferences: false,
		maxInputReferences: 0,
		aspectRatios: ["16:9", "9:16", "1:1"],
		resolutions: ["720p"],
		supportedDurations: range(3, 15),
		supportsAudio: true,
		supportsSeed: false,
		supportsNegativePrompt: true,
		passthroughParams: ["negative_prompt", "cfg_scale"],
		// Kling official API docs: prompt max length 2,500 characters.
		// https://kling.ai/document-api/api/video/3-0-omni/text-to-video
		maxPromptChars: 2500,
		pricingNotes: "~$0.084/s silent · ~$0.126/s with audio.",
		fallbackEstimateUsdPerSecond: 0.084,
		fallbackEstimateUsdPerSecondWithAudio: 0.126,
	},
	"kwaivgi/kling-v3.0-pro": {
		id: "kwaivgi/kling-v3.0-pro",
		displayName: "Kling v3.0 Pro",
		description:
			"Kuaishou Kling v3.0 Pro — higher-quality 720p video with optional audio.",
		family: "kling",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: true,
		supportsInputReferences: false,
		maxInputReferences: 0,
		aspectRatios: ["16:9", "9:16", "1:1"],
		resolutions: ["720p"],
		supportedDurations: range(3, 15),
		supportsAudio: true,
		supportsSeed: false,
		supportsNegativePrompt: true,
		passthroughParams: ["negative_prompt", "cfg_scale"],
		// Kling official API docs: prompt max length 2,500 characters.
		// https://kling.ai/document-api/api/video/3-0-omni/text-to-video
		maxPromptChars: 2500,
		pricingNotes: "$0.112/s video · $0.168/s with audio.",
		fallbackEstimateUsdPerSecond: 0.112,
		fallbackEstimateUsdPerSecondWithAudio: 0.168,
	},
	"alibaba/wan-2.6": {
		id: "alibaba/wan-2.6",
		displayName: "Wan 2.6",
		description:
			"Alibaba Wan 2.6 — text/image-to-video (OpenRouter; Wan 2.5 is not listed).",
		family: "alibaba",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: false,
		supportsInputReferences: false,
		maxInputReferences: 0,
		aspectRatios: ["16:9", "9:16"],
		resolutions: ["720p", "1080p"],
		supportedDurations: [5, 10],
		supportsAudio: true,
		supportsSeed: true,
		supportsNegativePrompt: true,
		passthroughParams: [
			"negative_prompt",
			"enable_prompt_expansion",
			"shot_type",
			"audio",
			"size",
		],
		// Alibaba Cloud Model Studio: wan2.6 series prompts up to 1,500 chars
		// (longer text is auto-truncated).
		// https://www.alibabacloud.com/help/en/model-studio/text-to-video-api-reference
		maxPromptChars: 1500,
		pricingNotes:
			"~$0.04/s 480p text · ~$0.08/s 720p text · higher for image-to-video / 1080p.",
		fallbackEstimateUsdPerSecond: 0.05,
		fallbackEstimateUsdPerSecondWithAudio: 0.05,
	},
	"alibaba/wan-2.7": {
		id: "alibaba/wan-2.7",
		displayName: "Wan 2.7",
		description:
			"Alibaba Wan 2.7 — text/image-to-video with first/last frames and style refs.",
		family: "alibaba",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: true,
		supportsInputReferences: true,
		maxInputReferences: 4,
		aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
		resolutions: ["720p", "1080p"],
		supportedDurations: range(2, 10),
		supportsAudio: true,
		supportsSeed: true,
		supportsNegativePrompt: true,
		passthroughParams: ["negative_prompt", "prompt_extend"],
		// Alibaba Cloud Model Studio: wan2.7 prompts up to 5,000 chars
		// (longer text is auto-truncated).
		// https://www.alibabacloud.com/help/en/model-studio/text-to-video-api-reference
		maxPromptChars: 5000,
		pricingNotes: "$0.10/s on OpenRouter (flat).",
		fallbackEstimateUsdPerSecond: 0.1,
		fallbackEstimateUsdPerSecondWithAudio: 0.1,
	},
	"minimax/hailuo-3-max": {
		id: "minimax/hailuo-3-max",
		displayName: "Hailuo 3 Max",
		description:
			"MiniMax H3 Max — fast text/image-to-video at 480p/768p; jointly optimised with fal.ai for high-speed generation.",
		family: "minimax",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: true,
		supportsInputReferences: true,
		maxInputReferences: 9,
		aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
		resolutions: ["480p", "720p"],
		supportedDurations: range(5, 15),
		supportsAudio: false,
		supportsSeed: false,
		supportsNegativePrompt: false,
		passthroughParams: [],
		// MiniMax API reference: prompt ≤ 7,000 characters.
		// https://platform.minimax.io/docs/guides/video-generation.md
		maxPromptChars: 7000,
		pricingNotes: "Check OpenRouter for live $/s pricing.",
		fallbackEstimateUsdPerSecond: 0.05,
	},
	"runway/gen-4.5": {
		id: "runway/gen-4.5",
		displayName: "Gen-4.5",
		description:
			"Runway Gen-4.5 — cinematic text/image-to-video with strong motion and prompt adherence.",
		family: "runway",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: false,
		supportsInputReferences: false,
		maxInputReferences: 0,
		aspectRatios: ["16:9", "9:16"],
		resolutions: ["720p"],
		supportedDurations: range(2, 10),
		supportsAudio: false,
		supportsSeed: true,
		supportsNegativePrompt: false,
		passthroughParams: ["contentModeration"],
		// Runway API spec: promptText maxLength 1,000 characters (Gen-4.5).
		// https://docs.dev.runwayml.com/ (text-to-video / image-to-video API
		// reference) · https://help.runwayml.com/hc/en-us/articles/37327109429011
		maxPromptChars: 1000,
		pricingNotes: "$0.12/s on OpenRouter (720p).",
		fallbackEstimateUsdPerSecond: 0.12,
	},
};

export const GPT_IMAGE_ESTIMATES_USD: Record<
	ImageSize,
	Record<Exclude<ImageQuality, "auto">, number>
> = {
	"1024x1536": { low: 0.005, medium: 0.041, high: 0.165 },
	"1024x1024": { low: 0.006, medium: 0.053, high: 0.211 },
	"1536x1024": { low: 0.006, medium: 0.053, high: 0.211 },
};

export const OPENROUTER_TERRA_ESTIMATE = {
	inputPerMillionUsd: 1,
	outputPerMillionUsd: 6,
};

export function isVideoModelId(value: string): value is VideoModelId {
	return (VIDEO_MODEL_IDS as readonly string[]).includes(value);
}

/**
 * Audio flag that actually applies to a generation: forced on for
 * audio-always-on models, otherwise whatever was requested.
 */
export function effectiveGenerateAudio(
	modelId: string,
	requested: boolean | undefined,
): boolean {
	if (isVideoModelId(modelId) && MODEL_CAPABILITY_PROFILES[modelId].audioAlwaysOn) {
		return true;
	}
	return Boolean(requested);
}

export function familyForVideoModel(modelId: VideoModelId): VideoModelFamily {
	return MODEL_CAPABILITY_PROFILES[modelId].family;
}

/**
 * Derive a comparable USD/second figure from OpenRouter `pricing_skus`.
 * Prefers silent/base duration rates; converts cents keys; token-billed SKUs
 * (`video_tokens`) are converted to the 720p $/s. Returns null otherwise.
 */
export function estimateUsdPerSecondFromPricingSkus(
	skus: Record<string, string> | null | undefined,
): number | null {
	if (!skus) {
		return null;
	}

	const preferredUsdKeys = [
		"duration_seconds_without_audio_720p",
		"duration_seconds_without_audio",
		"duration_seconds",
		"duration_seconds_720p",
		"text_to_video_duration_seconds_720p",
		"text_to_video_duration_seconds_480p",
		"image_to_video_duration_seconds_720p",
		// Audio-always-on models (Gemini Omni) only publish with-audio SKUs.
		"duration_seconds_with_audio_720p",
	];
	for (const key of preferredUsdKeys) {
		const raw = skus[key];
		if (raw == null) continue;
		const value = Number(raw);
		if (Number.isFinite(value) && value > 0) {
			return value;
		}
	}

	// Token-billed (Seedance): base `video_tokens` is the 480p/720p rate.
	const tokenRate = Number(skus.video_tokens);
	if (Number.isFinite(tokenRate) && tokenRate > 0) {
		return (
			tokenRate * videoTokensPerSecond(VIDEO_TOKEN_REFERENCE_RESOLUTION)
		);
	}

	let cheapestCents: number | null = null;
	for (const [key, raw] of Object.entries(skus)) {
		if (!key.includes("cents_per") || !key.includes("second")) continue;
		if (key.includes("image")) continue;
		const value = Number(raw);
		if (!Number.isFinite(value) || value <= 0) continue;
		if (cheapestCents == null || value < cheapestCents) {
			cheapestCents = value;
		}
	}
	if (cheapestCents != null) {
		return cheapestCents / 100;
	}

	return null;
}

export function resolveVideoModelSortPrice(
	modelId: VideoModelId,
	pricingSkus?: Record<string, string> | null,
): number {
	return (
		estimateUsdPerSecondFromPricingSkus(pricingSkus) ??
		MODEL_CAPABILITY_PROFILES[modelId].fallbackEstimateUsdPerSecond ??
		Number.POSITIVE_INFINITY
	);
}

/** Sort cheapest $/s first using live SKUs when provided; else profile fallbacks. */
export function sortVideoModelsByPrice(
	modelIds: readonly VideoModelId[] = VIDEO_MODEL_IDS,
	pricingByModelId?: Partial<
		Record<string, Record<string, string> | null | undefined>
	>,
): VideoModelId[] {
	return [...modelIds].sort((a, b) => {
		const priceA = resolveVideoModelSortPrice(a, pricingByModelId?.[a]);
		const priceB = resolveVideoModelSortPrice(b, pricingByModelId?.[b]);
		if (priceA !== priceB) {
			return priceA - priceB;
		}
		return MODEL_CAPABILITY_PROFILES[a].displayName.localeCompare(
			MODEL_CAPABILITY_PROFILES[b].displayName,
		);
	});
}

/** Group models by family; within each family sort cheapest-first. Families ordered by cheapest member. */
export function groupVideoModelsByFamily(
	modelIds: readonly VideoModelId[] = VIDEO_MODEL_IDS,
	pricingByModelId?: Partial<
		Record<string, Record<string, string> | null | undefined>
	>,
): Array<{ family: VideoModelFamily; label: string; modelIds: VideoModelId[] }> {
	const byFamily = new Map<VideoModelFamily, VideoModelId[]>();
	for (const id of modelIds) {
		const family = familyForVideoModel(id);
		const list = byFamily.get(family) ?? [];
		list.push(id);
		byFamily.set(family, list);
	}

	const groups = [...byFamily.entries()].map(([family, ids]) => {
		const sorted = sortVideoModelsByPrice(ids, pricingByModelId);
		const cheapest = resolveVideoModelSortPrice(
			sorted[0]!,
			pricingByModelId?.[sorted[0]!],
		);
		return {
			family,
			label: VIDEO_MODEL_FAMILY_META[family].label,
			modelIds: sorted,
			cheapest,
			order: VIDEO_MODEL_FAMILY_META[family].order,
		};
	});

	groups.sort((a, b) => {
		if (a.cheapest !== b.cheapest) return a.cheapest - b.cheapest;
		return a.order - b.order;
	});

	return groups.map(({ family, label, modelIds: ids }) => ({
		family,
		label,
		modelIds: ids,
	}));
}
