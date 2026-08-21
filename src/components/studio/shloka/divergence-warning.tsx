import { Info, TriangleAlert } from "lucide-react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
import { cn } from "#/lib/utils";

export type DivergenceField = {
	label: string;
	current: string;
	used: string;
};

/**
 * Amber warning shown when the plan's current video config has diverged from
 * the config it was generated with. Generation keeps using the original
 * settings until the plan is regenerated — the popover explains this.
 */
export function DivergenceWarning({
	fields,
	onRegenerate,
	className,
}: {
	/** Differing fields to enumerate in the popover. */
	fields: DivergenceField[];
	onRegenerate?: () => void;
	className?: string;
}) {
	if (fields.length === 0) {
		return null;
	}
	const summary = fields.map((field) => field.label).join(", ");

	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200",
				className,
			)}
		>
			<TriangleAlert className="size-4 shrink-0" />
			<p className="min-w-0 flex-1">
				Video settings have diverged from this plan ({summary}). Generation
				still uses the plan’s original settings until you regenerate the plan.
			</p>
			{onRegenerate ? (
				<button
					type="button"
					onClick={onRegenerate}
					className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold underline-offset-2 hover:underline"
				>
					Regenerate plan
				</button>
			) : null}
			<Popover>
				<PopoverTrigger
					render={
						<button
							type="button"
							aria-label="More details about this warning"
							className="shrink-0 rounded-md p-1 hover:bg-amber-500/15"
						>
							<Info className="size-4" />
						</button>
					}
				/>
				<PopoverContent align="end" className="w-80 text-sm">
					<p className="font-medium">Why am I seeing this?</p>
					<p className="mt-1.5 text-muted-foreground">
						A plan’s scenes are written for a specific model, duration, aspect
						ratio, and resolution. Video generation therefore always uses the
						settings the plan was generated with:
					</p>
					<ul className="mt-2 space-y-1">
						{fields.map((field) => (
							<li
								key={field.label}
								className="flex items-center justify-between gap-2"
							>
								<span className="text-muted-foreground">{field.label}</span>
								<span className="text-xs">
									plan: {field.used} · current: {field.current}
								</span>
							</li>
						))}
					</ul>
					<p className="mt-2 text-muted-foreground">
						Your current changes will be used the next time you regenerate the
						plan.
					</p>
				</PopoverContent>
			</Popover>
		</div>
	);
}
