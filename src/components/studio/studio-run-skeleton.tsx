import { Skeleton } from "#/components/ui/skeleton";

/** Placeholder for the main studio card while auth or a `?run=` document loads. */
export function StudioRunSkeleton({
	label = "Loading studio",
}: {
	label?: string;
}) {
	return (
		<div
			className="space-y-8 rounded-2xl border border-border/80 bg-card p-5 sm:p-8"
			aria-busy="true"
			aria-label={label}
			aria-live="polite"
			role="status"
		>
			<p className="sr-only">{label}</p>
			<section className="space-y-3">
				<Skeleton className="h-8 w-56 max-w-full" />
				<Skeleton className="h-4 w-full max-w-md" />
			</section>

			<section className="space-y-3">
				<Skeleton className="h-4 w-24" />
				<Skeleton className="h-28 w-full rounded-xl" />
				<Skeleton className="h-4 w-36" />
				<Skeleton className="h-20 w-full rounded-xl" />
			</section>

			<section className="space-y-3 border-t border-border/80 pt-6">
				<Skeleton className="h-5 w-40" />
				<Skeleton className="h-4 w-64 max-w-full" />
				<div className="flex flex-wrap gap-2">
					<Skeleton className="h-9 w-28 rounded-full" />
					<Skeleton className="h-9 w-28 rounded-full" />
					<Skeleton className="h-9 w-24 rounded-full" />
				</div>
			</section>

			<section className="space-y-3 border-t border-border/80 pt-6">
				<Skeleton className="h-5 w-32" />
				<div className="grid gap-3 sm:grid-cols-2">
					<Skeleton className="aspect-3/4 w-full rounded-xl" />
					<Skeleton className="aspect-3/4 w-full rounded-xl" />
				</div>
			</section>

			<section className="space-y-3 border-t border-border/80 pt-6">
				<Skeleton className="h-5 w-28" />
				<Skeleton className="h-48 w-full rounded-xl" />
			</section>
		</div>
	);
}

/** Compact sidebar placeholders while recent runs load. */
export function HistoryPanelSkeleton({ rows = 5 }: { rows?: number }) {
	return (
		<div
			className="flex flex-col gap-2 px-1"
			aria-busy="true"
			aria-label="Loading run history"
			aria-live="polite"
			role="status"
		>
			{Array.from({ length: rows }, (_, index) => (
				<div key={index} className="flex flex-col gap-2 rounded-md px-2 py-2">
					<div className="flex items-center gap-1.5">
						<Skeleton className="h-5 w-14 rounded-full" />
						<Skeleton className="h-5 w-16 rounded-full" />
					</div>
					<Skeleton className="h-4 w-[85%]" />
					<Skeleton className="h-3 w-[55%]" />
				</div>
			))}
		</div>
	);
}
