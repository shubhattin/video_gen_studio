import {
	MODEL_CAPABILITY_PROFILES,
	type VideoModelId,
} from "#/lib/model-catalog";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";

type ModelCardProps = {
	modelId: VideoModelId;
	selected?: boolean;
	onSelect?: () => void;
	gatewayPricing?: {
		input?: string;
		output?: string;
	};
};

export function ModelCard({
	modelId,
	selected,
	onSelect,
	gatewayPricing,
}: ModelCardProps) {
	const profile = MODEL_CAPABILITY_PROFILES[modelId];
	const durations = profile.supportedDurations;

	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				"w-full rounded-xl border p-4 text-left transition-colors duration-200 min-h-11",
				"hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				selected ? "border-primary bg-primary/5" : "border-border/80",
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="font-medium">{profile.displayName}</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{profile.description}
					</p>
				</div>
				{selected ? <Badge>Selected</Badge> : null}
			</div>
			<div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
				<span>{profile.aspectRatios.slice(0, 3).join(" · ")}</span>
				<span>{profile.resolutions.join(" · ")}</span>
				<span>
					{durations[0]}–{durations[durations.length - 1]}s
				</span>
				{profile.supportsAudio ? <span>audio</span> : null}
			</div>
			<p className="mt-3 text-xs text-muted-foreground">
				{gatewayPricing?.output
					? `OpenRouter SKU sample: ${gatewayPricing.output}`
					: profile.pricingNotes}
			</p>
			{onSelect ? (
				<Button variant="outline" size="sm" className="mt-4 min-h-11">
					Use model
				</Button>
			) : null}
		</button>
	);
}
