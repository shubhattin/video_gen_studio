import { createFileRoute } from "@tanstack/react-router";
import { HistoryPanel } from "#/components/studio/shell/history-panel";
import { StudioShell } from "#/components/studio/shell/studio-shell";
import { VideoGallery } from "#/components/studio/video/video-gallery";

export const Route = createFileRoute("/gallery")({
	component: GalleryPage,
});

function GalleryPage() {
	return (
		<StudioShell activePath="/gallery" history={<HistoryPanel />}>
			<div className="rounded-2xl border border-border/80 bg-card p-5 sm:p-8">
				<VideoGallery />
			</div>
		</StudioShell>
	);
}
