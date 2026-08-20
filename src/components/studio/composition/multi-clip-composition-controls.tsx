import { Badge } from "#/components/ui/badge";
import { Label } from "#/components/ui/label";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { useState } from "react";
import {
	MODEL_CAPABILITY_PROFILES,
	type VideoModelId,
} from "#/lib/model-catalog";

export type CompositionSettings = {
	enabled: boolean;
	mode: "continuation" | "cut-scenes";
	multiplier: number;
};

type MultiClipCompositionControlsProps = {
	value: CompositionSettings;
	modelId: VideoModelId;
	durationSeconds: number;
	disabled?: boolean;
	/** True once any plan (single- or multi-clip) exists on this run. */
	hasPlan?: boolean;
	onChange: (value: CompositionSettings) => void;
};

export function MultiClipCompositionControls({
	value,
	modelId,
	durationSeconds,
	disabled,
	hasPlan,
	onChange,
}: MultiClipCompositionControlsProps) {
	const [confirmEnable, setConfirmEnable] = useState(false);
	const profile = MODEL_CAPABILITY_PROFILES[modelId];
	const totalDuration = durationSeconds * value.multiplier;
	const hasNativeLongerOption = profile.supportedDurations.some(
		(duration) => duration >= totalDuration,
	);

	// Once any plan has been generated the mode is fixed for this run — show a
	// status label instead of an editable switch. Starting a fresh run lets them
	// switch modes.
	if (hasPlan && !value.enabled) {
		return null;
	}

	return (
		<>
			<section className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1">
						<div className="flex flex-wrap items-center gap-2">
							<h2 className="font-heading text-lg font-semibold">
								Multi-clip composition
							</h2>
							<Badge variant="default">Experimental</Badge>
						</div>
						<p className="max-w-2xl text-sm text-muted-foreground">
							Plan and generate several short clips in sequence, then play or
							download them as one longer video.
						</p>
					</div>
					<div className="flex min-h-11 items-center gap-2">
						{hasPlan ? (
							<Badge variant="default" className="gap-1.5">
								<span className="size-1.5 rounded-full bg-primary-foreground" />
								Enabled
							</Badge>
						) : (
							<>
								<Switch
									id="multi-clip-composition"
									checked={value.enabled}
									onCheckedChange={(enabled) => {
										if (enabled && !value.enabled) {
											setConfirmEnable(true);
										} else {
											onChange({ ...value, enabled });
										}
									}}
									disabled={disabled}
								/>
								<Label htmlFor="multi-clip-composition">Enable mode</Label>
							</>
						)}
					</div>
				</div>

				{value.enabled ? (
					<div className="space-y-4 border-t border-primary/20 pt-4">
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="composition-multiplier">Target length</Label>
								<Select
									value={String(value.multiplier)}
									onValueChange={(next) => {
										if (next) {
											onChange({ ...value, multiplier: Number(next) });
										}
									}}
									disabled={disabled}
								>
									<SelectTrigger
										id="composition-multiplier"
										className="min-h-11"
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{[2, 3, 4, 5, 6].map((multiplier) => (
											<SelectItem key={multiplier} value={String(multiplier)}>
												{multiplier}× · {durationSeconds * multiplier}s total
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<p className="text-xs text-muted-foreground">
									{value.multiplier} clips × {durationSeconds}s ={" "}
									{totalDuration}s
								</p>
							</div>
						</div>

						<RadioGroup
							value={value.mode}
							onValueChange={(mode) => {
								if (mode === "continuation" || mode === "cut-scenes") {
									onChange({ ...value, mode });
								}
							}}
							disabled={disabled}
							aria-label="Composition style"
							className="grid gap-3 sm:grid-cols-2"
						>
							<Label
								htmlFor="composition-continuation"
								className="flex cursor-pointer gap-3 rounded-lg border border-primary/40 bg-background p-3"
							>
								<RadioGroupItem
									id="composition-continuation"
									value="continuation"
								/>
								<span className="space-y-1">
									<span className="block text-sm font-medium">
										Continuation
									</span>
									<span className="block text-xs font-normal text-muted-foreground">
										Each clip picks up from the last frame of the previous one
										for a seamless flow. Keep this tab open while generating.
									</span>
								</span>
							</Label>
							<Label
								htmlFor="composition-cut-scenes"
								className="flex cursor-pointer gap-3 rounded-lg border border-border bg-background p-3"
							>
								<RadioGroupItem
									id="composition-cut-scenes"
									value="cut-scenes"
								/>
								<span className="space-y-1">
									<span className="block text-sm font-medium">Cut scenes</span>
									<span className="block text-xs font-normal text-muted-foreground">
										Use deliberate scene changes while maintaining the video’s
										overall visual identity.
									</span>
								</span>
							</Label>
						</RadioGroup>

						{hasNativeLongerOption ? (
							<p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
								{profile.displayName} supports a native clip at or above{" "}
								{totalDuration}s. Use a normal single clip unless you
								specifically need scene-by-scene control.
							</p>
						) : null}
					</div>
				) : null}
			</section>

			<AlertDialog open={confirmEnable} onOpenChange={setConfirmEnable}>
				<AlertDialogContent size="sm">
					<AlertDialogHeader>
						<AlertDialogTitle>Enable multi-clip mode?</AlertDialogTitle>
						<AlertDialogDescription>
							This experimental mode stitches several short clips together.
							Models that natively support longer clips (e.g. Seedance 2.5) are
							usually better — use this only when you need scene-by-scene
							control.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setConfirmEnable(false);
								onChange({ ...value, enabled: true });
							}}
						>
							Enable
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
