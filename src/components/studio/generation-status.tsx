import { Progress } from "#/components/ui/progress";

const STAGES = [
	"draft",
	"planning",
	"plan_ready",
	"image_generating",
	"image_ready",
	"video_generating",
	"completed",
] as const;

type GenerationStatusProps = {
	status: string;
	lastError?: string;
	warnings?: string[];
};

export function GenerationStatus({
	status,
	lastError,
	warnings,
}: GenerationStatusProps) {
	const activeIndex = STAGES.indexOf(status as typeof STAGES[number]);
	const progress =
		status === "failed"
			? 0
			: status === "completed"
				? 100
				: Math.max(8, ((activeIndex + 1) / STAGES.length) * 100);

	return (
		<section className="rounded-xl border border-border/80 bg-muted/20 p-4">
			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="text-sm font-medium">Pipeline status</p>
					<p className="text-sm text-muted-foreground">
						{status.replaceAll("_", " ")}
					</p>
				</div>
				<p className="text-sm text-muted-foreground">{Math.round(progress)}%</p>
			</div>
			<Progress value={progress} className="mt-3" />
			{lastError ? (
				<p className="mt-3 text-sm text-destructive">{lastError}</p>
			) : null}
			{warnings?.length ? (
				<ul className="mt-3 space-y-1 text-xs text-muted-foreground">
					{warnings.map((warning) => (
						<li key={warning}>Warning: {warning}</li>
					))}
				</ul>
			) : null}
		</section>
	);
}
