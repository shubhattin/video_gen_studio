import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { Clapperboard, MoreHorizontal, Sparkles, Trash2 } from "lucide-react";
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
import { Badge } from "#/components/ui/badge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from "#/components/ui/sidebar";
import {
	isActiveRunStatus,
	runStatusPillClass,
	runStatusPillLabel,
} from "#/lib/studio-run-status";
import { cn } from "#/lib/utils";
import { HistoryPanelSkeleton } from "#/components/studio/studio-run-skeleton";

type HistoryRun = {
	_id: Id<"generationRuns">;
	provenance: "shloka" | "model-studio" | string;
	status: string;
	shlokaText?: string;
	selectedModelId?: string;
	createdAt: number;
	videos?: Array<{ url?: string | null }>;
};

type HistoryPanelProps = {
	selectedRunId?: Id<"generationRuns"> | null;
	onDeleted?: (runId: Id<"generationRuns">) => void;
};

function pathForProvenance(provenance: string): "/" | "/studio" {
	return provenance === "model-studio" ? "/studio" : "/";
}

function isShlokaRun(provenance: string) {
	return provenance !== "model-studio";
}

export function HistoryPanel({ selectedRunId, onDeleted }: HistoryPanelProps) {
	const runs = useQuery(api.studio.listRecentRuns, { limit: 24 });
	const deleteRun = useMutation(api.studio.deleteRun);
	const [pendingDeleteId, setPendingDeleteId] =
		useState<Id<"generationRuns"> | null>(null);
	const [deleting, setDeleting] = useState(false);

	const historyRuns = runs as HistoryRun[] | undefined;

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
		<div className="flex min-h-0 flex-col gap-2">
			{historyRuns === undefined ? (
				<HistoryPanelSkeleton />
			) : historyRuns.length === 0 ? (
				<p className="px-2 text-sm text-muted-foreground">No runs yet.</p>
			) : (
				<SidebarMenu className="gap-1">
					{historyRuns.map((run) => {
						const shloka = isShlokaRun(run.provenance);
						const to = pathForProvenance(run.provenance);
						const title = shloka
							? run.shlokaText?.slice(0, 48) || "Shloka run"
							: run.selectedModelId || "Model studio";
						const meta = [
							formatDistanceToNow(run.createdAt, { addSuffix: true }),
							run.videos?.length
								? `${run.videos.length} video${run.videos.length === 1 ? "" : "s"}`
								: null,
						]
							.filter(Boolean)
							.join(" · ");
						const active = isActiveRunStatus(run.status);

						return (
							<SidebarMenuItem key={run._id}>
								<SidebarMenuButton
									isActive={selectedRunId === run._id}
									className="h-auto items-start py-2"
									render={
										<Link
											to={to}
											search={(prev) => ({
												...prev,
												run: run._id,
											})}
										/>
									}
								>
									<span className="flex min-w-0 flex-1 flex-col gap-1.5 text-left">
										<span className="flex min-w-0 items-center gap-1.5">
											<Badge
												variant="outline"
												className="h-5 shrink-0 gap-1 px-1.5 font-normal"
											>
												{shloka ? (
													<Sparkles className="size-3" />
												) : (
													<Clapperboard className="size-3" />
												)}
												{shloka ? "Shloka" : "Model"}
											</Badge>
											<span
												className={cn(
													"inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium",
													runStatusPillClass(run.status),
												)}
												title={run.status.replaceAll("_", " ")}
											>
												{active ? (
													<span className="size-1.5 animate-pulse rounded-full bg-current" />
												) : null}
												{runStatusPillLabel(run.status)}
											</span>
										</span>
										<span className="truncate text-sm font-medium">
											{title}
										</span>
										<span className="truncate text-xs text-muted-foreground">
											{meta}
										</span>
									</span>
								</SidebarMenuButton>
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<SidebarMenuAction
												showOnHover
												aria-label="Run actions"
												onClick={(event) => event.stopPropagation()}
											/>
										}
									>
										<MoreHorizontal />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="min-w-40">
										<DropdownMenuItem
											variant="destructive"
											className="gap-2"
											onClick={() => setPendingDeleteId(run._id)}
										>
											<Trash2 />
											Delete run
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</SidebarMenuItem>
						);
					})}
				</SidebarMenu>
			)}

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
							images and videos from storage. This cannot be undone.
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
