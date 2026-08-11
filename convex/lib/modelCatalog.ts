export const VIDEO_MODEL_IDS = [
	"alibaba/wan-2.7",
	"bytedance/seedance-2.0",
	"google/veo-3.1",
	"google/veo-3.1-lite",
	"kwaivgi/kling-v3.0-std",
	"openai/sora-2-pro",
	"runway/gen-4.5",
	"x-ai/grok-imagine-video",
	"x-ai/grok-imagine-video-1.5",
] as const;

export type VideoModelId = (typeof VIDEO_MODEL_IDS)[number];

export const PLANNER_MODEL_ID = "openai/gpt-5.6-terra";
export const REFERENCE_IMAGE_MODEL_ID = "gpt-image-2";

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
export type ResolutionLabel = "480p" | "720p" | "1080p" | "4K";
export type ImageQuality = "low" | "medium" | "high" | "auto";
export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

/** Capabilities sourced from GET /api/v1/videos/models (OpenRouter). */
export interface ModelCapabilityProfile {
	id: VideoModelId;
	displayName: string;
	description: string;
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
	supportsSeed: boolean;
	supportsNegativePrompt: boolean;
	passthroughParams: string[];
	/** Upstream provider prompt character limit (Kling enforces 2500). */
	maxPromptChars: number;
	pricingNotes: string;
	/** Silent / base $/s estimate used for sorting + cost preview. */
	fallbackEstimateUsdPerSecond?: number;
	/** Optional with-audio $/s; defaults to base if omitted. */
	fallbackEstimateUsdPerSecondWithAudio?: number;
}

export const MODEL_CAPABILITY_PROFILES: Record<
	VideoModelId,
	ModelCapabilityProfile
> = {
	"google/veo-3.1-lite": {
		id: "google/veo-3.1-lite",
		displayName: "Veo 3.1 Lite",
		description: "Faster/cheaper Veo 3.1 variant for draft shorts.",
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
		maxPromptChars: 4000,
		pricingNotes: "~$0.03–0.05/s silent · ~$0.05–0.08/s with audio.",
		fallbackEstimateUsdPerSecond: 0.05,
		fallbackEstimateUsdPerSecondWithAudio: 0.08,
	},
	"x-ai/grok-imagine-video": {
		id: "x-ai/grok-imagine-video",
		displayName: "Grok Imagine Video",
		description:
			"xAI Grok Imagine Video — fast text/image/reference video (1–15s, 480p/720p).",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: false,
		supportsInputReferences: true,
		maxInputReferences: 7,
		aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"],
		resolutions: ["480p", "720p"],
		supportedDurations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
		supportsAudio: false,
		supportsSeed: false,
		supportsNegativePrompt: false,
		passthroughParams: [],
		maxPromptChars: 4000,
		pricingNotes: "~$0.05/s at 480p · ~$0.07/s at 720p (OpenRouter).",
		fallbackEstimateUsdPerSecond: 0.05,
	},
	"bytedance/seedance-2.0": {
		id: "bytedance/seedance-2.0",
		displayName: "Seedance 2.0",
		description:
			"ByteDance Seedance 2.0 — character consistency and multi-reference guidance.",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: true,
		supportsInputReferences: true,
		maxInputReferences: 4,
		aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"],
		resolutions: ["480p", "720p", "1080p", "4K"],
		supportedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
		supportsAudio: true,
		supportsSeed: true,
		supportsNegativePrompt: false,
		passthroughParams: ["watermark"],
		maxPromptChars: 4000,
		pricingNotes: "Token-based OpenRouter pricing (~$0.07+/s depending on size).",
		fallbackEstimateUsdPerSecond: 0.07,
	},
	"kwaivgi/kling-v3.0-std": {
		id: "kwaivgi/kling-v3.0-std",
		displayName: "Kling v3.0 Std",
		description: "Kuaishou Kling v3.0 standard — 720p with optional audio.",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: true,
		supportsInputReferences: false,
		maxInputReferences: 0,
		aspectRatios: ["16:9", "9:16", "1:1"],
		resolutions: ["720p"],
		supportedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
		supportsAudio: true,
		supportsSeed: false,
		supportsNegativePrompt: true,
		passthroughParams: ["negative_prompt", "cfg_scale"],
		maxPromptChars: 2500,
		pricingNotes: "~$0.084/s silent · ~$0.126/s with audio.",
		fallbackEstimateUsdPerSecond: 0.084,
		fallbackEstimateUsdPerSecondWithAudio: 0.126,
	},
	"x-ai/grok-imagine-video-1.5": {
		id: "x-ai/grok-imagine-video-1.5",
		displayName: "Grok Imagine Video 1.5",
		description:
			"xAI Grok Imagine Video 1.5 — stronger motion/physics, up to 1080p.",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: false,
		supportsInputReferences: true,
		maxInputReferences: 2,
		aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"],
		resolutions: ["480p", "720p", "1080p"],
		supportedDurations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
		supportsAudio: false,
		supportsSeed: false,
		supportsNegativePrompt: false,
		passthroughParams: [],
		maxPromptChars: 4000,
		pricingNotes: "~$0.08/s at 480p · ~$0.14/s at 720p · ~$0.25/s at 1080p.",
		fallbackEstimateUsdPerSecond: 0.08,
	},
	"alibaba/wan-2.7": {
		id: "alibaba/wan-2.7",
		displayName: "Wan 2.7",
		description:
			"Alibaba Wan 2.7 — text/image-to-video with first/last frames and style refs.",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: true,
		supportsInputReferences: true,
		maxInputReferences: 4,
		aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
		resolutions: ["720p", "1080p"],
		supportedDurations: [2, 3, 4, 5, 6, 7, 8, 9, 10],
		supportsAudio: true,
		supportsSeed: true,
		supportsNegativePrompt: true,
		passthroughParams: ["negative_prompt", "prompt_extend"],
		maxPromptChars: 4000,
		pricingNotes: "$0.10/s on OpenRouter (flat).",
		fallbackEstimateUsdPerSecond: 0.1,
		fallbackEstimateUsdPerSecondWithAudio: 0.1,
	},
	"google/veo-3.1": {
		id: "google/veo-3.1",
		displayName: "Veo 3.1",
		description:
			"Google Veo 3.1 — cinematic text/image-to-video with optional audio.",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: true,
		supportsInputReferences: false,
		maxInputReferences: 0,
		aspectRatios: ["16:9", "9:16"],
		resolutions: ["720p", "1080p", "4K"],
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
		maxPromptChars: 4000,
		pricingNotes: "~$0.20/s silent · ~$0.40/s with audio (OpenRouter).",
		fallbackEstimateUsdPerSecond: 0.2,
		fallbackEstimateUsdPerSecondWithAudio: 0.4,
	},
	"openai/sora-2-pro": {
		id: "openai/sora-2-pro",
		displayName: "Sora 2 Pro",
		description:
			"OpenAI Sora 2 Pro — production-quality text-to-video with synced audio (OpenRouter).",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: false,
		supportsLastFrame: false,
		supportsInputReferences: false,
		maxInputReferences: 0,
		aspectRatios: ["16:9", "9:16"],
		resolutions: ["720p", "1080p"],
		supportedDurations: [4, 8, 12, 16, 20],
		supportsAudio: true,
		supportsSeed: false,
		supportsNegativePrompt: false,
		passthroughParams: ["quality", "style"],
		maxPromptChars: 4000,
		pricingNotes: "~$0.30/s at 720p · ~$0.50/s at 1080p (audio included).",
		fallbackEstimateUsdPerSecond: 0.3,
		fallbackEstimateUsdPerSecondWithAudio: 0.3,
	},
	"runway/gen-4.5": {
		id: "runway/gen-4.5",
		displayName: "Gen-4.5",
		description:
			"Runway Gen-4.5 — cinematic text/image-to-video with strong motion and prompt adherence.",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		supportsFirstFrame: true,
		supportsLastFrame: false,
		supportsInputReferences: false,
		maxInputReferences: 0,
		aspectRatios: ["16:9", "9:16"],
		resolutions: ["720p"],
		supportedDurations: [2, 3, 4, 5, 6, 7, 8, 9, 10],
		supportsAudio: false,
		supportsSeed: true,
		supportsNegativePrompt: false,
		passthroughParams: ["contentModeration"],
		maxPromptChars: 4000,
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
 * Derive a comparable USD/second figure from OpenRouter `pricing_skus`.
 * Prefers silent/base duration rates; converts cents keys; returns null when
 * SKUs are token-based or otherwise not $/s.
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
	];
	for (const key of preferredUsdKeys) {
		const raw = skus[key];
		if (raw == null) continue;
		const value = Number(raw);
		if (Number.isFinite(value) && value > 0) {
			return value;
		}
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
