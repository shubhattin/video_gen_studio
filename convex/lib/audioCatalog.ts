/**
 * Audio-output (music) models on OpenRouter — chat completions with
 * `modalities: ["text", "audio"]` and `stream: true`. Verified response
 * shape for Lyria: streamed base64 MP3 (44.1 kHz stereo) in
 * `delta.audio.data`, timed lyrics / `<instrumental>` in `delta.content`,
 * cost on the final chunk's `usage.cost`.
 */
export const AUDIO_MODEL_IDS = [
	"google/lyria-3-pro-preview",
	"google/lyria-3-clip-preview",
] as const;

export type AudioModelId = (typeof AUDIO_MODEL_IDS)[number];

export interface AudioModelProfile {
	id: AudioModelId;
	displayName: string;
	description: string;
	family: "google";
	/** Fixed output length (Lyria Clip). */
	fixedDurationSeconds?: number;
	/** Length can be steered from the prompt (Lyria Pro). */
	supportsTargetDuration: boolean;
	minTargetDurationSeconds?: number;
	maxTargetDurationSeconds?: number;
	defaultTargetDurationSeconds?: number;
	maxInputImages: number;
	/** Shown only behind the "Pricing" info popover. */
	pricingNotes: string;
}

export const AUDIO_MODEL_PROFILES: Record<AudioModelId, AudioModelProfile> = {
	"google/lyria-3-pro-preview": {
		id: "google/lyria-3-pro-preview",
		displayName: "Lyria 3 Pro",
		description:
			"Full songs with verses, choruses and bridges. Length is steered from the prompt.",
		family: "google",
		supportsTargetDuration: true,
		minTargetDurationSeconds: 30,
		maxTargetDurationSeconds: 180,
		defaultTargetDurationSeconds: 60,
		maxInputImages: 10,
		pricingNotes: "$0.08 per song",
	},
	"google/lyria-3-clip-preview": {
		id: "google/lyria-3-clip-preview",
		displayName: "Lyria 3 Clip",
		description: "Always 30 seconds — short clips, loops and quick previews.",
		family: "google",
		fixedDurationSeconds: 30,
		supportsTargetDuration: false,
		maxInputImages: 10,
		pricingNotes: "$0.04 per 30-second clip",
	},
};

export const DEFAULT_AUDIO_MODEL_ID: AudioModelId = "google/lyria-3-pro-preview";

/** Scripter (prep layer) model — same Opus as the Shloka planner. */
export { PLANNER_MODEL_ID as AUDIO_SCRIPT_MODEL_ID } from "./modelCatalog";

export function isAudioModelId(value: string): value is AudioModelId {
	return (AUDIO_MODEL_IDS as readonly string[]).includes(value);
}

export type AudioParams = {
	modelId: string;
	/** Legacy: only present on takes made with the removed GPT Audio model. */
	voice?: string;
	targetDurationSeconds?: number;
	instrumental?: boolean;
};

export function defaultAudioParams(modelId: AudioModelId): AudioParams {
	const profile = AUDIO_MODEL_PROFILES[modelId];
	return {
		modelId,
		targetDurationSeconds: profile.defaultTargetDurationSeconds,
		instrumental: false,
	};
}

/** Drop settings the model can't use; clamp target length into range. */
export function normalizeAudioParams(params: AudioParams): AudioParams {
	if (!isAudioModelId(params.modelId)) {
		throw new Error("Select a supported audio model.");
	}
	const profile = AUDIO_MODEL_PROFILES[params.modelId];
	let targetDurationSeconds: number | undefined;
	if (profile.supportsTargetDuration) {
		const raw =
			params.targetDurationSeconds ?? profile.defaultTargetDurationSeconds;
		targetDurationSeconds =
			raw === undefined
				? undefined
				: Math.round(
						Math.min(
							profile.maxTargetDurationSeconds ?? raw,
							Math.max(profile.minTargetDurationSeconds ?? raw, raw),
						),
					);
	}
	return {
		modelId: params.modelId,
		targetDurationSeconds,
		instrumental: params.instrumental === true,
	};
}

/**
 * Like normalizeAudioParams, but runs saved on a since-removed model (e.g.
 * GPT Audio) fall back to the default model instead of failing.
 */
export function resolveAudioParams(params: AudioParams): AudioParams {
	if (!isAudioModelId(params.modelId)) {
		return defaultAudioParams(DEFAULT_AUDIO_MODEL_ID);
	}
	return normalizeAudioParams(params);
}
