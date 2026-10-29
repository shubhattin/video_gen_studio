import type { LucideIcon } from "lucide-react";
import { cn } from "#/lib/utils";

export type PillTab<T extends string> = {
	id: T;
	label: string;
	icon: LucideIcon;
};

type PillTabsProps<T extends string> = {
	tabs: ReadonlyArray<PillTab<T>>;
	active: T;
	onChange: (tab: T) => void;
	disabled?: boolean;
	"aria-label"?: string;
};

/** Rounded segmented switch used across the studio (gallery, templates, launcher). */
export function PillTabs<T extends string>({
	tabs,
	active,
	onChange,
	disabled,
	"aria-label": ariaLabel,
}: PillTabsProps<T>) {
	return (
		<fieldset
			aria-label={ariaLabel}
			className="m-0 inline-flex min-w-0 items-center gap-1 rounded-full border border-border/80 bg-muted/30 p-1"
		>
			{tabs.map((tab) => {
				const Icon = tab.icon;
				const isActive = active === tab.id;
				return (
					<button
						key={tab.id}
						type="button"
						aria-pressed={isActive}
						disabled={disabled}
						onClick={() => onChange(tab.id)}
						className={cn(
							"inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors disabled:opacity-60",
							isActive
								? "bg-foreground text-background"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						<Icon className="size-4" />
						{tab.label}
					</button>
				);
			})}
		</fieldset>
	);
}
