import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { GalleryNav, type GalleryTab } from "#/components/studio/gallery-nav";
import { HistoryPanel } from "#/components/studio/shell/history-panel";
import { StudioShell } from "#/components/studio/shell/studio-shell";
import { ImageGallery } from "#/components/studio/video/image-gallery";
import { VideoGallery } from "#/components/studio/video/video-gallery";

export const Route = createFileRoute("/gallery/")({
	component: GalleryPage,
});

function GalleryPage() {
	const [tab, setTab] = useState<GalleryTab>("videos");

	return (
		<StudioShell activePath="/gallery" history={<HistoryPanel />}>
			<div className="rounded-2xl border border-border/80 bg-card p-4 sm:p-6">
				<div className="mb-5">
					<GalleryNav active={tab} onChange={setTab} />
				</div>
				{tab === "videos" ? <VideoGallery /> : <ImageGallery />}
			</div>
		</StudioShell>
	);
}
