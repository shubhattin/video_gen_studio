import {
	createTypingContext,
	clearTypingContextOnKeyDown,
	handleTypingBeforeInputEvent,
} from "lipilekhika/typing";
import { useEffect, useRef, useState } from "react";
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
import {
	DEFAULT_PLANNER_SYSTEM_PROMPT,
	normalizePlannerSystemPromptForStorage,
} from "#/lib/planner-prompt";
import { cn } from "#/lib/utils";

type ShlokaComposerProps = {
	shlokaText: string;
	customInstructions: string;
	plannerSystemPrompt: string;
	onShlokaChange: (value: string) => void;
	onInstructionsChange: (value: string) => void;
	onPlannerSystemPromptChange: (value: string) => void;
	disabled?: boolean;
};

export function ShlokaComposer({
	shlokaText,
	customInstructions,
	plannerSystemPrompt,
	onShlokaChange,
	onInstructionsChange,
	onPlannerSystemPromptChange,
	disabled,
}: ShlokaComposerProps) {
	const [lipiEnabled, setLipiEnabled] = useState(true);
	const typingContextRef = useRef(
		createTypingContext("Devanagari", { useNativeNumerals: true }),
	);
	const isCustomSystemPrompt = Boolean(
		normalizePlannerSystemPromptForStorage(plannerSystemPrompt),
	);

	useEffect(() => {
		typingContextRef.current = createTypingContext("Devanagari", {
			useNativeNumerals: true,
		});
	}, [lipiEnabled]);

	return (
		<section className="space-y-6">
			<div className="space-y-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<p className="text-sm font-medium">System prompt</p>
						<p className="text-sm text-muted-foreground">
							Planner instructions for image + video plan generation.
							{isCustomSystemPrompt
								? " Customized."
								: " Using built-in default."}
						</p>
					</div>
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
							{isCustomSystemPrompt ? "Edit custom" : "Edit default"}
						</PopoverTrigger>
						<PopoverContent
							align="end"
							className="w-[min(36rem,calc(100vw-2rem))] gap-3 p-4"
						>
							<PopoverHeader>
								<PopoverTitle>Planner system prompt</PopoverTitle>
								<PopoverDescription>
									Only saved on the run when it differs from the built-in
									default. Structured plan fields come from the schema, not this
									text.
								</PopoverDescription>
							</PopoverHeader>
							<Textarea
								value={plannerSystemPrompt}
								onChange={(event) =>
									onPlannerSystemPromptChange(event.target.value)
								}
								className="min-h-64 max-h-[50vh] resize-y font-mono text-xs leading-relaxed"
								disabled={disabled}
								aria-label="Planner system prompt"
							/>
							<div className="flex justify-end">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={
										disabled ||
										plannerSystemPrompt === DEFAULT_PLANNER_SYSTEM_PROMPT
									}
									onClick={() =>
										onPlannerSystemPromptChange(DEFAULT_PLANNER_SYSTEM_PROMPT)
									}
								>
									Reset to default
								</Button>
							</div>
						</PopoverContent>
					</Popover>
				</div>
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h2 className="font-heading text-xl font-semibold">Shloka</h2>
						<p className="text-sm text-muted-foreground">
							Enter the verse in Devanagari. Lipi Lekhika transliteration is on
							by default.
						</p>
					</div>
					<div className="flex items-center gap-2 min-h-11">
						<Switch
							id="lipi-toggle"
							checked={lipiEnabled}
							onCheckedChange={setLipiEnabled}
							disabled={disabled}
						/>
						<Label htmlFor="lipi-toggle" className="text-sm">
							Lipi typing
						</Label>
					</div>
				</div>
				<Textarea
					value={shlokaText}
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
					onBlur={() => typingContextRef.current.clearContext()}
					onKeyDown={(event) =>
						clearTypingContextOnKeyDown(
							event.nativeEvent,
							typingContextRef.current,
						)
					}
					placeholder="Enter or paste Devanagari shloka…"
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
					placeholder="Example: twilight temple courtyard, soft diya glow, marigold petals, gentle camera drift, no text overlays…"
					className="min-h-40 max-h-72 overflow-y-auto resize-y"
					disabled={disabled}
				/>
			</div>
		</section>
	);
}
