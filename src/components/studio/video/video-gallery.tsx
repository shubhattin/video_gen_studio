import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { VideoResult } from "#/components/studio/video/video-result";
import {
	useSignedMediaUrls,
	withSignedUrl,
} from "#/hooks/use-signed-media-urls";

export function VideoGallery() {
	const videos = useQuery(api.studio.queries.listGalleryVideos, { limit: 80 });
	const objectKeys = (videos ?? []).map(
		(video: { objectKey?: string }) => video.objectKey,
	);
	const urlsByKey = useSignedMediaUrls(null, objectKeys);
	const withUrls = (videos ?? []).map(
		(video: { objectKey?: string; id: string; createdAt: number }) =>
			withSignedUrl(video, urlsByKey),
	);

	if (videos === undefined) {
		return (
			<p className="text-sm text-muted-foreground">Loading video gallery…</p>
		);
	}

	if (videos.length === 0) {
		return (
			<section className="space-y-2">
				<h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
					Video gallery
				</h1>
				<p className="text-sm text-muted-foreground">
					Generated clips stay here even after you delete a run. Browse, play,
					and download them.
				</p>
				<p className="pt-4 text-sm text-muted-foreground">
					No videos yet. Generate a clip from Shloka Studio or Model Studio.
				</p>
			</section>
		);
	}

	return (
		<section className="space-y-4">
			<div>
				<h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
					Video gallery
				</h1>
				<p className="text-sm text-muted-foreground">
					Shared library of generated clips. Deleting a run does not remove
					these files.
				</p>
			</div>
			<VideoResult videos={withUrls} />
		</section>
	);
}
