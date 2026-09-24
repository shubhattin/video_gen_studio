import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env } from "../_generated/server";
import {
	LLM_REASONING_LEVEL,
	type LlmReasoningLevel,
} from "./modelCatalog";

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

/**
 * OpenRouter chat model with reasoning.effort set.
 *
 * The AI SDK top-level `reasoning: "low"` option is NOT forwarded by
 * `@openrouter/ai-sdk-provider` — only model settings / providerOptions
 * `openrouter.reasoning` reach the API. Use this helper for every
 * OpenRouter LLM call so Anthropic + OpenAI both get the same effort.
 */
export function openRouterChatModel(
	modelId: string,
	effort: LlmReasoningLevel = LLM_REASONING_LEVEL,
) {
	return getOpenRouterProvider()(modelId, {
		reasoning: { effort },
	});
}

/** `providerOptions` form of the same OpenRouter reasoning.effort setting. */
export function openRouterReasoningProviderOptions(
	effort: LlmReasoningLevel = LLM_REASONING_LEVEL,
) {
	return {
		openrouter: {
			reasoning: { effort },
		},
	} as const;
}
