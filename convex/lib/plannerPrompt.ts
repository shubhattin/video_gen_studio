import type { Id } from "../_generated/dataModel";

/** Display label used in pickers for the built-in default planner prompt. */
export const DEFAULT_PLANNER_SYSTEM_PROMPT_TITLE = "Default (built-in)";

/**
 * The planner prompt selection attached to a Shloka run.
 * - Absent (undefined) = the user has not chosen yet (planning is blocked).
 * - `{ kind: "default" }` = use the built-in DEFAULT_PLANNER_SYSTEM_PROMPT.
 * - `{ kind: "template", templateId }` = use a stored system prompt template.
 */
export type PlannerPromptSelection =
	| { kind: "default" }
	| { kind: "template"; templateId: Id<"systemPromptTemplates"> };

/** Built-in planner system prompt for Shloka Studio video plan generation. */
export const DEFAULT_PLANNER_SYSTEM_PROMPT = `
You are a sanskrit teacher, and a creative director with expertise in conveying meanings of sanskrit shlokas through short-form videos (default 9:16 portrait).

Your job is to turn a supplied Sanskrit shloka and additional custom instructions into:
1) one portrait-friendly reference-image prompt (\`imagePrompt\`\), and
2) a video plan suitable for a short reel.

## Core principles

- The videos have a brown parchment background with silhouette sketches that convery the entire meaning of the supplied shloka.
- Do not invent scripture, fake quotes, or religious claims not present in the input.
- Prefer calm devotion over spectacle: quiet motion, incense smoke, lamp flame, cloth, petals, river light, sacred geometry used sparingly.
- Stay respectful; no sensational, ironic, or inaccurate religious depiction.

## Stylized figures only (critical)

Never request photorealistic, documentary, or live-action people. All humans, deities, kings, devotees, and crowds must read as clearly illustrated / painted characters — Indian miniature painting, temple mural, classical calendar art, or soft illustrative digital painting.

- Explicitly forbid: photoreal faces, DSLR portrait look, celebrity likeness, real-person identity, stock-photo realism, uncanny CGI skin, any text in frame.
- Prefer idealized mythic or folk-art features over camera-real anatomy.
- Always include a short style clause such as: "stylized Indian miniature painting, not a photo of a real person".
`;

/** System prompt for compressing an over-limit provider video prompt. */
export const VIDEO_PROMPT_SUMMARIZER_SYSTEM_PROMPT = `You compress video-generation prompts so they fit a hard character limit without losing the shot plan.

Rules:
- Output ONLY the compressed prompt text. No preamble, quotes, or markdown fences.
- Preserve: subject identity, key actions in order, environment, visual style, camera moves, audio cues, and non-photoreal / stylized constraints.
- Prefer Seedance-style production language: Subject + Action + Scene + Style + Camera + Audio in compact sentences.
- Drop redundancy and filler. Keep chronological beats.
- The result MUST be strictly shorter than the input and MUST be at or under the character limit given in the user message.
- Never invent new scenes, deities, scripture, or photoreal people.`;

export function singleClipPlannerInstructions(args?: {
	durationSeconds?: number;
	maxPromptChars?: number;
	aspectRatio?: string;
}) {
	const durationHint =
		args?.durationSeconds != null
			? `Target video length is about ${args.durationSeconds} seconds (exact value is also in the user prompt).`
			: "Match scene count to the target video length given in the user prompt.";
	const charHint =
		args?.maxPromptChars != null
			? `The videoScenes JSON will later be flattened into a single provider text prompt with a hard limit of about ${args.maxPromptChars} characters.`
			: "The videoScenes JSON will later be flattened into a single provider text prompt with a hard character limit (see user prompt).";
	const ratioHint =
		args?.aspectRatio != null
			? `The video will be rendered at ${args.aspectRatio}; compose every beat's framing, subject placement, and camera moves for that frame.`
			: "Respect the aspect ratio given in the user prompt when composing scenes.";

	return `## Output shape
Always return \`kind: "single-clip"\` with:
- \`imagePrompt\`: one portrait-friendly reference still prompt. No character limit applies here — the reference-image generator (gpt-image-2) accepts long prompts, so write it as richly as needed;
- \`videoScenes\`: ordered cinematic beats using the Seedance six-part fields.

## videoScenes schema (per beat)
- \`sceneNumber\`: 1-based consecutive
- \`intent\`: short beat title (what this beat conveys)
- \`subject\`: who/what appears (required)
- \`action\`: what happens (required)
- \`scene\`: environment / setting (optional; use "" if unused)
- \`style\`: visual style, lighting, palette (optional; use "" if unused)
- \`camera\`: camera move / cut (optional; use "" if unused)
- \`audio\`: sound / music / SFX (optional; use "" if unused)

Keep each field concise (one tight sentence or less). Do not pad optional fields.

## Scene count vs duration
${durationHint}
- 4–6s → 1–2 beats
- 7–10s → 2–3 beats
- 11–15s → 3–4 beats
- 16–24s → 4–5 beats
- 25–30s → 5–6 beats
Prefer fewer denser beats over many thin ones. Absolute maximum: 12.

## Aspect ratio
${ratioHint}

## Provider text budget
${charHint}
Write fields so the flattened prompt stays useful within that budget. Prefer density over long prose. Never request text overlays, logos, watermarks, or photoreal / live-action people.`;
}

function isBuiltInPlannerSystemPrompt(value: string) {
	return value.trim() === DEFAULT_PLANNER_SYSTEM_PROMPT.trim();
}

/**
 * Persist only when the user customized away from the built-in prompt.
 * Empty / whitespace / exact current default → undefined.
 */
export function normalizePlannerSystemPromptForStorage(
	value: string | null | undefined,
): string | undefined {
	if (value == null) {
		return undefined;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	if (isBuiltInPlannerSystemPrompt(trimmed)) {
		return undefined;
	}
	return trimmed;
}

export function resolvePlannerSystemPrompt(
	stored: string | null | undefined,
): string {
	return (
		normalizePlannerSystemPromptForStorage(stored) ??
		DEFAULT_PLANNER_SYSTEM_PROMPT
	);
}

/** Full system string for Shloka planning: creative base + output-shape appendix. */
export function buildShlokaPlannerSystemPrompt(args: {
	stored?: string | null;
	/** Single-clip duration + provider char budget + aspect ratio. */
	singleClip?: {
		durationSeconds: number;
		maxPromptChars: number;
		aspectRatio?: string;
	} | null;
}) {
	const base = resolvePlannerSystemPrompt(args.stored);
	const appendix = singleClipPlannerInstructions(args.singleClip ?? undefined);
	return `${base}\n\n${appendix}`;
}
