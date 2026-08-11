import { AnimatePresence, motion } from "motion/react";
import { Spinner } from "#/components/ui/spinner";
import {
	PIPELINE_STEPS,
	busyStageCopy,
	isActiveRunStatus,
	isStudioBusy,
	pipelineProgress,
	runStatusCopy,
	type StudioBusyStage,
} from "#/lib/studio-run-status";
import { cn } from "#/lib/utils";

type GenerationProgressDockProps = {
	status?: string | null;
	busyStage?: StudioBusyStage;
	warnings?: string[];
	/** Optional context shown under the title (model id / shloka snippet). */
	contextLabel?: string | null;
};

export function GenerationProgressDock({
	status,
	busyStage = null,
	warnings,
	contextLabel,
}: GenerationProgressDockProps) {
	const visible = isStudioBusy(busyStage) || isActiveRunStatus(status);
	const copy = busyStage
		? busyStageCopy(busyStage)
		: status && isActiveRunStatus(status)
			? runStatusCopy(status)
			: null;
	const { value, stepIndex } = pipelineProgress({ status, busyStage });
	const warning = warnings?.[0];

	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4 sm:p-6">
			<AnimatePresence>
				{visible && copy ? (
					<motion.div
						key="generation-progress-dock"
						role="status"
						aria-live="polite"
						aria-busy="true"
						initial={{ opacity: 0, y: 28, scale: 0.96 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: 20, scale: 0.98 }}
						transition={{ type: "spring", stiffness: 420, damping: 32 }}
						className="pointer-events-auto w-full max-w-md"
					>
						<div className="overflow-hidden rounded-2xl border border-border/80 bg-background/90 shadow-lg ring-1 ring-black/5 backdrop-blur-xl dark:ring-white/10">
							<div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
								<div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
									<Spinner className="size-4" />
								</div>
								<div className="min-w-0 flex-1">
									<div className="flex items-baseline justify-between gap-3">
										<p className="truncate font-heading text-sm font-semibold tracking-tight">
											{copy.title}
										</p>
										<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
											{Math.round(value)}%
										</span>
									</div>
									<p className="mt-0.5 truncate text-xs text-muted-foreground">
										{contextLabel?.trim()
											? `${copy.detail} · ${contextLabel}`
											: copy.detail}
									</p>
								</div>
							</div>

							<div className="px-4 pb-2">
								<div className="h-1 overflow-hidden rounded-full bg-muted">
									<motion.div
										className="h-full rounded-full bg-amber-500"
										initial={false}
										animate={{ width: `${value}%` }}
										transition={{ type: "spring", stiffness: 180, damping: 28 }}
									/>
								</div>
							</div>

							<div className="flex items-center gap-1.5 px-4 pb-3">
								{PIPELINE_STEPS.map((step, index) => {
									const done = stepIndex > index;
									const current = stepIndex === index;
									return (
										<div
											key={step.id}
											className={cn(
												"flex min-w-0 flex-1 items-center justify-center rounded-full px-2 py-1 text-[10px] font-medium tracking-wide uppercase",
												done &&
													"bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
												current &&
													"bg-amber-500/15 text-amber-700 dark:text-amber-300",
												!done &&
													!current &&
													"bg-muted/50 text-muted-foreground",
											)}
										>
											{step.label}
										</div>
									);
								})}
							</div>

							{warning ? (
								<p className="border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">
									Warning: {warning}
								</p>
							) : null}
						</div>
					</motion.div>
				) : null}
			</AnimatePresence>
		</div>
	);
}
