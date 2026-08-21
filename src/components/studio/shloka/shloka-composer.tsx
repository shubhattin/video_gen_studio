import {
	createTypingContext,
	clearTypingContextOnKeyDown,
	handleTypingBeforeInputEvent,
} from "lipilekhika/typing";
import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SystemPromptPicker } from "#/components/studio/system-prompts/system-prompt-picker";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/ui/popover";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import type {
	PlannerPromptSelection,
	SystemPromptTemplate,
} from "#/lib/planner-prompt";
import { cn } from "#/lib/utils";

type ShlokaComposerProps = {
	shlokaText: string;
	customInstructions: string;
	plannerPromptSelection: PlannerPromptSelection | null;
	templates: SystemPromptTemplate[] | undefined;
	onShlokaChange: (value: string) => void;
	onInstructionsChange: (value: string) => void;
	/** Persist the selected system prompt template (immediate autosave). */
	onPlannerPromptSelectionChange: (
		selection: PlannerPromptSelection | null,
	) => void;
	/** Persist shloka / instructions (typically on blur). */
	onPersist?: () => void;
	disabled?: boolean;
};

export function ShlokaComposer({
	shlokaText,
	customInstructions,
	plannerPromptSelection,
	templates,
	onShlokaChange,
	onInstructionsChange,
	onPlannerPromptSelectionChange,
	onPersist,
	disabled,
}: ShlokaComposerProps) {
	const [lipiEnabled, setLipiEnabled] = useState(true);
	const typingContextRef = useRef(
		createTypingContext("Devanagari", { useNativeNumerals: true }),
	);

	useEffect(() => {
		typingContextRef.current = createTypingContext("Devanagari", {
			useNativeNumerals: true,
		});
	}, [lipiEnabled]);

	return (
		<section className="space-y-5">
			<div className="space-y-2">
				<div>
					<p className="text-sm font-medium">System prompt template</p>
					<p className="text-sm text-muted-foreground">
						Required before the planner runs.
					</p>
				</div>
				<SystemPromptPicker
					selection={plannerPromptSelection}
					templates={templates}
					onChange={onPlannerPromptSelectionChange}
					disabled={disabled}
				/>
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h2 className="font-heading text-lg font-semibold">Shloka</h2>
					</div>
					<div className="flex items-center gap-1.5 min-h-11">
						<Switch
							id="lipi-toggle"
							checked={lipiEnabled}
							onCheckedChange={setLipiEnabled}
							disabled={disabled}
						/>
						<Label htmlFor="lipi-toggle" className="text-sm">
							Devanagari Typing
						</Label>
						<Popover>
							<PopoverTrigger
								render={
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										aria-label="Devanagari typing help"
										disabled={disabled}
									/>
								}
							>
								<Info />
							</PopoverTrigger>
							<PopoverContent align="end" className="w-72 gap-3 p-4">
								<PopoverHeader>
									<PopoverTitle>Devanagari Typing</PopoverTitle>
									<PopoverDescription>
										While the verse box is focused, press Alt+X to toggle
										Devanagari transliteration on or off.
									</PopoverDescription>
								</PopoverHeader>
							</PopoverContent>
						</Popover>
					</div>
				</div>
				<Textarea
					value={shlokaText}
					spellCheck={false}
					onChange={(event) => onShlokaChange(event.target.value)}
					onBeforeInput={(event) => {
						if (!lipiEnabled) {
							return;
						}
						handleTypingBeforeInputEvent(
							typingContextRef.current,
							event.nativeEvent,
							onShlokaChange,
						);
					}}
					onBlur={() => {
						typingContextRef.current.clearContext();
						onPersist?.();
					}}
					onKeyDown={(event) => {
						// Alt+X toggles Devanagari transliteration while typing.
						if (event.altKey && (event.key === "x" || event.key === "X")) {
							event.preventDefault();
							setLipiEnabled((previous) => !previous);
							return;
						}
						clearTypingContextOnKeyDown(
							event.nativeEvent,
							typingContextRef.current,
						);
					}}
					placeholder="Enter or paste a verse in Devanagari…"
					className={cn("min-h-32 text-base leading-relaxed")}
					disabled={disabled}
					aria-required="true"
				/>
			</div>

			<div className="space-y-2">
				<h3 className="text-sm font-medium">Custom instructions</h3>
				<p className="text-sm text-muted-foreground">
					Guide imagery, mood, symbolism, pacing, and what to avoid.
				</p>
				<Textarea
					value={customInstructions}
					onChange={(event) => onInstructionsChange(event.target.value)}
					onBlur={() => onPersist?.()}
					placeholder="Example: twilight temple courtyard, soft diya glow, marigold petals, gentle camera drift, no text overlays…"
					className="min-h-40 max-h-72 overflow-y-auto resize-y"
					disabled={disabled}
				/>
			</div>
		</section>
	);
}
