import {
	DEFAULT_AUDIO_SYSTEM_PROMPT,
	DEFAULT_AUDIO_SYSTEM_PROMPT_TITLE,
} from "#/lib/audio-catalog";
import {
	DEFAULT_PLANNER_SYSTEM_PROMPT,
	DEFAULT_PLANNER_SYSTEM_PROMPT_TITLE,
	type PromptTemplateKind,
} from "#/lib/planner-prompt";

/** Built-in default prompt per studio kind (templates page + pickers). */
export function builtInPromptFor(kind: PromptTemplateKind): {
	title: string;
	content: string;
	/** Deep-link focus key on the templates page. */
	focusKey: string;
} {
	if (kind === "audio") {
		return {
			title: DEFAULT_AUDIO_SYSTEM_PROMPT_TITLE,
			content: DEFAULT_AUDIO_SYSTEM_PROMPT,
			focusKey: "Paudio-default",
		};
	}
	return {
		title: DEFAULT_PLANNER_SYSTEM_PROMPT_TITLE,
		content: DEFAULT_PLANNER_SYSTEM_PROMPT,
		focusKey: "Pdefault",
	};
}
