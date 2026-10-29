import { ModelSelectorLogo } from "#/components/ai-elements/model-selector";
import {
	AUDIO_MODEL_IDS,
	AUDIO_MODEL_PROFILES,
	type AudioModelId,
} from "#/lib/audio-catalog";
import { cn } from "#/lib/utils";

type AudioModelSelectorProps = {
	value: AudioModelId;
	onValueChange: (modelId: AudioModelId) => void;
	disabled?: boolean;
};

function capabilityChips(modelId: AudioModelId) {
	const profile = AUDIO_MODEL_PROFILES[modelId];
	const chips: string[] = [];
	if (profile.fixedDurationSeconds) {
		chips.push(`Fixed ${profile.fixedDurationSeconds}s`);
	} else if (profile.maxTargetDurationSeconds) {
		chips.push(
			`Up to ~${Math.round(profile.maxTargetDurationSeconds / 60)} min`,
		);
	}
	chips.push("Vocals + instruments");
	if (profile.maxInputImages > 0)
		chips.push(`Images ×${profile.maxInputImages}`);
	chips.push("MP3");
	return chips;
}

/**
 * Card picker for the (small) audio model catalog. Mirrors the studio
 * launcher's selectable-card styling rather than the video combobox.
 */
export function AudioModelSelector({
	value,
	onValueChange,
	disabled,
}: AudioModelSelectorProps) {
	return (
		<div className="grid gap-3 sm:grid-cols-2">
			{AUDIO_MODEL_IDS.map((modelId) => {
				const profile = AUDIO_MODEL_PROFILES[modelId];
				const isActive = modelId === value;
				return (
					<button
						key={modelId}
						type="button"
						aria-pressed={isActive}
						disabled={disabled}
						onClick={() => onValueChange(modelId)}
						className={cn(
							"flex flex-col gap-2 rounded-xl border p-3.5 text-left transition-all outline-none",
							"focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
							isActive
								? "border-ring/50 bg-accent/40 ring-2 ring-ring/40"
								: "border-border bg-transparent hover:bg-muted/40",
						)}
					>
						<span className="flex items-center gap-2">
							<ModelSelectorLogo provider={profile.family} className="size-4" />
							<span className="font-heading text-sm font-semibold">
								{profile.displayName}
							</span>
						</span>
						<span className="text-xs leading-relaxed text-muted-foreground">
							{profile.description}
						</span>
						<span className="flex flex-wrap gap-1">
							{capabilityChips(modelId).map((chip) => (
								<span
									key={chip}
									className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground"
								>
									{chip}
								</span>
							))}
						</span>
					</button>
				);
			})}
		</div>
	);
}
