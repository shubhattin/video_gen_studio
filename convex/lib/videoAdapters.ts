import type {
	OpenRouterFrameImage,
	OpenRouterInputReference,
	OpenRouterVideoSubmitBody,
} from "./openrouterVideo";
import {
	MODEL_CAPABILITY_PROFILES,
	type VideoModelId,
} from "./modelCatalog";
import { type VideoParams, validateVideoParams } from "./schemas";

export type AdaptedOpenRouterVideoRequest = {
	body: OpenRouterVideoSubmitBody;
	warnings: string[];
};

/** Fit prompt under provider limits (Kling rejects >2500 chars). */
export function fitPromptToLimit(
	prompt: string,
	maxChars: number,
): { prompt: string; truncated: boolean } {
	const trimmed = prompt.trim();
	if (trimmed.length <= maxChars) {
		return { prompt: trimmed, truncated: false };
	}
	const budget = Math.max(1, maxChars - 1);
	let sliced = trimmed.slice(0, budget);
	const lastSpace = sliced.lastIndexOf(" ");
	if (lastSpace > Math.floor(budget * 0.6)) {
		sliced = sliced.slice(0, lastSpace);
	}
	return { prompt: `${sliced.trimEnd()}…`, truncated: true };
}

export function adaptOpenRouterVideoRequest(args: {
	params: VideoParams;
	fallbackPrompt: string;
	firstFrameUrl?: string | null;
	lastFrameUrl?: string | null;
	referenceUrls?: string[];
}): AdaptedOpenRouterVideoRequest {
	const validated = validateVideoParams(args.params);
	const profile = MODEL_CAPABILITY_PROFILES[validated.modelId as VideoModelId];
	const warnings: string[] = [];
	const rawPrompt = validated.prompt?.trim() || args.fallbackPrompt;
	const fitted = fitPromptToLimit(rawPrompt, profile.maxPromptChars);
	const prompt = fitted.prompt;
	if (fitted.truncated) {
		warnings.push(
			`Prompt truncated to ${profile.maxPromptChars} characters for ${validated.modelId}.`,
		);
	}

	if (profile.requiresFirstFrame && !args.firstFrameUrl) {
		throw new Error("This model requires a first-frame reference image.");
	}

	const frame_images: OpenRouterFrameImage[] = [];
	if (args.firstFrameUrl) {
		if (!profile.supportsFirstFrame) {
			warnings.push("First-frame image ignored — model does not support it.");
		} else {
			frame_images.push({
				type: "image_url",
				image_url: { url: args.firstFrameUrl },
				frame_type: "first_frame",
			});
		}
	}
	if (args.lastFrameUrl) {
		if (!profile.supportsLastFrame) {
			warnings.push("Last-frame image ignored — model does not support it.");
		} else {
			frame_images.push({
				type: "image_url",
				image_url: { url: args.lastFrameUrl },
				frame_type: "last_frame",
			});
		}
	}

	let input_references: OpenRouterInputReference[] | undefined;
	const refs = (args.referenceUrls ?? []).filter(Boolean);
	if (refs.length > 0) {
		if (!profile.supportsInputReferences) {
			warnings.push("Extra reference images ignored — model does not support input_references.");
		} else {
			const capped = refs.slice(0, profile.maxInputReferences);
			if (refs.length > profile.maxInputReferences) {
				warnings.push(
					`Only the first ${profile.maxInputReferences} reference images were sent.`,
				);
			}
			input_references = capped.map((url) => ({
				type: "image_url" as const,
				image_url: { url },
			}));
		}
	}

	const body: OpenRouterVideoSubmitBody = {
		model: validated.modelId,
		prompt,
		duration: validated.durationSeconds,
		resolution: validated.resolution,
		aspect_ratio: validated.aspectRatio,
	};

	if (profile.supportsAudio) {
		body.generate_audio = validated.generateAudio ?? false;
	}

	if (frame_images.length > 0) {
		body.frame_images = frame_images;
	} else if (input_references?.length) {
		body.input_references = input_references;
	}

	// If both frames and refs: OpenRouter says frame_images takes precedence.
	// Still attach refs for Seedance when no frames? Already handled.
	// When frames exist and Seedance supports refs, prefer frames only (API rule).
	if (frame_images.length > 0 && input_references?.length) {
		warnings.push(
			"Extra style references were skipped because first/last frames take precedence on OpenRouter.",
		);
	}

	const providerParameters: Record<string, unknown> = {};
	if (validated.negativePrompt?.trim() && profile.supportsNegativePrompt) {
		if (validated.modelId.startsWith("google/")) {
			providerParameters.negativePrompt = validated.negativePrompt.trim();
		} else if (validated.modelId.startsWith("kwaivgi/")) {
			providerParameters.negative_prompt = validated.negativePrompt.trim();
		}
	}
	if (
		validated.cfgScale != null &&
		profile.passthroughParams.includes("cfg_scale")
	) {
		providerParameters.cfg_scale = validated.cfgScale;
	}

	if (Object.keys(providerParameters).length > 0) {
		const providerSlug = validated.modelId.startsWith("google/")
			? "google-vertex"
			: validated.modelId.startsWith("kwaivgi/")
				? "kwaivgi"
				: validated.modelId.split("/")[0];
		body.provider = {
			options: {
				[providerSlug]: { parameters: providerParameters },
			},
		};
	}

	return { body, warnings };
}

export function estimateVideoCostUsd(params: VideoParams): number | null {
	let validated: VideoParams;
	try {
		validated = validateVideoParams(params);
	} catch {
		return null;
	}
	const profile = MODEL_CAPABILITY_PROFILES[validated.modelId as VideoModelId];
	if (!profile.fallbackEstimateUsdPerSecond) {
		return null;
	}
	const audioMultiplier =
		validated.generateAudio && profile.supportsAudio ? 2 : 1;
	return (
		profile.fallbackEstimateUsdPerSecond *
		validated.durationSeconds *
		audioMultiplier
	);
}
