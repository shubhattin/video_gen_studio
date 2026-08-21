import { Clapperboard } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { VideoConfigState } from "#/components/studio/video/video-configuration";
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
	MODEL_CAPABILITY_PROFILES,
	type VideoModelId,
} from "#/lib/model-catalog";
import { cn } from "#/lib/utils";

type VideoGenerateConfirmProps = {
	config: VideoConfigState;
	disabled?: boolean;
	generating?: boolean;
	triggerLabel: string;
	generatingLabel?: string;
	/** Brief amber warning shown inside the dialog (e.g. settings divergence). */
	warning?: string;
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

/**
 * Confirmation dialog shown before kicking off a video generation. Surfaces the
 * current model and video settings (aspect ratio, resolution, duration, audio)
 * so the user can double-check the plan before generating.
 */
export function VideoGenerateConfirm({
	config,
	disabled,
	generating,
	triggerLabel,
	generatingLabel = "Generating video…",
	warning,
	className,
	onConfirm,
}: VideoGenerateConfirmProps) {
	const [open, setOpen] = useState(false);
	const profile = MODEL_CAPABILITY_PROFILES[config.modelId as VideoModelId];

	return (
		<div className="flex flex-col gap-1.5">
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
					{generating ? generatingLabel : triggerLabel}
				</AlertDialogTrigger>
				<AlertDialogContent size="default">
					<AlertDialogHeader>
						<AlertDialogMedia>
							<Clapperboard className="size-8" />
						</AlertDialogMedia>
						<AlertDialogTitle>Start video generation?</AlertDialogTitle>
						<AlertDialogDescription>
							This will generate a clip with the current model and settings.
						</AlertDialogDescription>
					</AlertDialogHeader>

					<div className="grid gap-2">
						{warning ? (
							<p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
								{warning}
							</p>
						) : null}
						<DetailRow
							label="Model"
							value={profile?.displayName ?? config.modelId}
						/>
						<DetailRow label="Aspect ratio" value={config.aspectRatio} />
						<DetailRow label="Resolution" value={config.resolution} />
						<DetailRow label="Duration" value={`${config.durationSeconds}s`} />
						{profile?.supportsAudio ? (
							<DetailRow
								label="Audio"
								value={config.generateAudio ? "On" : "Off"}
							/>
						) : null}
						{profile?.supportsNegativePrompt &&
						config.negativePrompt?.trim() ? (
							<DetailRow label="Negative prompt" value="Set" />
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
		</div>
	);
}
