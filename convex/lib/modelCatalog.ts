export const VIDEO_MODEL_IDS = [
	"bytedance/seedance-2.5",
	"google/veo-3.1-generate-001",
	"klingai/kling-v3.0-i2v",
] as const;

export type VideoModelId = (typeof VIDEO_MODEL_IDS)[number];

export const PLANNER_MODEL_ID = "openai/gpt-5.6-terra";
export const REFERENCE_IMAGE_MODEL_ID = "gpt-image-2";

export type AspectRatio = "16:9" | "9:16" | "1:1";
export type ResolutionLabel = "480p" | "720p" | "1080p";
export type ImageQuality = "low" | "medium" | "high" | "auto";
export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";
export type KlingMode = "std" | "pro";

export interface ModelCapabilityProfile {
	id: VideoModelId;
	displayName: string;
	description: string;
	requiresFirstFrame: boolean;
	supportsTextToVideo: boolean;
	aspectRatios: AspectRatio[];
	resolutions: ResolutionLabel[];
	durationSeconds: { min: number; max: number; step: number; presets?: number[] };
	fps?: number;
	supportsAudio: boolean;
	audioBeta?: boolean;
	supportsNegativePrompt?: boolean;
	supportsKlingMode?: boolean;
	pricingNotes: string;
	fallbackEstimateUsdPerSecond?: number;
}

export const MODEL_CAPABILITY_PROFILES: Record<
	VideoModelId,
	ModelCapabilityProfile
> = {
	"bytedance/seedance-2.5": {
		id: "bytedance/seedance-2.5",
		displayName: "Seedance 2.5",
		description:
			"ByteDance reference/first-frame video with 480p/720p output. Token-based Gateway pricing.",
		requiresFirstFrame: true,
		supportsTextToVideo: false,
		aspectRatios: ["16:9", "9:16"],
		resolutions: ["480p", "720p"],
		durationSeconds: { min: 4, max: 30, step: 1 },
		fps: 24,
		supportsAudio: true,
		pricingNotes:
			"Gateway token pricing (~$10.70/M video tokens without input, ~$6.40/M with one image input).",
	},
	"google/veo-3.1-generate-001": {
		id: "google/veo-3.1-generate-001",
		displayName: "Veo 3.1",
		description:
			"Google Veo 3.1 text or image-to-video with 4/6/8 second clips at 720p or 1080p.",
		requiresFirstFrame: false,
		supportsTextToVideo: true,
		aspectRatios: ["16:9", "9:16"],
		resolutions: ["720p", "1080p"],
		durationSeconds: { min: 4, max: 8, step: 2, presets: [4, 6, 8] },
		fps: 24,
		supportsAudio: true,
		audioBeta: true,
		pricingNotes: "~$0.20/s silent or ~$0.40/s with audio (public estimate).",
		fallbackEstimateUsdPerSecond: 0.2,
	},
	"klingai/kling-v3.0-i2v": {
		id: "klingai/kling-v3.0-i2v",
		displayName: "Kling v3.0 I2V",
		description:
			"Kling image-to-video with std/pro quality, optional audio, and negative prompts.",
		requiresFirstFrame: true,
		supportsTextToVideo: false,
		aspectRatios: ["16:9", "9:16", "1:1"],
		resolutions: ["720p", "1080p"],
		durationSeconds: { min: 3, max: 15, step: 1 },
		fps: 30,
		supportsAudio: true,
		supportsNegativePrompt: true,
		supportsKlingMode: true,
		pricingNotes:
			"Std ~$0.168–0.308/s and pro ~$0.224–0.392/s depending on audio (public estimates).",
		fallbackEstimateUsdPerSecond: 0.224,
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

export function resolutionToPixels(
	label: ResolutionLabel,
	aspectRatio: AspectRatio,
): string {
	const height =
		label === "480p" ? 480 : label === "720p" ? 720 : 1080;
	const [wRatio, hRatio] = aspectRatio.split(":").map(Number);
	if (!wRatio || !hRatio) {
		return `${height}x${height}`;
	}
	const width = Math.round((height * wRatio) / hRatio);
	return `${width}x${height}`;
}
