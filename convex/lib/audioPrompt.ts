import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import {
	AUDIO_MODEL_PROFILES,
	type AudioParams,
	isAudioModelId,
} from "./audioCatalog";
import {
	AUDIO_SCRIPT_OUTPUT_INSTRUCTIONS,
	DEFAULT_AUDIO_SYSTEM_PROMPT,
} from "./prompts/audio_song";

export * from "./prompts/audio_song";

/** Display label used in pickers for the built-in default audio prompt. */
export const DEFAULT_AUDIO_SYSTEM_PROMPT_TITLE = "Default Sanskrit song (built-in)";

export type AudioPromptSelection =
	| { kind: "default" }
	| { kind: "template"; templateId: Id<"systemPromptTemplates"> };

/** Structured output the scripter (Opus) returns. */
export const audioScriptOutputSchema = z.object({
	title: z.string().min(1),
	styleDirection: z
		.string()
		.min(1)
		.describe(
			"Music direction: genre, rāga mood, instruments, tempo, vocals, arc. Do not repeat the lyrics.",
		),
	lyrics: z
		.string()
		.describe(
			"Section-tagged Devanagari lyrics, or empty for instrumental.",
		),
	pronunciationNotes: z
		.string()
		.nullable()
		.describe("Short Sanskrit pronunciation / breathing notes, or null."),
});

export type AudioScriptOutput = z.infer<typeof audioScriptOutputSchema>;

export type AudioScript = {
	title: string;
	styleDirection: string;
	lyrics: string;
	pronunciationNotes?: string;
};

/** Full scripter system string: creative base + output contract. */
export function buildAudioScripterSystemPrompt(stored?: string | null) {
	const base = stored?.trim() || DEFAULT_AUDIO_SYSTEM_PROMPT;
	return `${base}\n\n${AUDIO_SCRIPT_OUTPUT_INSTRUCTIONS}`;
}

/**
 * Flatten an edited script + run settings into the single prompt sent to the
 * audio model. Pure — shared by the backend (generation) and the UI preview.
 */
export function buildAudioProviderPrompt(
	script: AudioScript,
	params: AudioParams,
): string {
	const profile = isAudioModelId(params.modelId)
		? AUDIO_MODEL_PROFILES[params.modelId]
		: null;
	const notes = script.pronunciationNotes?.trim();
	const direction = script.styleDirection.trim();
	const lyrics = script.lyrics.trim();

	const instrumental = params.instrumental === true || !lyrics;
	const lengthLine = profile?.fixedDurationSeconds
		? null
		: params.targetDurationSeconds
			? `Length: about ${params.targetDurationSeconds} seconds.`
			: null;
	return [
		`Title: ${script.title.trim()}`,
		direction,
		lengthLine,
		instrumental ? "Instrumental only, no vocals." : null,
		!instrumental && notes ? `Sanskrit pronunciation: ${notes}` : null,
		!instrumental ? "" : null,
		!instrumental ? "Lyrics (Sanskrit, Devanagari):" : null,
		!instrumental ? lyrics : null,
	]
		.filter((line) => line !== null)
		.join("\n")
		.trim();
}
