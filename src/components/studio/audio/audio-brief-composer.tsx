import {
	clearTypingContextOnKeyDown,
	createTypingContext,
	handleTypingBeforeInputEvent,
} from "lipilekhika/typing";
import { useEffect, useRef, useState } from "react";
import { SystemPromptPicker } from "#/components/studio/system-prompts/system-prompt-picker";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import type {
	PlannerPromptSelection,
	SystemPromptTemplate,
} from "#/lib/planner-prompt";

type AudioBriefComposerProps = {
	instructions: string;
	promptSelection: PlannerPromptSelection | null;
	templates: SystemPromptTemplate[] | undefined;
	onInstructionsChange: (value: string) => void;
	onPromptSelectionChange: (selection: PlannerPromptSelection | null) => void;
	/** Persist instructions (typically on blur). */
	onPersist?: () => void;
	disabled?: boolean;
};

/**
 * Guided song input: an audio system prompt plus one free-form brief. The
 * brief can paste a verse, name a source (e.g. Chāṇakya Nīti), or just set
 * a theme — the scripter picks authentic verses from it.
 */
export function AudioBriefComposer({
	instructions,
	promptSelection,
	templates,
	onInstructionsChange,
	onPromptSelectionChange,
	onPersist,
	disabled,
}: AudioBriefComposerProps) {
	// Off by default: briefs are mostly English; turn on to type a verse.
	const [lipiEnabled, setLipiEnabled] = useState(false);
	const typingContextRef = useRef(
		createTypingContext("Devanagari", { useNativeNumerals: true }),
	);

	useEffect(() => {
		if (!lipiEnabled) {
			typingContextRef.current.clearContext();
		}
	}, [lipiEnabled]);

	return (
		<section className="space-y-5">
			<div className="space-y-2">
				<div>
					<p className="text-sm font-medium">System prompt template</p>
					<p className="text-sm text-muted-foreground">
						Required before the song script is written.
					</p>
				</div>
				<SystemPromptPicker
					kind="audio"
					selection={promptSelection}
					templates={templates}
					onChange={onPromptSelectionChange}
					disabled={disabled}
					selectedHint="Used by the song scripter and saved with the run."
					missingHint="Select a system prompt template before writing the script."
				/>
			</div>

			<div className="space-y-2">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<h2 className="font-heading text-lg font-semibold">Instructions</h2>
						<p className="text-sm text-muted-foreground">
							What the piece is about — paste a verse, name a source, or
							describe a theme — plus mood, rāga, instruments, voice, and what
							to avoid.
						</p>
					</div>
					<div className="flex min-h-11 items-center gap-1.5">
						<Switch
							id="audio-lipi-toggle"
							checked={lipiEnabled}
							onCheckedChange={setLipiEnabled}
							disabled={disabled}
						/>
						<Label htmlFor="audio-lipi-toggle" className="text-sm">
							Devanagari Typing
						</Label>
					</div>
				</div>
				<Textarea
					value={instructions}
					spellCheck={!lipiEnabled}
					onChange={(event) => onInstructionsChange(event.target.value)}
					onBeforeInput={(event) => {
						if (!lipiEnabled) return;
						handleTypingBeforeInputEvent(
							typingContextRef.current,
							event.nativeEvent,
							onInstructionsChange,
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
					placeholder="Example: a 60-second song on a Chāṇakya Nīti verse about the value of knowledge — calm Yaman mood, male lead voice, tanpura and bansuri, repeat the last pada as a refrain…"
					className="min-h-48 max-h-[60vh] resize-y overflow-y-auto text-base leading-relaxed"
					disabled={disabled}
					aria-required="true"
				/>
			</div>
		</section>
	);
}
