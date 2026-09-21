/**
 * Expected context:
 * - shlokaText: string (required)
 * - customInstructions?: string
 * - aspectRatio?: string
 * - durationSeconds?: number (omit when generateDuration is true)
 * - generateDuration?: boolean
 * - maxDurationSeconds?: number (model maximum, used when generateDuration is true)
 * - maxPromptChars?: number
 * - generateAudio?: boolean
 */
export const USER_BASE_PROMPT_TEMPLATE = `## Shloka
Preserve meaning; do not replace with an invented translation unless asked.
"""
{{shlokaText}}
"""

{{#if customInstructions}}
## Custom instructions (hard constraints)
"""
{{customInstructions}}
"""
{{else}}
## Custom instructions
none — default to warm Indian devotional atmosphere.
{{/if}}

## Generation constraints
{{#if aspectRatio}}
- Aspect ratio: {{aspectRatio}}
{{/if~}}
{{~#if generateDuration}}
- Target video length: not specified. Choose an ideal duration for this shloka{{#if maxDurationSeconds}} of at most {{maxDurationSeconds}} seconds (the maximum this video model allows){{/if}}. Return it as expectedIdealVideoDuration, and size the scene count to that duration.
{{else if durationSeconds}}
- Target video length: {{durationSeconds}} seconds (modulate beat count to fit). Set expectedIdealVideoDuration to null.
{{/if~}}
{{~#if maxPromptChars}}
- Provider video prompt character limit: {{maxPromptChars}} (videoScenes will be flattened into one text prompt; stay concise and pricise but details that would enrich video scene should not be cut down either).
{{/if}}
- Generate Audio Plans: {{#if generateAudio}}Yes{{else}}No{{/if}}
`;
