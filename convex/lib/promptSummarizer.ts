"use node";

import { generateText } from "ai";
import { VIDEO_PROMPT_SUMMARIZER_MODEL_ID } from "./modelCatalog";
import { VIDEO_PROMPT_SUMMARIZER_SYSTEM_PROMPT } from "./plannerPrompt";
import { getOpenRouterProvider } from "./providers";

const MAX_SUMMARIZE_ATTEMPTS = 3;

/**
 * Reusable prompt compressor — squeezes any video prompt to a hard char limit
 * using the luna summarizer model. Keeps shot plan, style, camera, audio.
 * Falls back to word-boundary hard truncate if the LLM cannot fit.
 */
export async function summarizePromptToLimit(
	prompt: string,
	maxChars: number,
): Promise<string> {
	const trimmed = prompt.trim();
	if (!trimmed) return trimmed;
	if (trimmed.length <= maxChars) return trimmed;
	const openrouter = getOpenRouterProvider();
	let current = trimmed;
	for (let attempt = 1; attempt <= MAX_SUMMARIZE_ATTEMPTS; attempt++) {
		const result = await generateText({
			model: openrouter(VIDEO_PROMPT_SUMMARIZER_MODEL_ID),
			reasoning: "none",
			instructions: VIDEO_PROMPT_SUMMARIZER_SYSTEM_PROMPT,
			prompt: [
				`Character limit: ${maxChars}`,
				`Current length: ${current.length}`,
				attempt > 1
					? `Previous attempt was still ${current.length} chars — compress more aggressively. Prefer shorter clauses; keep beat order.`
					: "Compress the following video prompt to fit the limit.",
				"",
				"PROMPT:",
				current,
			].join("\n"),
		});
		const next = result.text.replace(/^["'`\s]+|["'`\s]+$/g, "").trim();
		if (!next) continue;
		if (next.length <= maxChars && next.length < current.length) return next;
		if (next.length <= maxChars) return next;
		current = next.length < current.length ? next : current;
	}
	const fitted = current.slice(0, Math.max(1, maxChars - 1));
	const lastSpace = fitted.lastIndexOf(" ");
	const sliced =
		lastSpace > Math.floor(maxChars * 0.6) ? fitted.slice(0, lastSpace) : fitted;
	return `${sliced.trimEnd()}…`;
}
