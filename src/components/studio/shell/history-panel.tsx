import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
	AudioLines,
	Clapperboard,
	Info,
	MoreHorizontal,
	Music,
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

type HistoryRunId =
	| Id<"generationRuns">
	| Id<"modelStudioRuns">
	| Id<"audioRuns">;

type HistoryRunKind = "shloka" | "model-studio" | "audio";

type HistoryRun = {
	_id: HistoryRunId;
	kind: HistoryRunKind;
	audioMode?: "direct" | "guided";
	status: string;
	title?: string;
	subtitle?: string;
	selectedModelId?: string;
	createdAt: number;
	videoCount?: number;
	audioCount?: number;
};

type HistoryPanelProps = {
	selectedRunId?: HistoryRunId | null;
	onDeleted?: (runId: HistoryRunId) => void;
};

function pathForKind(kind: string): "/" | "/studio" | "/audio" {
	if (kind === "model-studio") return "/studio";
	if (kind === "audio") return "/audio";
	return "/";
}

/** Badge icon + label + fallback title for a history row. */
function runKindMeta(run: Pick<HistoryRun, "kind" | "audioMode">) {
	if (run.kind === "shloka") {
		return { icon: Sparkles, label: "Shloka", fallback: "Shloka Run" };
	}
	if (run.kind === "audio") {
		return run.audioMode === "guided"
			? { icon: Music, label: "Song", fallback: "Sanskrit Song" }
			: { icon: AudioLines, label: "Audio", fallback: "Audio Run" };
	}
	return { icon: Clapperboard, label: "Model", fallback: "Model Run" };
}

export function HistoryPanel({ selectedRunId, onDeleted }: HistoryPanelProps) {
	const { isAuthenticated } = useConvexAuth();
	// Single unified feed — subscribe only once auth is ready so the admin
	// query never fires without a JWT and dies with an auth error.
	const runs = useQuery(
		api.studio.queries.listRecentActivity,
		isAuthenticated ? { limit: 24 } : "skip",
	);
	const deleteRun = useMutation(api.studio.mutations.deleteRun);
	const deleteModelStudioRun = useMutation(
		api.studio.mutations.deleteModelStudioRun,
	);
	const renameRun = useMutation(api.studio.mutations.renameRun);
	const renameModelStudioRun = useMutation(
		api.studio.mutations.renameModelStudioRun,
	);
	const generateRunTitle = useAction(api.studio.actions.generateRunTitle);
	const generateModelStudioTitle = useAction(
		api.studio.actions.generateModelStudioTitle,
	);
	const deleteAudioRun = useMutation(api.audio.mutations.deleteAudioRun);
	const renameAudioRun = useMutation(api.audio.mutations.renameAudioRun);
	const generateAudioRunTitle = useAction(
		api.audio.actions.generateAudioRunTitle,
	);
	const [pendingDeleteId, setPendingDeleteId] = useState<HistoryRunId | null>(
		null,
	);
	const [pendingDeleteKind, setPendingDeleteKind] =
		useState<HistoryRunKind | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [deleteMedia, setDeleteMedia] = useState(false);
	const pendingShlokaDeleteId =
		pendingDeleteId != null && pendingDeleteKind === "shloka"
			? (pendingDeleteId as Id<"generationRuns">)
			: null;
	const deleteMediaCounts = useQuery(
		api.studio.queries.getRunMediaCounts,
		pendingShlokaDeleteId ? { runId: pendingShlokaDeleteId } : "skip",
	);
	const [renameTarget, setRenameTarget] = useState<HistoryRun | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [renaming, setRenaming] = useState(false);
	const [infoTarget, setInfoTarget] = useState<HistoryRun | null>(null);
	const [regeneratingId, setRegeneratingId] = useState<HistoryRunId | null>(
		null,
	);

	const historyRuns = runs as HistoryRun[] | undefined;

	const confirmDelete = async () => {
		if (!pendingDeleteId || !pendingDeleteKind) {
			return;
		}
		setDeleting(true);
		try {
			if (pendingDeleteKind === "shloka") {
				await deleteRun({
					runId: pendingDeleteId as Id<"generationRuns">,
					deleteMedia,
				});
			} else if (pendingDeleteKind === "audio") {
				await deleteAudioRun({
					runId: pendingDeleteId as Id<"audioRuns">,
					deleteMedia,
				});
			} else {
				await deleteModelStudioRun({
					runId: pendingDeleteId as Id<"modelStudioRuns">,
					deleteMedia,
				});
			}
			onDeleted?.(pendingDeleteId);
			setPendingDeleteId(null);
			setPendingDeleteKind(null);
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
			if (renameTarget.kind === "shloka") {
				await renameRun({
					runId: renameTarget._id as Id<"generationRuns">,
					title: renameValue,
				});
			} else if (renameTarget.kind === "audio") {
				await renameAudioRun({
					runId: renameTarget._id as Id<"audioRuns">,
					title: renameValue,
				});
			} else {
				await renameModelStudioRun({
					runId: renameTarget._id as Id<"modelStudioRuns">,
					title: renameValue,
				});
			}
			setRenameTarget(null);
		} finally {
			setRenaming(false);
		}
	};

	const regenerateTitle = async (runId: HistoryRunId, kind: HistoryRunKind) => {
		setRegeneratingId(runId);
		try {
			if (kind === "audio") {
				await generateAudioRunTitle({
					runId: runId as Id<"audioRuns">,
					force: true,
				});
			} else if (kind === "model-studio") {
				await generateModelStudioTitle({
					runId: runId as Id<"modelStudioRuns">,
					force: true,
				});
			} else {
				await generateRunTitle({
					runId: runId as Id<"generationRuns">,
					force: true,
				});
			}
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
						const kindMeta = runKindMeta(run);
						const KindIcon = kindMeta.icon;
						const to = pathForKind(run.kind);
						const title =
							run.title?.trim() || run.subtitle?.trim() || kindMeta.fallback;
						const meta = [
							formatDistanceToNow(run.createdAt, { addSuffix: true }),
							run.videoCount
								? `${run.videoCount} video${run.videoCount === 1 ? "" : "s"}`
								: null,
							run.audioCount
								? `${run.audioCount} take${run.audioCount === 1 ? "" : "s"}`
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
												<KindIcon className="size-3" />
												{kindMeta.label}
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
											onClick={() => void regenerateTitle(run._id, run.kind)}
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
											className="gap-2"
											onClick={() => setInfoTarget(run)}
										>
											<Info />
											View details
										</DropdownMenuItem>
										<DropdownMenuItem
											variant="destructive"
											className="gap-2"
											onClick={() => {
												setDeleteMedia(false);
												setPendingDeleteKind(run.kind);
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
						setPendingDeleteKind(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this run?</AlertDialogTitle>
						<AlertDialogDescription>
							{pendingDeleteKind === "audio"
								? "This deletes the run and its script. By default its audio takes and reference images stay in the shared gallery."
								: "This deletes the run, its plans, and text. By default its images and videos stay in the shared gallery."}
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
									{pendingDeleteKind === "audio"
										? "Also delete this run’s audio takes and images"
										: "Also delete this run’s images and videos"}
								</span>
								<span className="text-xs text-muted-foreground">
									Removes generated media from the shared gallery.
								</span>
							</span>
						</label>

						{deleteMedia ? (
							<div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
								{pendingDeleteKind !== "shloka" ? (
									"This permanently deletes this run’s generated files and any reference images no other run uses. This cannot be undone."
								) : deleteMediaCounts === undefined ? (
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

			<Dialog
				open={infoTarget != null}
				onOpenChange={(open) => {
					if (!open) {
						setInfoTarget(null);
					}
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Run details</DialogTitle>
						<DialogDescription>
							Full ID and metadata for debugging.
						</DialogDescription>
					</DialogHeader>
					{infoTarget ? (
						<div className="flex flex-col gap-3 text-sm">
							<div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs">
								<span className="text-muted-foreground">id</span>
								<span className="break-all font-mono">{infoTarget._id}</span>
							</div>
							<div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs">
								<span className="text-muted-foreground">Kind</span>
								<span className="capitalize">
									{runKindMeta(infoTarget).label}
								</span>
							</div>
							<div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs">
								<span className="text-muted-foreground">Status</span>
								<span className="capitalize">
									{infoTarget.status.replaceAll("_", " ")}
								</span>
							</div>
							{infoTarget.title ? (
								<div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs">
									<span className="text-muted-foreground">Title</span>
									<span className="break-words">{infoTarget.title}</span>
								</div>
							) : null}
							{infoTarget.selectedModelId ? (
								<div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs">
									<span className="text-muted-foreground">Model</span>
									<span className="break-all font-mono">
										{infoTarget.selectedModelId}
									</span>
								</div>
							) : null}
							<div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs">
								<span className="text-muted-foreground">Created</span>
								<span>{new Date(infoTarget.createdAt).toLocaleString()}</span>
							</div>
							<div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs">
								<span className="text-muted-foreground">
									{infoTarget.kind === "audio" ? "Takes" : "Videos"}
								</span>
								<span>
									{infoTarget.kind === "audio"
										? (infoTarget.audioCount ?? 0)
										: (infoTarget.videoCount ?? 0)}
								</span>
							</div>
						</div>
					) : null}
					<DialogFooter>
						<Button variant="outline" onClick={() => setInfoTarget(null)}>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
