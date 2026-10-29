import { AudioLines } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import {
	AUDIO_MODEL_PROFILES,
	type AudioModelId,
	type AudioParams,
} from "#/lib/audio-catalog";
import { cn } from "#/lib/utils";

type AudioGenerateConfirmProps = {
	params: AudioParams;
	mode: "direct" | "guided";
	imageCount: number;
	disabled?: boolean;
	generating?: boolean;
	triggerLabel?: string;
	warning?: string;
	/** Guided runs: script the take uses, e.g. "Title · revision 2 of 3". */
	sourceLabel?: string;
	className?: string;
	onConfirm: () => void;
};

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/20 px-2.5 py-1.5 text-xs">
			<span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</span>
			<span className="min-w-0 font-medium">{value}</span>
		</span>
	);
}

/** Confirmation before a (paid) audio generation, mirroring the video flow. */
export function AudioGenerateConfirm({
	params,
	mode,
	imageCount,
	disabled,
	generating,
	triggerLabel = "Generate audio",
	warning,
	sourceLabel,
	className,
	onConfirm,
}: AudioGenerateConfirmProps) {
	const [open, setOpen] = useState(false);
	const profile = AUDIO_MODEL_PROFILES[params.modelId as AudioModelId];
	const sentImages = profile ? Math.min(imageCount, profile.maxInputImages) : 0;

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger
				render={
					<Button
						type="button"
						className={cn("w-full", className)}
						disabled={disabled || generating}
					/>
				}
			>
				<span className="truncate">
					{generating ? "Generating audio…" : triggerLabel}
				</span>
			</AlertDialogTrigger>
			<AlertDialogContent size="default">
				<AlertDialogHeader>
					<AlertDialogMedia>
						<AudioLines className="size-8" />
					</AlertDialogMedia>
					<AlertDialogTitle>Start audio generation?</AlertDialogTitle>
					<AlertDialogDescription>
						This generates a new take with the current model and settings.
					</AlertDialogDescription>
				</AlertDialogHeader>

				<div className="grid gap-2">
					{warning ? (
						<p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
							{warning}
						</p>
					) : null}
					{sourceLabel ? (
						<DetailRow label="Script" value={sourceLabel} />
					) : null}
					<DetailRow
						label="Model"
						value={profile?.displayName ?? params.modelId}
					/>
					{profile?.fixedDurationSeconds ? (
						<DetailRow
							label="Length"
							value={`${profile.fixedDurationSeconds}s`}
						/>
					) : mode === "guided" && params.targetDurationSeconds ? (
						<DetailRow
							label="Length"
							value={`~${params.targetDurationSeconds}s`}
						/>
					) : null}
					{mode === "guided" ? (
						<DetailRow
							label="Vocals"
							value={params.instrumental ? "Instrumental" : "Sung"}
						/>
					) : null}
					{sentImages > 0 ? (
						<DetailRow label="Images" value={sentImages} />
					) : null}
				</div>

				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							setOpen(false);
							onConfirm();
						}}
					>
						Generate
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
