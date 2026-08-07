import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
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
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { cn } from "#/lib/utils";

type HistoryRun = {
	_id: Id<"generationRuns">;
	provenance: string;
	status: string;
	shlokaText?: string;
	selectedModelId?: string;
	createdAt: number;
	videos?: Array<{ url?: string | null }>;
};

type HistoryPanelProps = {
	selectedRunId?: Id<"generationRuns"> | null;
	onSelect: (runId: Id<"generationRuns">) => void;
	onDeleted?: (runId: Id<"generationRuns">) => void;
};

export function HistoryPanel({
	selectedRunId,
	onSelect,
	onDeleted,
}: HistoryPanelProps) {
	const runs = useQuery(api.studio.listRecentRuns, { limit: 12 });
	const deleteRun = useMutation(api.studio.deleteRun);
	const [pendingDeleteId, setPendingDeleteId] =
		useState<Id<"generationRuns"> | null>(null);
	const [deleting, setDeleting] = useState(false);

	const confirmDelete = async () => {
		if (!pendingDeleteId) {
			return;
		}
		setDeleting(true);
		try {
			await deleteRun({ runId: pendingDeleteId });
			onDeleted?.(pendingDeleteId);
			setPendingDeleteId(null);
		} finally {
			setDeleting(false);
		}
	};

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
						<div
							key={run._id}
							className={cn(
								"flex items-stretch gap-0.5 overflow-hidden rounded-lg border transition-colors duration-200",
								selectedRunId === run._id
									? "border-primary/50 bg-muted/50"
									: "border-border/80 bg-card",
							)}
						>
							<button
								type="button"
								onClick={() => onSelect(run._id)}
								className="min-h-11 min-w-0 flex-1 px-3 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<div className="flex items-center gap-2">
									<span
										className={cn(
											"size-2 shrink-0 rounded-full",
											statusDotClass(run.status),
										)}
										title={run.status.replaceAll("_", " ")}
										aria-label={run.status.replaceAll("_", " ")}
									/>
									<span className="truncate text-sm font-medium">
										{run.provenance === "shloka"
											? run.shlokaText?.slice(0, 42) || "Shloka run"
											: run.selectedModelId || "Model studio"}
									</span>
								</div>
								<p className="mt-1 truncate pl-4 text-xs text-muted-foreground">
									{formatDistanceToNow(run.createdAt, { addSuffix: true })}
									{run.videos?.length
										? ` · ${run.videos.length} video${run.videos.length === 1 ? "" : "s"}`
										: ""}
								</p>
							</button>
							<div className="flex shrink-0 items-start pt-1.5 pr-1">
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
												aria-label="Run actions"
												onClick={(event) => event.stopPropagation()}
											/>
										}
									>
										<MoreHorizontal className="size-4" />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="min-w-40">
										<DropdownMenuItem
											variant="destructive"
											className="gap-2"
											onClick={() => setPendingDeleteId(run._id)}
										>
											<Trash2 className="size-4" />
											Delete run
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</div>
					))
				)}
			</div>

			<AlertDialog
				open={pendingDeleteId != null}
				onOpenChange={(open) => {
					if (!open) {
						setPendingDeleteId(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this run?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes the run and all associated reference
							images and videos from Convex storage. This cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleting}
							onClick={confirmDelete}
						>
							{deleting ? "Deleting…" : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function statusDotClass(status: string) {
	if (status === "completed") {
		return "bg-emerald-500";
	}
	if (status === "failed") {
		return "bg-destructive";
	}
	if (
		status === "planning" ||
		status === "image_generating" ||
		status === "video_generating"
	) {
		return "bg-amber-500";
	}
	return "bg-muted-foreground/50";
}
