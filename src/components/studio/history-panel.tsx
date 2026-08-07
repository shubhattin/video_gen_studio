import { useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { Badge } from "#/components/ui/badge";
import { cn } from "#/lib/utils";

type HistoryRun = Doc<"generationRuns"> & {
	referenceImageUrl?: string | null;
	videoUrl?: string | null;
};

type HistoryPanelProps = {
	selectedRunId?: Id<"generationRuns"> | null;
	onSelect: (runId: Id<"generationRuns">) => void;
};

export function HistoryPanel({ selectedRunId, onSelect }: HistoryPanelProps) {
	const runs = useQuery(api.studio.listRecentRuns, { limit: 12 });

	return (
		<div className="space-y-3">
			<div>
				<h2 className="text-sm font-medium">Recent runs</h2>
				<p className="text-xs text-muted-foreground">
					Latest generations across Shloka and Model Studio
				</p>
			</div>
			<div className="space-y-2">
				{runs === undefined ? (
					<p className="text-sm text-muted-foreground">Loading history…</p>
				) : runs.length === 0 ? (
					<p className="text-sm text-muted-foreground">No runs yet.</p>
				) : (
					runs.map((run: HistoryRun) => (
						<button
							key={run._id}
							type="button"
							onClick={() => onSelect(run._id)}
							className={cn(
								"w-full rounded-lg border px-3 py-3 text-left transition-colors duration-200 min-h-11",
								"hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								selectedRunId === run._id
									? "border-primary/50 bg-muted/50"
									: "border-border/80 bg-card",
							)}
						>
							<div className="flex items-center justify-between gap-2">
								<span className="truncate text-sm font-medium">
									{run.provenance === "shloka"
										? run.shlokaText?.slice(0, 42) || "Shloka run"
										: run.selectedModelId || "Model studio"}
								</span>
								<StatusBadge status={run.status} />
							</div>
							<p className="mt-1 text-xs text-muted-foreground">
								{formatDistanceToNow(run.createdAt, { addSuffix: true })}
							</p>
						</button>
					))
				)}
			</div>
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	const tone =
		status === "completed"
			? "bg-primary/15 text-primary"
			: status === "failed"
				? "bg-destructive/15 text-destructive"
				: "bg-muted text-muted-foreground";

	return (
		<Badge variant="outline" className={cn("shrink-0 border-0", tone)}>
			{status.replaceAll("_", " ")}
		</Badge>
	);
}
