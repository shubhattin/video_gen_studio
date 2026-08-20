import { formatDistanceToNow } from "date-fns";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { Badge } from "#/components/ui/badge";
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
import { Label } from "#/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import { cn } from "#/lib/utils";

export type ShlokaPlanAttemptSummary = {
	_id: string;
	attemptNumber: number;
	status: string;
	title?: string;
	plannerSystemPrompt?: string;
	plannerModel?: string;
	createdAt?: number;
};

type ShlokaPlanAttemptControlsProps = {
	attempts: ShlokaPlanAttemptSummary[];
	activePlanId?: string | null;
	onSelectAttempt?: (planId: string) => void;
	onRenameAttempt?: (planId: string, title: string) => Promise<void> | void;
	disabled?: boolean;
	isPlanningNext?: boolean;
	className?: string;
};

const PLANNING_TAB_ID = "__planning_next__";

function promptLabel(prompt?: string) {
	const trimmed = prompt?.trim();
	if (!trimmed) return "Default prompt";
	return trimmed.length > 42 ? `${trimmed.slice(0, 42)}…` : trimmed;
}

function planName(attempt: ShlokaPlanAttemptSummary) {
	return attempt.title?.trim() || `Plan ${attempt.attemptNumber}`;
}

export function ShlokaPlanAttemptControls({
	attempts,
	activePlanId,
	onSelectAttempt,
	onRenameAttempt,
	disabled,
	isPlanningNext = false,
	className,
}: ShlokaPlanAttemptControlsProps) {
	const [renameOpen, setRenameOpen] = useState(false);
	const [titleValue, setTitleValue] = useState("");
	const [renaming, setRenaming] = useState(false);

	if (attempts.length === 0 && !isPlanningNext) {
		return null;
	}

	const ordered = [...attempts].sort(
		(a, b) => a.attemptNumber - b.attemptNumber,
	);
	const active =
		ordered.find((item) => item._id === activePlanId) ??
		ordered[ordered.length - 1];
	const nextAttemptNumber =
		(ordered.reduce((acc, item) => Math.max(acc, item.attemptNumber), 0) ||
			active?.attemptNumber ||
			0) + 1;
	const showTabStrip = ordered.length > 1 || isPlanningNext;
	const activeValue = isPlanningNext
		? PLANNING_TAB_ID
		: (active?._id ?? ordered[0]?._id);
	const switchLocked = disabled || isPlanningNext;
	const canRename = Boolean(active && ordered.length > 0 && !isPlanningNext);

	const openRename = () => {
		setTitleValue(active?.title ?? "");
		setRenameOpen(true);
	};

	const confirmRename = async () => {
		if (!active || !onRenameAttempt) return;
		setRenaming(true);
		try {
			await onRenameAttempt(active._id, titleValue);
			setRenameOpen(false);
		} finally {
			setRenaming(false);
		}
	};

	return (
		<section
			className={cn(
				"flex flex-col gap-3 border-t border-border/80 pt-6",
				className,
			)}
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="font-heading text-xl font-semibold">Creative plans</h2>
					<p className="text-sm text-muted-foreground">
						{isPlanningNext
							? `Creating plan ${nextAttemptNumber}. Previous plans stay available when this finishes.`
							: showTabStrip
								? "Switch plans to compare prompts and scene scripts."
								: "Each regenerate keeps a separate attempt you can revisit."}
					</p>
				</div>
			</div>

			{showTabStrip && activeValue ? (
				<div className="flex items-center gap-2">
					<Tabs
						value={activeValue}
						onValueChange={(value) => {
							if (
								switchLocked ||
								!value ||
								value === PLANNING_TAB_ID ||
								value === active?._id
							) {
								return;
							}
							onSelectAttempt?.(value);
						}}
						className="min-w-0 flex-1 gap-3"
					>
					<TabsList
						variant="line"
						className={cn(
							"h-auto max-w-full flex-wrap justify-start gap-1",
							switchLocked && "pointer-events-none",
						)}
					>
						{ordered.map((attempt) => (
							<TabsTrigger
								key={attempt._id}
								value={attempt._id}
								disabled={switchLocked}
								className={cn(
									"flex-none flex-col items-start gap-0.5 px-3 py-2",
									isPlanningNext && "opacity-60",
								)}
							>
								<span className="flex min-w-0 items-center gap-1.5">
									{attempt.title ? (
										<Tooltip>
											<TooltipTrigger
												render={<span className="min-w-0 font-medium" />}
											>
												<span className="block max-w-48 truncate">
													{planName(attempt)}
												</span>
											</TooltipTrigger>
											<TooltipContent side="bottom">
												{attempt.title}
											</TooltipContent>
										</Tooltip>
									) : (
										<span className="font-medium">{planName(attempt)}</span>
									)}
									<Badge
										variant={
											attempt.status === "failed" ? "destructive" : "outline"
										}
										className="h-5 px-1.5 text-[10px] font-normal capitalize"
									>
										{attempt.status}
									</Badge>
								</span>
								<span className="text-[11px] font-normal text-muted-foreground">
									{[
										promptLabel(attempt.plannerSystemPrompt),
										attempt.createdAt
											? formatDistanceToNow(attempt.createdAt, {
													addSuffix: true,
												})
											: null,
									]
										.filter(Boolean)
										.join(" · ")}
								</span>
							</TabsTrigger>
						))}
						{isPlanningNext ? (
							<TabsTrigger
								value={PLANNING_TAB_ID}
								disabled
								className="flex-none flex-col items-start gap-0.5 border-amber-500/30 px-3 py-2 text-amber-800 data-active:bg-amber-500/10 dark:text-amber-200"
							>
								<span className="flex items-center gap-1.5">
									<span className="font-medium">Plan {nextAttemptNumber}</span>
									<Badge className="h-5 border-amber-500/40 bg-amber-500/15 px-1.5 text-[10px] font-normal text-amber-800 capitalize dark:text-amber-200">
										planning
									</Badge>
								</span>
								<span className="text-[11px] font-normal text-amber-800/80 dark:text-amber-200/80">
									Generating scripts…
								</span>
							</TabsTrigger>
						) : null}
					</TabsList>
				</Tabs>
				{canRename && onRenameAttempt ? (
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={switchLocked}
						aria-label="Name this plan"
						onClick={openRename}
						className="shrink-0"
					>
						<Pencil />
					</Button>
				) : null}
				</div>
			) : active?.attemptNumber ? (
				<div className="flex flex-wrap items-center gap-2">
					<Badge
						variant="secondary"
						className="max-w-52 font-mono tabular-nums"
					>
						{active.title ? (
							<Tooltip>
								<TooltipTrigger
									render={<span className="min-w-0 truncate" />}
								>
									{planName(active)}
								</TooltipTrigger>
								<TooltipContent>{active.title}</TooltipContent>
							</Tooltip>
						) : (
							planName(active)
						)}
					</Badge>
					<Badge
						variant={active.status === "failed" ? "destructive" : "outline"}
						className="capitalize"
					>
						{active.status}
					</Badge>
					{active.createdAt ? (
						<span className="text-xs text-muted-foreground">
							{formatDistanceToNow(active.createdAt, { addSuffix: true })}
						</span>
					) : null}
					{canRename && onRenameAttempt ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							disabled={switchLocked}
							aria-label="Name this plan"
							onClick={openRename}
						>
							<Pencil />
						</Button>
					) : null}
				</div>
			) : null}

			<Dialog open={renameOpen} onOpenChange={setRenameOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Name this plan</DialogTitle>
						<DialogDescription>
							Give this plan a custom name, or leave it blank to use the
							default.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						<Label htmlFor="plan-title" className="text-xs">
							Name
						</Label>
						<Input
							id="plan-title"
							value={titleValue}
							onChange={(event) => setTitleValue(event.target.value)}
							placeholder={active ? `Plan ${active.attemptNumber}` : ""}
							maxLength={90}
							autoFocus
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									void confirmRename();
								}
							}}
						/>
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
		</section>
	);
}
