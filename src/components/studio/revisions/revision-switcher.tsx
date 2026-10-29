import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";

/** `‹ i/n ›` stepper between revisions. Renders nothing for a single revision. */
export function RevisionSwitcher({
	index,
	count,
	disabled,
	onSelect,
	className,
}: {
	/** 0-based active revision. */
	index: number;
	count: number;
	disabled?: boolean;
	onSelect: (index: number) => void;
	className?: string;
}) {
	if (count < 2) return null;
	return (
		<fieldset
			aria-label="Revisions"
			className={cn(
				"inline-flex min-w-0 items-center rounded-lg border border-border/80 bg-background/60",
				className,
			)}
		>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Previous revision"
				disabled={disabled || index <= 0}
				onClick={() => onSelect(index - 1)}
			>
				<ChevronLeft />
			</Button>
			<span
				aria-live="polite"
				className="min-w-10 text-center text-xs font-medium tabular-nums"
			>
				{index + 1}/{count}
			</span>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Next revision"
				disabled={disabled || index >= count - 1}
				onClick={() => onSelect(index + 1)}
			>
				<ChevronRight />
			</Button>
		</fieldset>
	);
}

/** The instruction that produced a revision, shown above its content. */
export function RevisionNote({
	index,
	parentIndex,
	revisionPrompt,
}: {
	index: number;
	parentIndex?: number;
	revisionPrompt?: string;
}) {
	if (!revisionPrompt) return null;
	// Only call out the base when it isn't simply the previous revision.
	const branched = parentIndex !== undefined && parentIndex !== index - 1;
	return (
		<p
			className="line-clamp-2 text-xs text-muted-foreground"
			title={revisionPrompt}
		>
			<span className="font-medium text-foreground">
				Revision {index + 1}
				{branched ? ` (from ${parentIndex + 1})` : ""}:
			</span>{" "}
			“{revisionPrompt}”
		</p>
	);
}

/** " (Rev 2)" suffix for labels — empty while there is only one revision. */
export function revisionSuffix(index: number | null, count: number) {
	return index !== null && count > 1 ? ` (Rev ${index + 1})` : "";
}
