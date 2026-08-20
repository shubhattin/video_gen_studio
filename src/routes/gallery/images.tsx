import { createFileRoute } from "@tanstack/react-router";
import { HistoryPanel } from "#/components/studio/shell/history-panel";
import { StudioShell } from "#/components/studio/shell/studio-shell";
import { ImageGallery } from "#/components/studio/video/image-gallery";

export const Route = createFileRoute("/gallery/images")({
	component: ImagesPage,
});

function ImagesPage() {
	return (
		<StudioShell activePath="/gallery/images" history={<HistoryPanel />}>
			<div className="rounded-2xl border border-border/80 bg-card p-5 sm:p-8">
				<ImageGallery />
			</div>
		</StudioShell>
	);
}
