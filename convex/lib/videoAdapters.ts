import type { ProviderOptions } from "@ai-sdk/provider-utils";
import {
	type VideoModelId,
	MODEL_CAPABILITY_PROFILES,
	resolutionToPixels,
} from "./modelCatalog";
import { type VideoParams, validateVideoParams } from "./schemas";

export interface AdaptedVideoRequest {
	prompt: string;
	aspectRatio: `${number}:${number}`;
	resolution: `${number}x${number}`;
	duration: number;
	fps?: number;
	generateAudio?: boolean;
	providerOptions?: ProviderOptions;
}

export function adaptVideoRequest(
	params: VideoParams,
	fallbackPrompt: string,
): AdaptedVideoRequest {
	const validated = validateVideoParams(params);
	const profile = MODEL_CAPABILITY_PROFILES[validated.modelId as VideoModelId];
	const aspectRatio = validated.aspectRatio as `${number}:${number}`;
	const resolution = resolutionToPixels(
		validated.resolution,
		validated.aspectRatio,
	) as `${number}x${number}`;

	const prompt = validated.prompt?.trim() || fallbackPrompt;

	const providerOptions: ProviderOptions = {};

	if (validated.negativePrompt?.trim() && profile.supportsNegativePrompt) {
		providerOptions.gateway = {
			...(providerOptions.gateway as Record<string, unknown> | undefined),
			negativePrompt: validated.negativePrompt.trim(),
		};
	}

	if (validated.klingMode && profile.supportsKlingMode) {
		providerOptions.gateway = {
			...(providerOptions.gateway as Record<string, unknown> | undefined),
			mode: validated.klingMode,
		};
	}

	return {
		prompt,
		aspectRatio,
		resolution,
		duration: validated.durationSeconds,
		fps: profile.fps,
		generateAudio: validated.generateAudio ?? false,
		providerOptions:
			Object.keys(providerOptions).length > 0 ? providerOptions : undefined,
	};
}

export function estimateVideoCostUsd(params: VideoParams): number | null {
	let validated: VideoParams;
	try {
		validated = validateVideoParams(params);
	} catch {
		return null;
	}
	const profile =
		MODEL_CAPABILITY_PROFILES[validated.modelId as VideoModelId];
	if (!profile.fallbackEstimateUsdPerSecond) {
		return null;
	}
	const audioMultiplier = validated.generateAudio ? 2 : 1;
	return (
		profile.fallbackEstimateUsdPerSecond *
		validated.durationSeconds *
		audioMultiplier
	);
}
