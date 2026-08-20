import { Download, Info, Loader2 } from "lucide-react";
import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/ui/popover";
import { fetchStudioMedia } from "#/lib/studio-media-proxy";
import {
	MODEL_CAPABILITY_PROFILES,
	type VideoModelId,
} from "#/lib/model-catalog";
import { cn } from "#/lib/utils";

export type VideoResultItem = {
	id: string;
	objectKey?: string;
	url?: string | null;
	meta?: {
		mimeType?: string;
		durationSeconds?: number;
		bytes?: number;
		width?: number;
		height?: number;
	};
	openRouterJobId?: string;
	openRouterGenerationId?: string;
	actualCostUsd?: number;
	videoParams?: {
		modelId?: string;
		aspectRatio?: string;
		resolution?: string;
		durationSeconds?: number;
		generateAudio?: boolean;
		prompt?: string;
	};
	videoPrompt?: string;
	warnings?: string[];
	createdAt: number;
};

type VideoResultProps = {
	runId?: Id<"generationRuns"> | null;
	videos: VideoResultItem[];
};

function extensionForMime(mimeType?: string) {
	if (mimeType?.includes("webm")) return "webm";
	if (mimeType?.includes("quicktime")) return "mov";
	return "mp4";
}

function formatBytes(bytes?: number) {
	if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function saveDownloadResponse(
	response: Response,
	filename: string,
): Promise<void> {
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
		window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
	}
}

async function downloadVideoFile(
	sourceUrl: string,
	filename: string,
): Promise<void> {
	const response = await fetch(sourceUrl, { cache: "no-store" });
	await saveDownloadResponse(response, filename);
}

function InfoRow({
	label,
	value,
	mono,
}: {
	label: string;
	value?: string | null;
	mono?: boolean;
}) {
	if (!value) return null;
	return (
		<div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs">
			<span className="text-muted-foreground">{label}</span>
			<span
				className={cn("min-w-0 break-all text-foreground", mono && "font-mono")}
			>
				{value}
			</span>
		</div>
	);
}

function VideoClipCard({
	runId,
	video,
	versionLabel,
	isLatest,
}: {
	runId?: Id<"generationRuns"> | null;
	video: VideoResultItem;
	versionLabel: string;
	isLatest: boolean;
}) {
	const [downloading, setDownloading] = useState(false);
	const canDownload = Boolean(video.objectKey || video.url);
	const duration =
		video.meta?.durationSeconds ?? video.videoParams?.durationSeconds;
	const modelId = video.videoParams?.modelId;
	const modelLabel = modelId
		? (MODEL_CAPABILITY_PROFILES[modelId as VideoModelId]?.displayName ??
			modelId)
		: null;
	const prompt = video.videoPrompt ?? video.videoParams?.prompt;

	return (
		<article className="overflow-hidden rounded-2xl border border-border/70 bg-card">
			<div className="relative bg-black">
				{video.url ? (
					<video
						src={video.url}
						controls
						playsInline
						preload="metadata"
						className="mx-auto max-h-[min(70vh,560px)] w-full object-contain"
					/>
				) : (
					<div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
						Video unavailable
					</div>
				)}
			</div>

			<div className="flex items-center gap-2 px-3 py-2.5">
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
					<span className="text-sm font-medium">{versionLabel}</span>
					{isLatest ? (
						<Badge variant="secondary" className="font-normal">
							Latest
						</Badge>
					) : null}
					{duration != null ? (
						<span className="text-xs text-muted-foreground">{duration}s</span>
					) : null}
					{video.actualCostUsd != null ? (
						<span className="text-xs text-muted-foreground">
							${video.actualCostUsd.toFixed(4)}
						</span>
					) : null}
					{modelLabel ? (
						<span className="truncate text-xs text-muted-foreground">
							{modelLabel}
						</span>
					) : null}
				</div>

				<Popover>
					<PopoverTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label="Clip details"
							/>
						}
					>
						<Info />
					</PopoverTrigger>
					<PopoverContent align="end" className="w-80 gap-3 p-4">
						<PopoverHeader>
							<PopoverTitle>Clip details</PopoverTitle>
							<PopoverDescription>
								Generation details for this clip.
							</PopoverDescription>
						</PopoverHeader>
						<div className="flex flex-col gap-2">
							<InfoRow
								label="Created"
								value={new Date(video.createdAt).toLocaleString()}
							/>
							<InfoRow label="Model" value={modelLabel} />
							<InfoRow
								label="Resolution"
								value={video.videoParams?.resolution}
							/>
							<InfoRow label="Aspect" value={video.videoParams?.aspectRatio} />
							<InfoRow
								label="Duration"
								value={duration != null ? `${duration}s` : null}
							/>
							<InfoRow
								label="Audio"
								value={
									video.videoParams?.generateAudio == null
										? null
										: video.videoParams.generateAudio
											? "On"
											: "Off"
								}
							/>
							<InfoRow
								label="Cost"
								value={
									video.actualCostUsd != null
										? `$${video.actualCostUsd.toFixed(6)}`
										: null
								}
							/>
							<InfoRow label="Size" value={formatBytes(video.meta?.bytes)} />
							<InfoRow label="MIME" value={video.meta?.mimeType} mono />
							<InfoRow label="Job ID" value={video.openRouterJobId} mono />
							<InfoRow
								label="Generation"
								value={video.openRouterGenerationId}
								mono
							/>
						</div>
						{prompt?.trim() ? (
							<div className="flex flex-col gap-1.5 border-t border-border/70 pt-3">
								<span className="text-xs text-muted-foreground">Prompt</span>
								<p className="max-h-28 overflow-y-auto text-xs leading-relaxed text-foreground">
									{prompt.trim()}
								</p>
							</div>
						) : null}
						{video.warnings?.length ? (
							<div className="flex flex-col gap-1 border-t border-border/70 pt-3">
								<span className="text-xs text-muted-foreground">Warnings</span>
								{video.warnings.map((warning) => (
									<p
										key={warning}
										className="text-xs text-amber-700 dark:text-amber-300"
									>
										{warning}
									</p>
								))}
							</div>
						) : null}
					</PopoverContent>
				</Popover>

				{canDownload ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={downloading}
						onClick={async (event) => {
							event.preventDefault();
							event.stopPropagation();
							setDownloading(true);
							const filename = `studio-video-${video.id}.${extensionForMime(video.meta?.mimeType)}`;
							try {
								const fallbackProxy =
									runId && video.objectKey
										? { runId: String(runId), objectKey: video.objectKey }
										: null;
								if (video.url) {
									try {
										await downloadVideoFile(video.url, filename);
									} catch (error) {
										if (!fallbackProxy) {
											throw error;
										}
										const response = await fetchStudioMedia(fallbackProxy);
										await saveDownloadResponse(response, filename);
									}
								} else if (fallbackProxy) {
									const response = await fetchStudioMedia(fallbackProxy);
									await saveDownloadResponse(response, filename);
								} else {
									throw new Error("No download URL available");
								}
							} catch (error) {
								console.error(error);
								window.alert(
									error instanceof Error
										? error.message
										: "Could not download video",
								);
							} finally {
								setDownloading(false);
							}
						}}
					>
						{downloading ? (
							<Loader2 className="animate-spin" data-icon="inline-start" />
						) : (
							<Download data-icon="inline-start" />
						)}
						{downloading ? "Saving…" : "Download"}
					</Button>
				) : null}
			</div>
		</article>
	);
}

export function VideoResult({ runId, videos }: VideoResultProps) {
	if (!videos.length) {
		return null;
	}

	const ordered = [...videos].reverse();

	return (
		<section className="flex flex-col gap-4 border-t border-border/80 pt-6">
			<div className="flex items-end justify-between gap-3">
				<div>
					<h2 className="font-heading text-xl font-semibold">Videos</h2>
					<p className="text-sm text-muted-foreground">
						{videos.length} take{videos.length === 1 ? "" : "s"} · newest first
					</p>
				</div>
			</div>

			<div className="flex flex-col gap-5">
				{ordered.map((video, index) => (
					<VideoClipCard
						key={video.id}
						runId={runId}
						video={video}
						versionLabel={`Take ${videos.length - index}`}
						isLatest={index === 0}
					/>
				))}
			</div>
		</section>
	);
}
