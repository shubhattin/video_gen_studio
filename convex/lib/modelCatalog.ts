export const VIDEO_MODEL_IDS = [
	"alibaba/wan-2.6",
	"alibaba/wan-2.7",
	"bytedance/seedance-2.5",
	"bytedance/seedance-2.0",
	"bytedance/seedance-2.0-fast",
	"google/veo-3.1-lite",
	"kwaivgi/kling-v3.0-pro",
	"kwaivgi/kling-v3.0-std",
	"runway/gen-4.5",
] as const;

export type VideoModelId = (typeof VIDEO_MODEL_IDS)[number];

export type VideoModelFamily =
	| "google"
	| "bytedance"
	| "kling"
	| "alibaba"
	| "runway";

export const VIDEO_MODEL_FAMILY_META: Record<
	VideoModelFamily,
	{ label: string; order: number }
> = {
	google: { label: "Google", order: 1 },
	bytedance: { label: "ByteDance", order: 2 },
	kling: { label: "Kling", order: 3 },
	alibaba: { label: "Alibaba", order: 4 },
	runway: { label: "Runway", order: 5 },
};

export const PLANNER_MODEL_ID = "openai/gpt-5.6-sol";
// export const PLANNER_MODEL_ID = "anthropic/claude-fable-5";
/** Fast, no-reasoning model used to summarize a run into a short title. */
export const TITLE_MODEL_ID = "openai/gpt-5.6-luna";
/** Same luna model — compress over-limit provider video prompts. */
export const VIDEO_PROMPT_SUMMARIZER_MODEL_ID = TITLE_MODEL_ID;
export const REFERENCE_IMAGE_MODEL_ID = "gpt-image-2";
export const VIDEO_POLLING_INTERVAL = 4000;

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
		// Google publishes no hard prompt char cap for Veo (Gemini API Veo docs:
		// https://ai.google.dev/gemini-api/docs/veo — no length field). ~2,000
		// chars is the limit enforced across Veo-serving APIs / resellers.
		maxPromptChars: 2000,
		pricingNotes: "~$0.03–0.05/s silent · ~$0.05–0.08/s with audio.",
		fallbackEstimateUsdPerSecond: 0.05,
		fallbackEstimateUsdPerSecondWithAudio: 0.08,
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
		// BytePlus ModelArk (Seedance upstream): recommended ≤1,000 English
		// words / ≤500 Chinese chars; no hard char cap documented.
		// https://docs.byteplus.com/en/docs/ModelArk/1520757
		maxPromptChars: 4000,
		pricingNotes: "~$0.04/s (token-based OpenRouter pricing).",
		fallbackEstimateUsdPerSecond: 0.04035,
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
		// BytePlus ModelArk (Seedance upstream): recommended ≤1,000 English
		// words / ≤500 Chinese chars; no hard char cap documented.
		// https://docs.byteplus.com/en/docs/ModelArk/1520757
		maxPromptChars: 4000,
		pricingNotes: "Token-based OpenRouter pricing (~$0.07+/s depending on size).",
		fallbackEstimateUsdPerSecond: 0.07,
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
		// BytePlus ModelArk (Seedance upstream): recommended ≤1,000 English
		// words / ≤500 Chinese chars; no hard char cap documented.
		// https://docs.byteplus.com/en/docs/ModelArk/1520757
		maxPromptChars: 4000,
		pricingNotes:
			"~$0.103/s at 480p (token-based OpenRouter pricing; higher at larger sizes).",
		fallbackEstimateUsdPerSecond: 0.1028,
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

export function familyForVideoModel(modelId: VideoModelId): VideoModelFamily {
	return MODEL_CAPABILITY_PROFILES[modelId].family;
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
