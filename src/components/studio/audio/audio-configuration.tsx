import { useState } from "react";
import { Info } from "lucide-react";
import { Input } from "#/components/ui/input";
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
import { Slider } from "#/components/ui/slider";
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
	const min = profile?.minTargetDurationSeconds ?? 30;
	const max = profile?.maxTargetDurationSeconds ?? 180;
	const defaultLen = profile?.defaultTargetDurationSeconds ?? 60;
	const current = value.targetDurationSeconds ?? defaultLen;
	const lengthOptions = TARGET_LENGTH_OPTIONS.filter(
		(seconds) => seconds >= min && seconds <= max,
	);
	const [customMode, setCustomMode] = useState(false);
	const [draft, setDraft] = useState<string | null>(null);
	const showCustom =
		Boolean(profile?.supportsTargetDuration) &&
		(customMode || !lengthOptions.includes(current));
	if (!profile) {
		return null;
	}
	const showLength = mode === "guided" && profile.supportsTargetDuration;
	const showInstrumental = mode === "guided";

	const commitDraft = () => {
		if (draft === null) return;
		const trimmed = draft.trim();
		if (!trimmed) {
			setDraft(null);
			return;
		}
		const parsed = Math.round(Number(trimmed));
		if (!Number.isFinite(parsed)) {
			setDraft(null);
			return;
		}
		const clamped = Math.min(max, Math.max(min, parsed));
		setDraft(null);
		if (clamped !== current) {
			onChange({ ...value, targetDurationSeconds: clamped });
		}
	};

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
								value={showCustom ? "custom" : String(current)}
								onValueChange={(next) => {
									if (!next) return;
									if (next === "custom") {
										setCustomMode(true);
										setDraft((prev) => prev ?? String(current));
										return;
									}
									setCustomMode(false);
									setDraft(null);
									onChange({
										...value,
										targetDurationSeconds: Number(next),
									});
								}}
								disabled={disabled}
							>
								<SelectTrigger className="h-9">
									<SelectValue>
										{(selected: string) =>
											selected === "custom"
												? `Custom — about ${formatLength(current)}`
												: `About ${formatLength(Number(selected))}`
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{lengthOptions.map((seconds) => (
										<SelectItem key={seconds} value={String(seconds)}>
											About {formatLength(seconds)}
										</SelectItem>
									))}
									<SelectItem value="custom">Custom…</SelectItem>
								</SelectContent>
							</Select>
							{showCustom ? (
								<div className="flex items-center gap-2">
									<Slider
										className="flex-1"
										min={min}
										max={max}
										step={5}
										value={[Math.min(max, Math.max(min, current))]}
										onValueChange={(val) => {
											const next = Array.isArray(val) ? val[0] : val;
											if (next === undefined) return;
											setDraft(null);
											if (next !== current) {
												onChange({
													...value,
													targetDurationSeconds: next,
												});
											}
										}}
										disabled={disabled}
									/>
									<div className="flex w-24 items-center gap-1">
										<Input
											className="h-9 text-right"
											type="number"
											min={min}
											max={max}
											step={1}
											value={draft ?? String(current)}
											onChange={(event) => setDraft(event.target.value)}
											onBlur={commitDraft}
											onKeyDown={(event) => {
												if (event.key === "Enter") {
													commitDraft();
												}
											}}
											disabled={disabled}
											aria-label={`Custom length in seconds (${min} to ${max})`}
										/>
										<span className="text-xs text-muted-foreground">s</span>
									</div>
								</div>
							) : null}
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
