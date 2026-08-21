export type { PlannerPromptSelection } from "../../convex/lib/plannerPrompt";
export {
	DEFAULT_PLANNER_SYSTEM_PROMPT,
	DEFAULT_PLANNER_SYSTEM_PROMPT_TITLE,
	normalizePlannerSystemPromptForStorage,
	resolvePlannerSystemPrompt,
} from "../../convex/lib/plannerPrompt";

/** Client shape of a stored system prompt template. */
export type SystemPromptTemplate = {
	_id: string;
	title: string;
	content: string;
	updatedAt: number;
	createdAt: number;
};
