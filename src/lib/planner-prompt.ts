export type { PlannerPromptSelection } from "../../convex/lib/plannerPrompt";
export {
	DEFAULT_PLANNER_SYSTEM_PROMPT,
	DEFAULT_PLANNER_SYSTEM_PROMPT_TITLE,
	normalizePlannerSystemPromptForStorage,
	resolvePlannerSystemPrompt,
} from "../../convex/lib/plannerPrompt";

export type PromptTemplateKind = "video" | "audio";

/** Client shape of a stored system prompt template. */
export type SystemPromptTemplate = {
	_id: string;
	title: string;
	kind: PromptTemplateKind;
	content: string;
	updatedAt: number;
	createdAt: number;
};
