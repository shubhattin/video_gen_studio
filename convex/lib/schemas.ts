import { z } from "zod";
import {
	isVideoModelId,
	MODEL_CAPABILITY_PROFILES,
	type AspectRatio,
	type ResolutionLabel,
	type VideoModelId,
} from "./modelCatalog";

/**
 * Seedance six-part scene beat.
 * Required: subject + action. Optional slots may be empty strings.
 */
export const videoSceneSchema = z.object({
	sceneNumber: z.number().int().positive(),
	intent: z.string().min(1),
	subject: z.string().min(1),
	action: z.string().min(1),
	scene: z.string(),
	style: z.string(),
	camera: z.string(),
	audio: z.string(),
});

export const normalPlannerOutputSchema = z.object({
	kind: z.literal("single-clip"),
	imagePrompt: z.string().min(20),
	videoScenes: z.array(videoSceneSchema).min(1).max(12),
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
export type PlanVideoConfig = Omit<VideoParams, "prompt">;

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
};

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
				"modelId" | "aspectRatio" | "resolution" | "durationSeconds"
		  >
		| null
		| undefined,
): boolean {
	if (!used) return false;
	return (
		current.modelId !== used.modelId ||
		current.aspectRatio !== used.aspectRatio ||
		current.resolution !== used.resolution ||
		current.durationSeconds !== used.durationSeconds
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
