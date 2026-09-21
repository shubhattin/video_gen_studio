/**
 * Main Prompt that is used along with the Shloka and Custom Instructions to generate the video scenes
 * Video Scenes are the final text which is used as the Video Prompt
 */
const _SINGLE_CLIP_PLANNER_INSTRUCTIONS = `
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
A general rule of thumb for the target duration (the one given in the user prompt, or the ideal duration you choose when none is given):
- 4–6s → 1–2 scenes
- 7–10s → 2–3 scenes
- 11–15s → 3–4 scenes
- 16–24s → 4–5 scenes
- 25–30s → 5–6 scenes
Prefer fewer denser scenes over many thin ones. Absolute maximum: 12.
When the user prompt gives an exact target length, match it. When it says duration is not specified, choose the duration first and match scene count to that choice.

## Aspect ratio
Respect the aspect ratio given in the user prompt when planning and composing scenes.

## Provider text budget
The videoScenes JSON will later be flattened into a single provider text prompt with the hard character limit given in the user prompt.
Write fields so the flattened prompt stays useful within that budget. Prefer density over long prose.
Never request text overlays, logos, watermarks, real live-action people or public figures unless specifically requested by the user (in the system prompt or user prompt).
`;

// this is only for the structured format(json) output, which we get from ai model
export const OUTPUT_SHAPE_INSTRUCTIONS = `
## Output shape
Always return \`kind: "single-clip"\` with:
- \`expectedIdealVideoDuration\`: Generate this first. A positive number of seconds, or null.
    When the user prompt says the target length is not specified, choose an ideal duration for this shloka (use the scene-count guide) and return that number.
    When the user prompt gives an exact target length, return null and follow that length.
	When the video model (like seedance-2.5) supports a higher limit for the duration then consider that utlize it properly for better visualization detailing.
- \`imagePrompt\`: one portrait-friendly reference still prompt. No character limit applies here — the reference-image generator (gpt-image-2) accepts long prompts, so write it as richly as needed;
- \`videoScenes\`: ordered cinematic scenes using the Seedance six-part fields.
- \`generalVideoInstructions\`: direct instructions placed at the top of the prompt sent to the video model (style, text-in-frame, photoreal vs illustrated). Follow the system prompt and the user prompt.
    By default (if neither asks otherwise) forbid text overlays, logos, watermarks, real live-action people, and public figures. Write this as direction to the video model, not as a note about the schema.
	keep this short and precice, no need to mention the like duration or aspect ratio and such things here
`;

export const SINGLE_CLIP_PLANNER_INSTRUCTIONS = `${_SINGLE_CLIP_PLANNER_INSTRUCTIONS}\n${OUTPUT_SHAPE_INSTRUCTIONS}`;