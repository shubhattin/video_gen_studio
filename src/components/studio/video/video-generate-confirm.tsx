import { useState, type ReactNode } from "react";
import { Clapperboard } from "lucide-react";
import { Button } from "#/components/ui/button";
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
import {
	MODEL_CAPABILITY_PROFILES,
	type VideoModelId,
} from "#/lib/model-catalog";
import type { VideoConfigState } from "#/components/studio/video/video-configuration";
import { cn } from "#/lib/utils";

type VideoGenerateConfirmProps = {
	config: VideoConfigState;
	disabled?: boolean;
	generating?: boolean;
	triggerLabel: string;
	generatingLabel?: string;
	planLabel?: string;
	className?: string;
	onConfirm: () => void;
};

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
			<span className="shrink-0 text-xs text-muted-foreground">{label}</span>
			<span className="min-w-0 text-right text-sm font-medium">{value}</span>
		</div>
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
	planLabel,
	className,
	onConfirm,
}: VideoGenerateConfirmProps) {
	const [open, setOpen] = useState(false);
	const profile = MODEL_CAPABILITY_PROFILES[config.modelId as VideoModelId];

	return (
		<div className="flex flex-col gap-1.5">
			{planLabel ? (
				<p className="text-xs text-muted-foreground">
					Using plan:{" "}
					<span className="font-medium text-foreground">{planLabel}</span>
				</p>
			) : null}
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
						{planLabel ? <DetailRow label="Plan" value={planLabel} /> : null}
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
