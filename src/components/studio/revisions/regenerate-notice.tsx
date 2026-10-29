import type { ReactNode } from "react";

/**
 * Amber note inside Regenerate confirmations: regenerate starts a new
 * conversation, so point to Revise for tweaks and to a fresh plan/run for a
 * different direction.
 */
export function RegenerateNotice({
	revisionCount,
	reviseLabel,
	freshStart,
}: {
	revisionCount: number;
	/** Name of the revise button, e.g. "Revise plan". */
	reviseLabel: string;
	/** Where to go for a fresh take that keeps this one. */
	freshStart: ReactNode;
}) {
	return (
		<div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
			{revisionCount > 1 ? (
				<p className="font-medium">
					All {revisionCount} revisions will be discarded.
				</p>
			) : null}
			<p>
				Want to adjust it? Use <strong>{reviseLabel}</strong> instead — it keeps
				every revision. {freshStart}
			</p>
		</div>
	);
}
