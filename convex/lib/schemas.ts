import { z } from "zod";
import {
	isVideoModelId,
	MODEL_CAPABILITY_PROFILES,
	type AspectRatio,
	type ResolutionLabel,
	type VideoModelId,
} from "./modelCatalog";

// actual schema used by ai to generate video scenes
export const videoSceneSchema = z.object({
	sceneNumber: z.int().positive(),
	intent: z.string().describe("Short scene title (what this scene conveys), also have a rough duration range in here at the start here eg. 0-5s. Keep in continous as the scene numeber progresses. And this is also generated in accordance with the provided total duration by the user for video"),
	subject: z.string(),
	action: z.string(),
	scene: z.string(),
	style: z.string(),
	camera: z.string(),
	audio: z
		.string()
		.nullable()
		.describe(
			"Sound / music / SFX direction for this beat. Return null unless the user prompt explicitly says Generate Audio Plans: Yes.",
		),
});

export const normalPlannerOutputSchema = z.object({
	kind: z.literal("single-clip"),
	expectedIdealVideoDuration: z
		.number()
		.positive()
		.nullable()
		.describe(
			"Ideal clip length in seconds when the user did not specify one. Null when the user prompt gives an exact target length.",
		),
	imagePrompt: z.string().min(20),
	videoScenes: z.array(videoSceneSchema).min(1).max(12),
	generalVideoInstructions: z
		.string()
		.min(1)
		.describe(
			"Direct video-model instructions prepended to the provider prompt. By default forbid text overlays, logos, watermarks, and photoreal people unless the user asked for them.",
		),
});

export type VideoScene = z.infer<typeof videoSceneSchema>;
export type NormalPlannerOutput = z.infer<typeof normalPlannerOutputSchema>;

export const videoParamsSchema = z.object({
	modelId: z.string(),
	aspectRatio: z.string(),
	resolution: z.string(),
	durationSeconds: z.number(),
	generateAudio: z.boolean().optional(),
	negativePrompt: z.string().optional(),
	cfgScale: z.number().optional(),
	prompt: z.string().optional(),
});

export type VideoParams = z.infer<typeof videoParamsSchema>;

/** Video config stored per plan — no raw prompt slot. */
export type PlanVideoConfig = Omit<VideoParams, "prompt"> & {
	/** When true, the planner chooses duration (expectedIdealVideoDuration). */
	generateDuration?: boolean;
};

export function planConfigFromParams(params: VideoParams): PlanVideoConfig {
	const { prompt: _prompt, ...rest } = params;
	return rest;
}

/** Config snapshot a plan was generated with (mirrors lastModelParamsUsed). */
export type LastModelParamsUsed = {
	modelId: string;
	aspectRatio: string;
	resolution: string;
	durationSeconds: number;
	generateAudio?: boolean;
	negativePrompt?: string;
	cfgScale?: number;
	maxPromptChars: number;
	/** True when the planner chose the duration instead of the user. */
	generateDuration?: boolean;
};

/** Nearest supported clip length. Ties prefer the longer option. */
export function snapDurationToSupported(
	requested: number,
	supported: readonly number[],
): number {
	if (supported.length === 0 || !Number.isFinite(requested)) {
		return requested;
	}
	if (supported.includes(requested)) {
		return requested;
	}
	let best = supported[0]!;
	let bestDist = Math.abs(requested - best);
	for (const duration of supported) {
		const dist = Math.abs(requested - duration);
		if (dist < bestDist || (dist === bestDist && duration > best)) {
			best = duration;
			bestDist = dist;
		}
	}
	return best;
}

/**
 * True when the user's current plan config diverges from the config the plan
 * was generated with. Divergent settings are NOT used for generation until
 * the plan is regenerated.
 */
export function planConfigDiverges(
	current: PlanVideoConfig,
	used:
		| Pick<
				LastModelParamsUsed,
				| "modelId"
				| "aspectRatio"
				| "resolution"
				| "durationSeconds"
				| "generateAudio"
				| "generateDuration"
		  >
		| null
		| undefined,
): boolean {
	if (!used) return false;
	return (
		current.modelId !== used.modelId ||
		current.aspectRatio !== used.aspectRatio ||
		current.resolution !== used.resolution ||
		current.durationSeconds !== used.durationSeconds ||
		Boolean(current.generateAudio) !== Boolean(used.generateAudio) ||
		Boolean(current.generateDuration) !== Boolean(used.generateDuration)
	);
}

export function validateVideoParams(params: VideoParams): VideoParams {
	if (!isVideoModelId(params.modelId)) {
		throw new Error(`Unsupported video model: ${params.modelId}`);
	}

	const profile = MODEL_CAPABILITY_PROFILES[params.modelId];

	if (!profile.aspectRatios.includes(params.aspectRatio as AspectRatio)) {
		throw new Error(
			`Aspect ratio ${params.aspectRatio} is not supported for ${params.modelId}.`,
		);
	}

	if (!profile.resolutions.includes(params.resolution as ResolutionLabel)) {
		throw new Error(
			`Resolution ${params.resolution} is not supported for ${params.modelId}.`,
		);
	}

	if (!profile.supportedDurations.includes(params.durationSeconds)) {
		throw new Error(
			`Duration must be one of ${profile.supportedDurations.join(", ")} seconds for ${params.modelId}.`,
		);
	}

	if (params.negativePrompt && !profile.supportsNegativePrompt) {
		throw new Error(`Negative prompts are not supported for ${params.modelId}.`);
	}

	if (params.generateAudio && !profile.supportsAudio) {
		throw new Error(`Audio generation is not supported for ${params.modelId}.`);
	}

	return {
		...params,
		generateAudio: profile.supportsAudio
			? (params.generateAudio ?? false)
			: false,
	};
}

export const imageConfigSchema = z.object({
	size: z.enum(["1024x1024", "1024x1536", "1536x1024"]),
	quality: z.enum(["low", "medium", "high", "auto"]),
});

export type ImageConfig = z.infer<typeof imageConfigSchema>;

export function defaultImageConfig(): ImageConfig {
	return { size: "1024x1536", quality: "medium" };
}

export function defaultVideoParams(modelId: VideoModelId): VideoParams {
	const profile = MODEL_CAPABILITY_PROFILES[modelId];
	const preferred = [8, 6, 5, 4].find((d) =>
		profile.supportedDurations.includes(d),
	);
	return {
		modelId,
		aspectRatio: profile.aspectRatios.includes("9:16")
			? "9:16"
			: profile.aspectRatios[0],
		resolution: profile.resolutions.includes("720p")
			? "720p"
			: profile.resolutions[0],
		durationSeconds: preferred ?? profile.supportedDurations[0],
		generateAudio: false,
	};
}
