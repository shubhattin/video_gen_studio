import { z } from "zod";
import {
	isVideoModelId,
	MODEL_CAPABILITY_PROFILES,
	type AspectRatio,
	type ResolutionLabel,
	type VideoModelId,
} from "./modelCatalog";

export const videoSceneSchema = z.object({
	sceneNumber: z.number().int().positive(),
	intent: z.string().min(1),
	subjects: z.string().min(1),
	locationTime: z.string().min(1),
	composition: z.string().min(1),
	lensCamera: z.string().min(1),
	lighting: z.string().min(1),
	paletteAesthetics: z.string().min(1),
	actionMotion: z.string().min(1),
	soundDirection: z.string().min(1),
	transition: z.string().min(1),
	negativeConstraints: z.string().min(1),
});

export const plannerOutputSchema = z.object({
	imagePrompt: z.string().min(20),
	videoScenes: z.array(videoSceneSchema).min(1).max(12),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
export type VideoScene = z.infer<typeof videoSceneSchema>;

export const videoParamsSchema = z.object({
	modelId: z.string(),
	aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
	resolution: z.enum(["480p", "720p", "1080p"]),
	durationSeconds: z.number(),
	generateAudio: z.boolean().optional(),
	negativePrompt: z.string().optional(),
	klingMode: z.enum(["std", "pro"]).optional(),
	prompt: z.string().optional(),
});

export type VideoParams = z.infer<typeof videoParamsSchema>;

export function validateVideoParams(params: VideoParams): VideoParams {
	if (!isVideoModelId(params.modelId)) {
		throw new Error(`Unsupported video model: ${params.modelId}`);
	}

	const profile = MODEL_CAPABILITY_PROFILES[params.modelId as VideoModelId];

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

	const { min, max, step, presets } = profile.durationSeconds;
	if (presets && !presets.includes(params.durationSeconds)) {
		throw new Error(
			`Duration must be one of ${presets.join(", ")} seconds for ${params.modelId}.`,
		);
	} else if (
		params.durationSeconds < min ||
		params.durationSeconds > max ||
		params.durationSeconds % step !== 0
	) {
		throw new Error(
			`Duration must be between ${min} and ${max} seconds (step ${step}) for ${params.modelId}.`,
		);
	}

	if (params.negativePrompt && !profile.supportsNegativePrompt) {
		throw new Error(`Negative prompts are not supported for ${params.modelId}.`);
	}

	if (params.klingMode && !profile.supportsKlingMode) {
		throw new Error(`Quality mode is not supported for ${params.modelId}.`);
	}

	if (params.generateAudio && !profile.supportsAudio) {
		throw new Error(`Audio generation is not supported for ${params.modelId}.`);
	}

	return params;
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
	const duration = profile.durationSeconds.presets?.[0] ?? profile.durationSeconds.min;
	return {
		modelId,
		aspectRatio: profile.aspectRatios.includes("9:16") ? "9:16" : profile.aspectRatios[0],
		resolution: profile.resolutions.includes("720p")
			? "720p"
			: profile.resolutions[0],
		durationSeconds: duration,
		generateAudio: false,
		klingMode: profile.supportsKlingMode ? "std" : undefined,
	};
}
