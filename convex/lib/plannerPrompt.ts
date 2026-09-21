import type { Id } from "../_generated/dataModel";
import { SINGLE_CLIP_PLANNER_INSTRUCTIONS } from "./prompts/main_video_scene";
export * from "./prompts/scene_summary";
export * from "./prompts/main_video_scene";

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
1) one portrait-friendly reference-image prompt (\`imagePrompt\`), and
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


/** @deprecated Use SINGLE_CLIP_PLANNER_INSTRUCTIONS — kept for backwards compat, now constant. */
export function singleClipPlannerInstructions(
	_args?: unknown,
): string {
	return SINGLE_CLIP_PLANNER_INSTRUCTIONS;
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

/** Full system string for Shloka planning: creative base + output-shape appendix. Constant for prompt caching. */
export function buildShlokaPlannerSystemPrompt(args: {
	stored?: string | null;
	/** @deprecated Ignored — kept for backwards compat. System prompt is now constant for caching. */
	singleClip?: unknown;
}) {
	const base = resolvePlannerSystemPrompt(args.stored);
	return `${base}\n\n${SINGLE_CLIP_PLANNER_INSTRUCTIONS}`;
}
