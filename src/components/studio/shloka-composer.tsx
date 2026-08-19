import {
	createTypingContext,
	clearTypingContextOnKeyDown,
	handleTypingBeforeInputEvent,
} from "lipilekhika/typing";
import { useEffect, useRef, useState } from "react";
import { MessageResponse } from "#/components/ai-elements/message";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
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
	/** Persist shloka / instructions / system prompt (typically on blur). */
	onPersist?: () => void;
	disabled?: boolean;
};

export function ShlokaComposer({
	shlokaText,
	customInstructions,
	plannerSystemPrompt,
	onShlokaChange,
	onInstructionsChange,
	onPlannerSystemPromptChange,
	onPersist,
	disabled,
}: ShlokaComposerProps) {
	const [lipiEnabled, setLipiEnabled] = useState(true);
	const [promptTab, setPromptTab] = useState<"view" | "edit">("view");
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
					<Popover
						onOpenChange={(open) => {
							if (open) {
								setPromptTab("view");
							}
						}}
					>
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
							{isCustomSystemPrompt ? "View custom" : "View default"}
						</PopoverTrigger>
						<PopoverContent
							align="end"
							className="w-[min(36rem,calc(100vw-2rem))] gap-3 p-4"
						>
							<PopoverHeader>
								<PopoverTitle>Planner system prompt</PopoverTitle>
								<PopoverDescription>
									Only saved on the run when it differs from the built-in
									default. Output shape (single vs multi-clip fields) is
									appended automatically at plan time — keep this text focused
									on creative direction.
								</PopoverDescription>
							</PopoverHeader>
							<Tabs
								value={promptTab}
								onValueChange={(value) => {
									if (value === "view" || value === "edit") {
										setPromptTab(value);
									}
								}}
								className="gap-3"
							>
								<TabsList>
									<TabsTrigger value="view">View</TabsTrigger>
									<TabsTrigger value="edit" disabled={disabled}>
										Edit
									</TabsTrigger>
								</TabsList>
								<TabsContent value="view" className="mt-0">
									<div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border/80 bg-muted/20 p-4">
										<MessageResponse className="text-sm leading-relaxed [&_strong]:font-semibold [&_em]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-1 [&_p]:my-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
											{plannerSystemPrompt}
										</MessageResponse>
									</div>
								</TabsContent>
								<TabsContent value="edit" className="mt-0 space-y-3">
									<Textarea
										value={plannerSystemPrompt}
										onChange={(event) =>
											onPlannerSystemPromptChange(event.target.value)
										}
										onBlur={() => onPersist?.()}
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
												onPlannerSystemPromptChange(
													DEFAULT_PLANNER_SYSTEM_PROMPT,
												)
											}
										>
											Reset to default
										</Button>
									</div>
								</TabsContent>
							</Tabs>
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
					onBlur={() => {
						typingContextRef.current.clearContext();
						onPersist?.();
					}}
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
					onBlur={() => onPersist?.()}
					placeholder="Example: twilight temple courtyard, soft diya glow, marigold petals, gentle camera drift, no text overlays…"
					className="min-h-40 max-h-72 overflow-y-auto resize-y"
					disabled={disabled}
				/>
			</div>
		</section>
	);
}
