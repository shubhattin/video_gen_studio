import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";

export type VideoResultItem = {
	id: string;
	storageId?: string;
	url?: string | null;
	meta?: {
		mimeType?: string;
		durationSeconds?: number;
	};
	openRouterJobId?: string;
	openRouterGenerationId?: string;
	actualCostUsd?: number;
	warnings?: string[];
	createdAt: number;
};

type VideoResultProps = {
	videos: VideoResultItem[];
};

function extensionForMime(mimeType?: string) {
	if (mimeType?.includes("webm")) return "webm";
	if (mimeType?.includes("quicktime")) return "mov";
	return "mp4";
}

function getDownloadEndpoint(storageId: string, filename: string): string {
	const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;
	if (!siteUrl) {
		throw new Error(
			"VITE_CONVEX_SITE_URL is not set. Add it to .env.local (https://….convex.site).",
		);
	}
	const endpoint = new URL("/downloadVideo", siteUrl);
	endpoint.searchParams.set("storageId", storageId);
	endpoint.searchParams.set("filename", filename);
	return endpoint.toString();
}

async function downloadVideoFile(
	sourceUrl: string,
	filename: string,
): Promise<void> {
	const response = await fetch(sourceUrl);
	if (!response.ok) {
		throw new Error(`Download failed (${response.status})`);
	}
	const blob = await response.blob();
	const objectUrl = URL.createObjectURL(blob);
	try {
		const link = document.createElement("a");
		link.href = objectUrl;
		link.download = filename;
		link.rel = "noopener";
		link.style.display = "none";
		document.body.append(link);
		link.click();
		link.remove();
	} finally {
		// Keep the object URL alive briefly so the browser can start the download.
		window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
	}
}

export function VideoResult({ videos }: VideoResultProps) {
	const [downloadingId, setDownloadingId] = useState<string | null>(null);

	if (!videos.length) {
		return null;
	}

	return (
		<section className="space-y-4 border-t border-border/80 pt-6">
			<div>
				<h2 className="font-heading text-xl font-semibold">Generated videos</h2>
				<p className="text-sm text-muted-foreground">
					Each generate appends a new clip. Stored in Convex until you delete the
					run.
				</p>
			</div>

			<div className="space-y-4">
				{[...videos].reverse().map((video, index) => {
					const isDownloading = downloadingId === video.id;
					const canDownload = Boolean(video.storageId || video.url);
					return (
						<article
							key={video.id}
							className="overflow-hidden rounded-xl border border-border/80 bg-muted/20"
						>
							<div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start">
								<div className="mx-auto flex w-full max-w-md shrink-0 justify-center lg:mx-0 lg:max-w-[240px]">
									<div className="inline-flex max-h-[min(60vh,420px)] max-w-full items-center justify-center overflow-hidden rounded-lg border border-border/80 bg-black">
										{video.url ? (
											<video
												src={video.url}
												controls
												playsInline
												preload="metadata"
												className="max-h-[min(60vh,420px)] max-w-full w-auto h-auto object-contain"
											/>
										) : (
											<div className="flex h-48 w-40 items-center justify-center text-sm text-muted-foreground">
												Unavailable
											</div>
										)}
									</div>
								</div>

								<div className="min-w-0 flex-1 space-y-4">
									<div className="flex flex-wrap items-center justify-between gap-3">
										<p className="text-sm font-medium">
											Version {videos.length - index}
											<span className="ml-2 font-normal text-muted-foreground">
												{new Date(video.createdAt).toLocaleString()}
											</span>
										</p>
										{canDownload ? (
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="min-h-11"
												disabled={isDownloading}
												onClick={async (event) => {
													event.preventDefault();
													event.stopPropagation();
													setDownloadingId(video.id);
													const filename = `studio-video-${video.id}.${extensionForMime(video.meta?.mimeType)}`;
													try {
														const sourceUrl = video.storageId
															? getDownloadEndpoint(video.storageId, filename)
															: video.url;
														if (!sourceUrl) {
															throw new Error("No download URL available");
														}
														await downloadVideoFile(sourceUrl, filename);
													} catch (error) {
														console.error(error);
														window.alert(
															error instanceof Error
																? error.message
																: "Could not download video",
														);
													} finally {
														setDownloadingId(null);
													}
												}}
											>
												{isDownloading ? (
													<Loader2 className="size-4 animate-spin" />
												) : (
													<Download className="size-4" />
												)}
												{isDownloading ? "Downloading…" : "Download"}
											</Button>
										) : null}
									</div>

									<dl className="grid gap-3 text-sm sm:grid-cols-2">
										<div className="min-w-0">
											<dt className="text-muted-foreground">Duration</dt>
											<dd className="font-medium text-foreground">
												{video.meta?.durationSeconds
													? `${video.meta.durationSeconds}s`
													: "—"}
											</dd>
										</div>
										<div className="min-w-0">
											<dt className="text-muted-foreground">Cost</dt>
											<dd className="font-medium text-foreground">
												{video.actualCostUsd != null
													? `$${video.actualCostUsd.toFixed(4)}`
													: "—"}
											</dd>
										</div>
										<div className="min-w-0 sm:col-span-2">
											<dt className="text-muted-foreground">OpenRouter job</dt>
											<dd className="truncate font-mono text-xs text-foreground">
												{video.openRouterJobId ?? "—"}
											</dd>
										</div>
										<div className="min-w-0 sm:col-span-2">
											<dt className="text-muted-foreground">Generation ID</dt>
											<dd className="truncate font-mono text-xs text-foreground">
												{video.openRouterGenerationId ?? "—"}
											</dd>
										</div>
									</dl>

									{video.warnings?.length ? (
										<ul className="space-y-1 text-xs text-muted-foreground">
											{video.warnings.map((warning) => (
												<li key={warning}>Warning: {warning}</li>
											))}
										</ul>
									) : null}
								</div>
							</div>
						</article>
					);
				})}
			</div>
		</section>
	);
}
