import { Link } from "@tanstack/react-router";
import { Image as ImageIcon, Video } from "lucide-react";
import { cn } from "#/lib/utils";

type GalleryTab = "videos" | "images";

const tabs: Array<{
	id: GalleryTab;
	label: string;
	to: string;
	icon: typeof Video;
}> = [
	{ id: "videos", label: "Videos", to: "/gallery", icon: Video },
	{ id: "images", label: "Images", to: "/gallery/images", icon: ImageIcon },
];

export function GalleryNav({ active }: { active: GalleryTab }) {
	return (
		<div className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-muted/30 p-1">
			{tabs.map((tab) => {
				const Icon = tab.icon;
				const isActive = active === tab.id;
				return (
					<Link
						key={tab.id}
						to={tab.to}
						className={cn(
							"inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
							isActive
								? "bg-foreground text-background"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						<Icon className="size-4" />
						{tab.label}
					</Link>
				);
			})}
		</div>
	);
}
