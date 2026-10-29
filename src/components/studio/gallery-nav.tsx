import { AudioLines, Image as ImageIcon, Video } from "lucide-react";
import { type PillTab, PillTabs } from "#/components/studio/pill-tabs";

export type GalleryTab = "videos" | "audio" | "images";

const tabs: ReadonlyArray<PillTab<GalleryTab>> = [
	{ id: "videos", label: "Videos", icon: Video },
	{ id: "audio", label: "Audio", icon: AudioLines },
	{ id: "images", label: "Images", icon: ImageIcon },
];

type GalleryNavProps = {
	active: GalleryTab;
	onChange: (tab: GalleryTab) => void;
};

/** Tab switcher for the unified gallery — switches the view without routing. */
export function GalleryNav({ active, onChange }: GalleryNavProps) {
	return (
		<PillTabs
			tabs={tabs}
			active={active}
			onChange={onChange}
			aria-label="Gallery type"
		/>
	);
}
