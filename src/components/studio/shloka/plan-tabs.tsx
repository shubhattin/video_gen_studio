import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
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

export type PlanTabSummary = {
	_id: string;
	attemptNumber: number;
	title?: string;
	status: string;
};

function planLabel(plan: PlanTabSummary) {
	return plan.title?.trim() || `Plan ${plan.attemptNumber}`;
}

/**
 * Plan tab bar for the shloka studio: one tab per plan (labeled by title or
 * "Plan N"), a pencil button to rename the active plan, and a "+" button that
 * creates a fresh plan after confirmation.
 */
export function PlanTabs({
	plans,
	activePlanId,
	onSelect,
	onCreate,
	onRename,
	creating = false,
	disabled = false,
	className,
}: {
	plans: PlanTabSummary[];
	activePlanId?: string | null;
	onSelect: (planId: string) => void;
	onCreate: () => void;
	onRename?: (planId: string, title: string) => Promise<void> | void;
	creating?: boolean;
	disabled?: boolean;
	className?: string;
}) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [renameOpen, setRenameOpen] = useState(false);
	const [renameValue, setRenameValue] = useState("");
	const [renaming, setRenaming] = useState(false);

	const activePlan = plans.find((plan) => plan._id === activePlanId);

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

	return (
		<div className={`flex items-center gap-2 ${className ?? ""}`}>
			<Tabs
				value={activePlanId ?? undefined}
				onValueChange={(value) => onSelect(value)}
			>
				<TabsList>
					{plans.map((plan) => (
						<TabsTrigger key={plan._id} value={plan._id}>
							{planLabel(plan)}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>
			{onRename && activePlan ? (
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
