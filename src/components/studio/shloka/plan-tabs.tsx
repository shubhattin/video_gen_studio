import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip";

export type PlanTabSummary = {
	_id: string;
	attemptNumber: number;
	title?: string;
	status: string;
	/** Number of videos produced by this plan (gallery refs, not deleted). */
	videoCount?: number;
};

function planLabel(plan: PlanTabSummary) {
	return plan.title?.trim() || `Plan ${plan.attemptNumber}`;
}

/**
 * Tab label capped to roughly 4–5 words. When the full label is clipped, a
 * tooltip shows the complete title on hover.
 */
function TabLabel({ label }: { label: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	const [truncated, setTruncated] = useState(false);

	const checkTruncated = () => {
		const el = ref.current;
		if (el) {
			setTruncated(el.scrollWidth > el.clientWidth);
		}
	};

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span
						ref={ref}
						onMouseEnter={checkTruncated}
						onFocus={checkTruncated}
						className="max-w-[12rem] overflow-hidden text-ellipsis whitespace-nowrap"
					>
						{label}
					</span>
				}
			/>
			{truncated ? <TooltipContent side="top">{label}</TooltipContent> : null}
		</Tooltip>
	);
}

/**
 * Plan tab bar for the shloka studio: one tab per plan (labeled by title or
 * "Plan N"), plus pencil (rename), trash (delete), and "+" (create) buttons.
 * Deleting a plan never deletes its videos — they become abandoned gallery
 * items, and the confirmation dialog warns when that applies.
 */
export function PlanTabs({
	plans,
	activePlanId,
	onSelect,
	onCreate,
	onRename,
	onDelete,
	creating = false,
	disabled = false,
	className,
}: {
	plans: PlanTabSummary[];
	activePlanId?: string | null;
	onSelect: (planId: string) => void;
	onCreate: () => void;
	onRename?: (planId: string, title: string) => Promise<void> | void;
	onDelete?: (planId: string) => Promise<void> | void;
	creating?: boolean;
	disabled?: boolean;
	className?: string;
}) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [renameOpen, setRenameOpen] = useState(false);
	const [renameValue, setRenameValue] = useState("");

	const activePlan = plans.find((plan) => plan._id === activePlanId);
	const activeVideoCount = activePlan?.videoCount ?? 0;

	const openRename = () => {
		setRenameValue(activePlan?.title ?? "");
		setRenameOpen(true);
	};

	const confirmRename = async () => {
		if (!activePlanId || !onRename) return;
		setRenaming(true);
		try {
			await onRename(activePlanId, renameValue);
			setRenameOpen(false);
		} finally {
			setRenaming(false);
		}
	};

	const confirmDelete = async () => {
		if (!activePlanId || !onDelete) return;
		setDeleting(true);
		try {
			await onDelete(activePlanId);
			setDeleteOpen(false);
		} finally {
			setDeleting(false);
		}
	};

	return (
		<div className={`flex items-center gap-2 ${className ?? ""}`}>
			<Tabs
				value={activePlanId ?? undefined}
				onValueChange={(value) => {
					if (disabled) return;
					onSelect(value);
				}}
			>
				<TabsList>
					{plans.map((plan) => (
						<TabsTrigger key={plan._id} value={plan._id} disabled={disabled}>
							<TabLabel label={planLabel(plan)} />
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>
			{activePlan ? (
				<>
					{onRename ? (
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="size-8 shrink-0"
							disabled={disabled}
							aria-label="Rename plan"
							onClick={openRename}
						>
							<Pencil className="size-3.5" />
						</Button>
					) : null}
					{onDelete ? (
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="size-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
							disabled={disabled || deleting}
							aria-label="Delete plan"
							onClick={() => setDeleteOpen(true)}
						>
							<Trash2 className="size-3.5" />
						</Button>
					) : null}
				</>
			) : null}
			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogTrigger
					render={
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="size-8 shrink-0"
							disabled={disabled || creating}
							aria-label="Create new plan"
						>
							<Plus className="size-4" />
						</Button>
					}
				/>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Create a new plan?</AlertDialogTitle>
						<AlertDialogDescription>
							This starts a fresh plan using your current video settings. Your
							existing plans stay available and can be switched back to at any
							time.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setConfirmOpen(false);
								onCreate();
							}}
						>
							Create plan
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this plan?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes the plan and its prompts and scenes. This
							cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{activeVideoCount > 0 ? (
						<div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
							This plan has {activeVideoCount} video
							{activeVideoCount === 1 ? "" : "s"} linked to it. Videos are{" "}
							<strong>not deleted</strong> — they become abandoned items in the
							shared gallery and can be removed individually from there.
						</div>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleting}
							onClick={() => void confirmDelete()}
						>
							{deleting ? "Deleting…" : "Delete plan"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<Dialog open={renameOpen} onOpenChange={setRenameOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rename plan</DialogTitle>
						<DialogDescription>
							Give this plan a custom name — it’s used as the tab label.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						<Input
							value={renameValue}
							onChange={(event) => setRenameValue(event.target.value)}
							placeholder={
								activePlan ? `Plan ${activePlan.attemptNumber}` : "Plan name"
							}
							maxLength={90}
							autoFocus
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									void confirmRename();
								}
							}}
						/>
						<p className="text-xs text-muted-foreground">
							Leave blank to use the default “
							{activePlan ? `Plan ${activePlan.attemptNumber}` : "Plan"}” label.
						</p>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							disabled={renaming}
							onClick={() => setRenameOpen(false)}
						>
							Cancel
						</Button>
						<Button disabled={renaming} onClick={() => void confirmRename()}>
							{renaming ? "Saving…" : "Save"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
