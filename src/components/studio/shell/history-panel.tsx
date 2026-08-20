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
import { Button } from "#/components/ui/button";
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
import { HistoryPanelSkeleton } from "#/components/studio/shell/studio-run-skeleton";

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
			await deleteRun({ runId: pendingDeleteId });
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
