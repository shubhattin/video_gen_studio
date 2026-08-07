import {
	createTypingContext,
	clearTypingContextOnKeyDown,
	handleTypingBeforeInputEvent,
} from "lipilekhika/typing";
import { useEffect, useRef, useState } from "react";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { cn } from "#/lib/utils";

type ShlokaComposerProps = {
	shlokaText: string;
	customInstructions: string;
	onShlokaChange: (value: string) => void;
	onInstructionsChange: (value: string) => void;
	disabled?: boolean;
};

export function ShlokaComposer({
	shlokaText,
	customInstructions,
	onShlokaChange,
	onInstructionsChange,
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
		<section className="space-y-6">
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
						clearTypingContextOnKeyDown(event.nativeEvent, typingContextRef.current)
					}
					placeholder="Type in Roman or paste Devanagari…"
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
					placeholder="Example: twilight forest, soft gold light, gentle camera drift, no text overlays…"
					className="min-h-28"
					disabled={disabled}
				/>
			</div>
		</section>
	);
}
