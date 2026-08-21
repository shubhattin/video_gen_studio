import type { Id } from "@convex/_generated/dataModel";
import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { MessageResponse } from "#/components/ai-elements/message";
import { Button } from "#/components/ui/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "#/components/ui/combobox";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/ui/popover";
import {
	DEFAULT_PLANNER_SYSTEM_PROMPT,
	DEFAULT_PLANNER_SYSTEM_PROMPT_TITLE,
	type PlannerPromptSelection,
	type SystemPromptTemplate,
} from "#/lib/planner-prompt";

const DEFAULT_OPTION_VALUE = "__default__";

type TemplateOption = { label: string; value: string };

type SystemPromptPickerProps = {
	selection: PlannerPromptSelection | null;
	templates: SystemPromptTemplate[] | undefined;
	onChange: (selection: PlannerPromptSelection | null) => void;
	disabled?: boolean;
};

/**
 * Mandatory system-prompt selector for a Shloka run. Combines a searchable
 * combobox (default + templates by title) with a "View" popover for the
 * resolved prompt and an "Edit" deep link that opens the templates page in a
 * new tab and focuses the matching template.
 */
export function SystemPromptPicker({
	selection,
	templates,
	onChange,
	disabled = false,
}: SystemPromptPickerProps) {
	const items: TemplateOption[] = useMemo(
		() => [
			{
				label: DEFAULT_PLANNER_SYSTEM_PROMPT_TITLE,
				value: DEFAULT_OPTION_VALUE,
			},
			...(templates ?? []).map((template) => ({
				label: template.title,
				value: template._id,
			})),
		],
		[templates],
	);

	const selectedOption = useMemo(() => {
		if (!selection) {
			return null;
		}
		if (selection.kind === "default") {
			return items.find((item) => item.value === DEFAULT_OPTION_VALUE) ?? null;
		}
		return items.find((item) => item.value === selection.templateId) ?? null;
	}, [selection, items]);

	const resolved = useMemo(() => {
		if (!selection) {
			return null;
		}
		if (selection.kind === "default") {
			return {
				label: DEFAULT_PLANNER_SYSTEM_PROMPT_TITLE,
				content: DEFAULT_PLANNER_SYSTEM_PROMPT,
				editHash: "#Pdefault",
			};
		}
		const template = (templates ?? []).find(
			(item) => item._id === selection.templateId,
		);
		if (!template) {
			return null;
		}
		return {
			label: template.title,
			content: template.content,
			editHash: `#P${template._id}`,
		};
	}, [selection, templates]);

	const handleValueChange = (option: TemplateOption | null) => {
		if (!option) {
			onChange(null);
			return;
		}
		if (option.value === DEFAULT_OPTION_VALUE) {
			onChange({ kind: "default" });
			return;
		}
		const template = (templates ?? []).find(
			(item) => item._id === option.value,
		);
		if (template) {
			onChange({
				kind: "template",
				templateId: template._id as Id<"systemPromptTemplates">,
			});
		}
	};

	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-2">
				<Combobox
					items={items}
					value={selectedOption}
					onValueChange={handleValueChange}
					disabled={disabled}
				>
					<ComboboxInput
						placeholder="Select system prompt template…"
						className="w-full min-w-56"
						showTrigger
						showClear
						disabled={disabled}
					/>
					<ComboboxContent className="w-full">
						<ComboboxList>
							{(item: TemplateOption) => (
								<ComboboxItem key={item.value} value={item}>
									{item.label}
								</ComboboxItem>
							)}
						</ComboboxList>
						<ComboboxEmpty>No template matches</ComboboxEmpty>
					</ComboboxContent>
				</Combobox>

				{resolved ? (
					<Popover>
						<PopoverTrigger
							render={
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={disabled}
								/>
							}
						>
							View
						</PopoverTrigger>
						<PopoverContent
							align="end"
							className="w-[min(36rem,calc(100vw-2rem))] gap-3 p-4"
						>
							<PopoverHeader>
								<PopoverTitle>{resolved.label}</PopoverTitle>
								<PopoverDescription>
									Preview of the prompt the planner will receive.
								</PopoverDescription>
							</PopoverHeader>
							<div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border/80 bg-muted/20 p-4">
								{resolved.content.trim() ? (
									<MessageResponse className="text-sm leading-relaxed [&_strong]:font-semibold [&_em]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-1 [&_p]:my-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
										{resolved.content}
									</MessageResponse>
								) : (
									<p className="text-sm text-muted-foreground">
										This template is empty — edit it on the System Prompts page
										to write the prompt.
									</p>
								)}
							</div>
						</PopoverContent>
					</Popover>
				) : null}

				{selection && selection.kind === "template" && resolved ? (
					<a
						href={`/system-prompts${resolved.editHash}`}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-foreground underline underline-offset-3 hover:text-accent-foreground"
					>
						Edit
						<ExternalLink className="size-3.5" />
						<span className="sr-only">
							Edit “{resolved.label}” on the System Prompts page (opens in a new
							tab)
						</span>
					</a>
				) : null}
			</div>
			<p className="text-sm text-muted-foreground">
				{selection
					? "This template is required for planning and is saved with the run."
					: "Select a system prompt template before generating a plan."}
			</p>
		</div>
	);
}
