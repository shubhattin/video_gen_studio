import { Info } from "lucide-react";
import { Label } from "#/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import {
	AUDIO_MODEL_PROFILES,
	type AudioModelId,
	type AudioParams,
} from "#/lib/audio-catalog";

const TARGET_LENGTH_OPTIONS = [30, 45, 60, 90, 120, 150, 180];

function formatLength(seconds: number) {
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return rest ? `${minutes}m ${rest}s` : `${minutes} min`;
}

type AudioConfigurationProps = {
	value: AudioParams;
	onChange: (value: AudioParams) => void;
	/** Guided runs expose length + vocals; direct runs leave them to the prompt. */
	mode: "direct" | "guided";
	disabled?: boolean;
};

/** Per-model audio settings. Only controls the selected model honours appear. */
export function AudioConfiguration({
	value,
	onChange,
	mode,
	disabled,
}: AudioConfigurationProps) {
	const profile = AUDIO_MODEL_PROFILES[value.modelId as AudioModelId];
	if (!profile) {
		return null;
	}
	const showLength = mode === "guided" && profile.supportsTargetDuration;
	const showInstrumental = mode === "guided";
	const lengthOptions = TARGET_LENGTH_OPTIONS.filter(
		(seconds) =>
			seconds >= (profile.minTargetDurationSeconds ?? 0) &&
			seconds <= (profile.maxTargetDurationSeconds ?? Number.POSITIVE_INFINITY),
	);

	const note = profile.fixedDurationSeconds
		? `${profile.displayName} always renders a ${profile.fixedDurationSeconds}-second clip.`
		: mode === "direct"
			? "Length, vocals and style come from your prompt (e.g. “a 90-second song…”, “instrumental only”)."
			: null;

	return (
		<div className="rounded-2xl border border-border/70 bg-muted/15 p-3 sm:p-4">
			{showLength || showInstrumental ? (
				<div className="mb-3 flex flex-wrap items-end gap-3">
					{showLength ? (
						<div className="flex min-w-40 flex-1 flex-col gap-1.5">
							<Label className="text-xs">Target length</Label>
							<Select
								value={String(
									value.targetDurationSeconds ??
										profile.defaultTargetDurationSeconds ??
										60,
								)}
								onValueChange={(seconds) =>
									seconds &&
									onChange({ ...value, targetDurationSeconds: Number(seconds) })
								}
								disabled={disabled}
							>
								<SelectTrigger className="h-9">
									<SelectValue>
										{(selected: string) =>
											`About ${formatLength(Number(selected))}`
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{lengthOptions.map((seconds) => (
										<SelectItem key={seconds} value={String(seconds)}>
											About {formatLength(seconds)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					) : null}
					{showInstrumental ? (
						<label
							htmlFor="audio-instrumental"
							className="flex h-9 min-w-40 flex-1 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-3"
						>
							<span className="text-sm">Instrumental only</span>
							<Switch
								id="audio-instrumental"
								checked={value.instrumental === true}
								onCheckedChange={(checked) =>
									onChange({ ...value, instrumental: checked })
								}
								disabled={disabled}
							/>
						</label>
					) : null}
				</div>
			) : null}
			<div className="flex flex-wrap items-start justify-between gap-2">
				<p className="flex min-w-0 flex-1 items-start gap-1.5 text-xs text-muted-foreground">
					{note ? (
						<>
							<Info className="mt-0.5 size-3.5 shrink-0" />
							{note}
						</>
					) : null}
				</p>
				<Popover>
					<PopoverTrigger
						render={
							<button
								type="button"
								className="inline-flex h-6 items-center gap-1 rounded px-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								<Info data-icon="inline-start" className="size-3.5" />
								Pricing
							</button>
						}
					/>
					<PopoverContent align="end" className="w-72 gap-3 p-4">
						<PopoverHeader>
							<PopoverTitle>Pricing notes</PopoverTitle>
							<PopoverDescription>
								{profile.displayName}: {profile.pricingNotes}. The actual cost
								of each take appears in its details.
							</PopoverDescription>
						</PopoverHeader>
					</PopoverContent>
				</Popover>
			</div>
		</div>
	);
}
