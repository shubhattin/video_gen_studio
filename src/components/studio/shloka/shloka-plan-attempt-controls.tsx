import { formatDistanceToNow } from "date-fns";
import { Trash2 } from "lucide-react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { cn } from "#/lib/utils";

export type ShlokaPlanAttemptSummary = {
	_id: string;
	attemptNumber: number;
	status: string;
	plannerSystemPrompt?: string;
	plannerModel?: string;
	createdAt?: number;
};

type ShlokaPlanAttemptControlsProps = {
	attempts: ShlokaPlanAttemptSummary[];
	activePlanId?: string | null;
	onSelectAttempt?: (planId: string) => void;
	onDeleteAttempt?: (planId: string) => void;
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

export function ShlokaPlanAttemptControls({
	attempts,
	activePlanId,
	onSelectAttempt,
	onDeleteAttempt,
	disabled,
	isPlanningNext = false,
	className,
}: ShlokaPlanAttemptControlsProps) {
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
				{active && onDeleteAttempt && ordered.length > 0 && !isPlanningNext ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={switchLocked}
						onClick={() => onDeleteAttempt(active._id)}
					>
						<Trash2 />
						Delete plan
					</Button>
				) : null}
			</div>

			{showTabStrip && activeValue ? (
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
					className="gap-3"
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
								<span className="flex items-center gap-1.5">
									<span className="font-medium">
										Plan {attempt.attemptNumber}
									</span>
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
			) : active?.attemptNumber ? (
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="secondary" className="font-mono tabular-nums">
						Plan {active.attemptNumber}
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
				</div>
			) : null}
		</section>
	);
}
