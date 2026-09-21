/**
 * Main Prompt that is used along with the Shloka and Custom Instructions to generate the video scenes
 * Video Scenes are the final text which is used as the Video Prompt
 */
export const SINGLE_CLIP_PLANNER_INSTRUCTIONS = `
## Output shape
Always return \`kind: "single-clip"\` with:
- \`imagePrompt\`: one portrait-friendly reference still prompt. No character limit applies here — the reference-image generator (gpt-image-2) accepts long prompts, so write it as richly as needed;
- \`videoScenes\`: ordered cinematic scenes using the Seedance six-part fields.

## Image Prompt Generation Instructions
- Follow the aesthetic instructions as above in ths system or as requested by the user down below.
- Do not mess up geneders of characters or dieties.
- If no specifc image instructions provided then follow : Follow a warm aesthetic indian tone fitting of the shloka and other text given.
- A general rule would to have aesthetics, symmetry and proper which makes the image look good. This is genral guideline which should be good to have.

## videoScenes schema
- \`sceneNumber\`: 1-based consecutive.
- \`intent\`: short scene title (what this scene conveys), also have a rough duration range in here at the start here eg. 0-5s
- \`subject\`: who/what appears (required)
- \`action\`: what happens (required)
- \`scene\`: environment / setting (optional; use "" if unused)
- \`style\`: visual style, lighting, palette (optional; use "" if unused)
- \`camera\`: camera move / cut (optional; use "" if unused)
- \`audio\`: sound / music / SFX direction. ONLY include this field when the user prompt explicitly says "Generate Audio Plans: Yes"; otherwise omit it entirely from every beat (null value).

Keep each field concise (one tight sentence or less). Do not pad optional fields.

## Scene count vs duration
A general rule of thumb for the target duration given in the user prompt:
- 4–6s → 1–2 scenes
- 7–10s → 2–3 scenes
- 11–15s → 3–4 scenes
- 16–24s → 4–5 scenes
- 25–30s → 5–6 scenes
Prefer fewer denser scenes over many thin ones. Absolute maximum: 12. Match the exact target duration provided in the user prompt.

## Aspect ratio
Respect the aspect ratio given in the user prompt when planning and composing scenes.

## Provider text budget
The videoScenes JSON will later be flattened into a single provider text prompt with the hard character limit given in the user prompt.
Write fields so the flattened prompt stays useful within that budget. Prefer density over long prose.
Never request text overlays, logos, watermarks, real live-action people or public figures.
`;

import { z } from "zod";

// actual schema used by ai to generate video scenes
export const videoSceneSchema = z.object({
	sceneNumber: z.number().int().positive(),
	intent: z.string().min(1).describe("Short scene title (what this scene conveys), also have a rough duration range in here at the start here eg. 0-5s. Keep in continous as the scene numeber progresses. And this is also generated in accordance with the provided total duration by the user for video"),
	subject: z.string().min(1),
	action: z.string().min(1),
	scene: z.string(),
	style: z.string(),
	camera: z.string(),
	audio: z
		.string()
		.nullable()
		.describe(
			"Sound / music / SFX direction for this beat. Return null unless the user prompt explicitly says Generate Audio Plans: Yes.",
		),
});