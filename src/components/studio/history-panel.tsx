import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
import type { StudioRunSearch } from "#/lib/studio-run-search";
import { cn } from "#/lib/utils";

type HistoryRun = {
	_id: Id<"generationRuns">;
	provenance: "shloka" | "model-studio" | string;
	status: string;
	shlokaText?: string;
	selectedModelId?: string;
	createdAt: number;
	videos?: Array<{ url?: string | null }>;
};

type StudioPath = "/" | "/studio";

type HistoryPanelProps = {
	to: StudioPath;
	provenance?: "shloka" | "model-studio";
	selectedRunId?: Id<"generationRuns"> | null;
	onDeleted?: (runId: Id<"generationRuns">) => void;
};

function clearRunSearch(prev: StudioRunSearch): StudioRunSearch {
	const { run: _removed, ...rest } = prev;
	return rest;
}

export function HistoryPanel({
	to,
	provenance,
	selectedRunId,
	onDeleted,
}: HistoryPanelProps) {
	const runs = useQuery(api.studio.listRecentRuns, { limit: 24 });
	const deleteRun = useMutation(api.studio.deleteRun);
	const [pendingDeleteId, setPendingDeleteId] =
		useState<Id<"generationRuns"> | null>(null);
	const [deleting, setDeleting] = useState(false);

	const filteredRuns = useMemo(() => {
		if (!runs) return undefined;
		if (!provenance) return runs as HistoryRun[];
		return (runs as HistoryRun[]).filter(
			(run) => run.provenance === provenance,
		);
	}, [runs, provenance]);

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
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton
						tooltip="New run"
						render={<Link to={to} search={clearRunSearch} replace />}
					>
						<Plus />
						<span>New run</span>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>

			{filteredRuns === undefined ? (
				<p className="px-2 text-sm text-muted-foreground">Loading history…</p>
			) : filteredRuns.length === 0 ? (
				<p className="px-2 text-sm text-muted-foreground">
					{provenance === "shloka"
						? "No Shloka runs yet."
						: provenance === "model-studio"
							? "No Model Studio runs yet."
							: "No runs yet."}
				</p>
			) : (
				<SidebarMenu className="gap-1">
					{filteredRuns.map((run) => {
						const title =
							run.provenance === "shloka"
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
									<span
										className={cn(
											"mt-1.5 size-2 shrink-0 rounded-full",
											statusDotClass(run.status),
										)}
										title={run.status.replaceAll("_", " ")}
										aria-label={run.status.replaceAll("_", " ")}
									/>
									<span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
										<span className="truncate font-medium">{title}</span>
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
