export const VIDEO_MODEL_IDS = [
	"google/veo-3.1",
	"google/veo-3.1-lite",
	"bytedance/seedance-2.0",
	"x-ai/grok-imagine-video-1.5",
	"kwaivgi/kling-v3.0-std",
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
	fallbackEstimateUsdPerSecond?: number;
}

export const MODEL_CAPABILITY_PROFILES: Record<
	VideoModelId,
	ModelCapabilityProfile
> = {
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
	},
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
	},
	"x-ai/grok-imagine-video-1.5": {
		id: "x-ai/grok-imagine-video-1.5",
		displayName: "Grok Imagine Video 1.5",
		description: "xAI Grok Imagine Video — flexible ratios (no audio flag on OpenRouter).",
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
		pricingNotes: "~$0.08–0.25/s by resolution (OpenRouter cents/sec).",
		fallbackEstimateUsdPerSecond: 0.14,
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
