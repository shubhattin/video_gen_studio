import {
	MODEL_CAPABILITY_PROFILES,
	type VideoModelId,
} from "#/lib/model-catalog";
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
import { Textarea } from "#/components/ui/textarea";

export type VideoConfigState = {
	modelId: string;
	aspectRatio: string;
	resolution: string;
	durationSeconds: number;
	generateAudio?: boolean;
	negativePrompt?: string;
	cfgScale?: number;
	prompt?: string;
};

type VideoConfigurationProps = {
	value: VideoConfigState;
	onChange: (value: VideoConfigState) => void;
	disabled?: boolean;
	showPrompt?: boolean;
};

export function VideoConfiguration({
	value,
	onChange,
	disabled,
	showPrompt,
}: VideoConfigurationProps) {
	const profile = MODEL_CAPABILITY_PROFILES[value.modelId as VideoModelId];
	if (!profile) {
		return null;
	}

	return (
		<section className="space-y-3 border-t border-border/80 pt-5">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<div>
					<h2 className="font-heading text-lg font-semibold">
						Video configuration
					</h2>
					<p className="text-sm text-muted-foreground">
						Adjust the clip’s shape, resolution, and length for the selected
						model.
					</p>
				</div>
				{profile.pricingNotes ? (
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
						<PopoverContent align="end" className="w-80 gap-3 p-4">
							<PopoverHeader>
								<PopoverTitle>Pricing notes</PopoverTitle>
								<PopoverDescription>{profile.pricingNotes}</PopoverDescription>
							</PopoverHeader>
						</PopoverContent>
					</Popover>
				) : null}
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-2">
					<Label>Aspect ratio</Label>
					<Select
						value={value.aspectRatio}
						onValueChange={(aspectRatio) =>
							aspectRatio && onChange({ ...value, aspectRatio })
						}
						disabled={disabled}
					>
						<SelectTrigger className="min-h-11">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{profile.aspectRatios.map((ratio) => (
								<SelectItem key={ratio} value={ratio}>
									{ratio}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-2">
					<Label>Resolution</Label>
					<Select
						value={value.resolution}
						onValueChange={(resolution) =>
							resolution && onChange({ ...value, resolution })
						}
						disabled={disabled}
					>
						<SelectTrigger className="min-h-11">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{profile.resolutions.map((resolution) => (
								<SelectItem key={resolution} value={resolution}>
									{resolution}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-2">
					<Label>Duration (seconds)</Label>
					<Select
						value={String(value.durationSeconds)}
						onValueChange={(duration) =>
							duration &&
							onChange({ ...value, durationSeconds: Number(duration) })
						}
						disabled={disabled}
					>
						<SelectTrigger className="min-h-11">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{profile.supportedDurations.map((duration) => (
								<SelectItem key={duration} value={String(duration)}>
									{duration}s
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			{profile.supportsAudio ? (
				<div className="flex items-center gap-3 min-h-11">
					<Switch
						id="generate-audio"
						checked={value.generateAudio ?? false}
						onCheckedChange={(checked) =>
							onChange({ ...value, generateAudio: checked })
						}
						disabled={disabled}
					/>
					<Label htmlFor="generate-audio">Generate audio</Label>
				</div>
			) : null}

			{profile.supportsNegativePrompt ? (
				<div className="space-y-2">
					<Label>Negative prompt</Label>
					<Textarea
						value={value.negativePrompt ?? ""}
						onChange={(event) =>
							onChange({ ...value, negativePrompt: event.target.value })
						}
						placeholder="blur, text overlays, distorted faces…"
						disabled={disabled}
						className="max-h-40 overflow-y-auto"
					/>
				</div>
			) : null}

			{showPrompt ? (
				<div className="space-y-2">
					<Label>Video prompt</Label>
					<Textarea
						value={value.prompt ?? ""}
						onChange={(event) =>
							onChange({ ...value, prompt: event.target.value })
						}
						className="min-h-28 max-h-56 overflow-y-auto"
						disabled={disabled}
					/>
				</div>
			) : null}
		</section>
	);
}
