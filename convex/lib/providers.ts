import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env } from "../_generated/server";

function normalizeSecret(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function requireEnv(name: string, value: string | undefined): string {
	const normalized = normalizeSecret(value);
	if (!normalized) {
		throw new Error(
			`${name} is not configured in the Convex deployment environment. Set it with: bunx convex env set ${name}`,
		);
	}
	return normalized;
}

export function getOpenRouterApiKey() {
	return requireEnv("OPENROUTER_API_KEY", env.OPENROUTER_API_KEY);
}

export function getOpenAIProvider() {
	return createOpenAI({
		apiKey: requireEnv("OPENAI_API_KEY", env.OPENAI_API_KEY),
	});
}

export function getOpenRouterProvider() {
	return createOpenRouter({
		apiKey: getOpenRouterApiKey(),
	});
}

export function getVideoProcessorUrl() {
	return requireEnv("VIDEO_PROCESSOR_URL", env.VIDEO_PROCESSOR_URL).replace(
		/\/$/,
		"",
	);
}

export function getVideoProcessorSecret() {
	return requireEnv(
		"VIDEO_PROCESSOR_SHARED_SECRET",
		env.VIDEO_PROCESSOR_SHARED_SECRET,
	);
}
