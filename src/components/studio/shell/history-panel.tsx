import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
	Clapperboard,
	MoreHorizontal,
	Pencil,
	RefreshCw,
	Sparkles,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { HistoryPanelSkeleton } from "#/components/studio/shell/studio-run-skeleton";
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
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
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

type HistoryRun = {
	_id: Id<"generationRuns">;
	provenance: "shloka" | "model-studio" | string;
	status: string;
	title?: string;
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
	const runs = useQuery(api.studio.queries.listRecentRuns, { limit: 24 });
	const deleteRun = useMutation(api.studio.mutations.deleteRun);
	const renameRun = useMutation(api.studio.mutations.renameRun);
	const generateRunTitle = useAction(api.studio.actions.generateRunTitle);
	const [pendingDeleteId, setPendingDeleteId] =
		useState<Id<"generationRuns"> | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [deleteMedia, setDeleteMedia] = useState(false);
	const deleteMediaCounts = useQuery(
		api.studio.queries.getRunMediaCounts,
		pendingDeleteId ? { runId: pendingDeleteId } : "skip",
	);
	const [renameTarget, setRenameTarget] = useState<HistoryRun | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [renaming, setRenaming] = useState(false);
	const [regeneratingId, setRegeneratingId] =
		useState<Id<"generationRuns"> | null>(null);

	const historyRuns = runs as HistoryRun[] | undefined;

	const confirmDelete = async () => {
		if (!pendingDeleteId) {
			return;
		}
		setDeleting(true);
		try {
			await deleteRun({
				runId: pendingDeleteId,
				deleteMedia,
			});
			onDeleted?.(pendingDeleteId);
			setPendingDeleteId(null);
		} finally {
			setDeleting(false);
		}
	};

	const openRename = (run: HistoryRun) => {
		setRenameTarget(run);
		setRenameValue(run.title ?? "");
	};

	const confirmRename = async () => {
		if (!renameTarget) {
			return;
		}
		setRenaming(true);
		try {
			await renameRun({ runId: renameTarget._id, title: renameValue });
			setRenameTarget(null);
		} finally {
			setRenaming(false);
		}
	};

	const regenerateTitle = async (runId: Id<"generationRuns">) => {
		setRegeneratingId(runId);
		try {
			await generateRunTitle({ runId, force: true });
		} finally {
			setRegeneratingId(null);
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
						const title =
							run.title?.trim() || (shloka ? "Shloka Run" : "Model Run");
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
									<DropdownMenuContent align="end" className="min-w-44">
										<DropdownMenuItem
											className="gap-2"
											onClick={() => openRename(run)}
										>
											<Pencil />
											Rename title
										</DropdownMenuItem>
										<DropdownMenuItem
											className="gap-2"
											disabled={regeneratingId === run._id}
											onClick={() => void regenerateTitle(run._id)}
										>
											<RefreshCw
												className={
													regeneratingId === run._id ? "animate-spin" : ""
												}
											/>
											{regeneratingId === run._id
												? "Generating…"
												: "Regenerate title"}
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											variant="destructive"
											className="gap-2"
											onClick={() => {
												setDeleteMedia(false);
												setPendingDeleteId(run._id);
											}}
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
							This deletes the run, its plans, and text. By default its images
							and videos stay in the shared gallery.
						</AlertDialogDescription>
					</AlertDialogHeader>

					<div className="flex flex-col gap-2.5">
						<label
							htmlFor="delete-run-media"
							className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-muted/40 p-3 transition-colors hover:bg-muted/60"
						>
							<Checkbox
								id="delete-run-media"
								checked={deleteMedia}
								disabled={deleting}
								onCheckedChange={(checked) => setDeleteMedia(Boolean(checked))}
								className="mt-0.5"
							/>
							<span className="flex min-w-0 flex-1 flex-col gap-1">
								<span className="text-sm font-medium leading-tight">
									Also delete this run’s images and videos
								</span>
								<span className="text-xs text-muted-foreground">
									Removes generated media from the shared gallery.
								</span>
							</span>
						</label>

						{deleteMedia ? (
							<div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
								{deleteMediaCounts === undefined ? (
									"Checking which files are safe to delete…"
								) : deleteMediaCounts.images === 0 &&
									deleteMediaCounts.videos === 0 ? (
									"No media linked to this run is used only by this run — everything it references is reused elsewhere, so the gallery files will be kept."
								) : (
									<>
										This permanently deletes{" "}
										<strong>
											{deleteMediaCounts.images} image
											{deleteMediaCounts.images === 1 ? "" : "s"}
										</strong>{" "}
										and{" "}
										<strong>
											{deleteMediaCounts.videos} video
											{deleteMediaCounts.videos === 1 ? "" : "s"}
										</strong>{" "}
										from the shared gallery (only files not used by other runs).
										This cannot be undone.
									</>
								)}
							</div>
						) : null}
					</div>

					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleting}
							onClick={confirmDelete}
						>
							{deleting
								? "Deleting…"
								: deleteMedia
									? "Delete run & media"
									: "Delete run"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<Dialog
				open={renameTarget != null}
				onOpenChange={(open) => {
					if (!open) {
						setRenameTarget(null);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rename run</DialogTitle>
						<DialogDescription>
							Give this run a custom title. It’s used in your history sidebar.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						<Label htmlFor="run-title" className="text-xs">
							Title
						</Label>
						<Input
							id="run-title"
							value={renameValue}
							onChange={(event) => setRenameValue(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									void confirmRename();
								}
							}}
							maxLength={90}
							placeholder="Untitled run"
							autoFocus
						/>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							disabled={renaming}
							onClick={() => setRenameTarget(null)}
						>
							Cancel
						</Button>
						<Button
							disabled={renaming || !renameValue.trim()}
							onClick={() => void confirmRename()}
						>
							{renaming ? "Saving…" : "Save"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
