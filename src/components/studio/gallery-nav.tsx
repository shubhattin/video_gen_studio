import { Image as ImageIcon, Video } from "lucide-react";
import { cn } from "#/lib/utils";

export type GalleryTab = "videos" | "images";

const tabs: Array<{
	id: GalleryTab;
	label: string;
	icon: typeof Video;
}> = [
	{ id: "videos", label: "Videos", icon: Video },
	{ id: "images", label: "Images", icon: ImageIcon },
];

type GalleryNavProps = {
	active: GalleryTab;
	onChange: (tab: GalleryTab) => void;
};

/** Tab switcher for the unified gallery — switches the view without routing. */
export function GalleryNav({ active, onChange }: GalleryNavProps) {
	return (
		<div className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-muted/30 p-1">
			{tabs.map((tab) => {
				const Icon = tab.icon;
				const isActive = active === tab.id;
				return (
					<button
						key={tab.id}
						type="button"
						aria-pressed={isActive}
						onClick={() => onChange(tab.id)}
						className={cn(
							"inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
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
		</div>
	);
}
