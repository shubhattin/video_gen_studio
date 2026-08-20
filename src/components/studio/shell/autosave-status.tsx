import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "#/components/ui/button";
import type { RunAutosaveStatus } from "#/hooks/use-run-autosave";
import { cn } from "#/lib/utils";

type AutosaveStatusProps = {
	status: RunAutosaveStatus;
	hasPending: boolean;
	onRetry: () => void;
	className?: string;
};

export function AutosaveStatus({
	status,
	hasPending,
	onRetry,
	className,
}: AutosaveStatusProps) {
	if (status === "error") {
		return (
			<span
				className={cn(
					"inline-flex items-center gap-1.5 text-xs text-destructive",
					className,
				)}
			>
				<TriangleAlert className="size-3.5 shrink-0" />
				Unsaved changes
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-6 px-2 text-xs"
					onClick={onRetry}
				>
					Retry
				</Button>
			</span>
		);
	}
	if (status === "saving" || hasPending) {
		return (
			<span
				className={cn(
					"inline-flex items-center gap-1.5 text-xs text-muted-foreground",
					className,
				)}
			>
				<Loader2 className="size-3.5 shrink-0 animate-spin" />
				Saving…
			</span>
		);
	}
	if (status === "saved") {
		return (
			<span
				className={cn(
					"inline-flex items-center gap-1.5 text-xs text-muted-foreground",
					className,
				)}
			>
				<Check className="size-3.5 shrink-0" />
				Saved
			</span>
		);
	}
	return null;
}
