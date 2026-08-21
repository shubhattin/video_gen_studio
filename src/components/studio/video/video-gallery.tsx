import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Download, Info, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import {
	useSignedMediaUrls,
	withSignedUrl,
} from "#/hooks/use-signed-media-urls";
import {
	MODEL_CAPABILITY_PROFILES,
	type VideoModelId,
} from "#/lib/model-catalog";
import { notifyStudioError } from "#/lib/studio-toast";
import { cn } from "#/lib/utils";
import {
	downloadVideoFile,
	extensionForMime,
	formatBytes,
} from "./video-result";

type SortOrder = "latest" | "oldest";

type GalleryVideo = {
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
	videoParams?: {
		modelId?: string;
		aspectRatio?: string;
		resolution?: string;
		durationSeconds?: number;
		prompt?: string;
	};
	videoPrompt?: string;
	createdAt: number;
};

type RunConnection = {
	runId: string;
	title?: string;
	kind: "shloka" | "model-studio";
	status: string;
};

function runLabel(run: RunConnection): string {
	const typeLabel = run.kind === "shloka" ? "Shloka run" : "Model run";
	return run.title?.trim()
		? `${run.title} · ${typeLabel}`
		: `${typeLabel} (${run.runId.slice(0, 8)}…)`;
}

function aspectRatioValue(video: GalleryVideo): string | undefined {
	const width = video.meta?.width;
	const height = video.meta?.height;
	if (width && height && Number.isFinite(width) && Number.isFinite(height)) {
		return `${width} / ${height}`;
	}
	if (video.videoParams?.aspectRatio) {
		const [w, h] = video.videoParams.aspectRatio.split("/");
		if (w && h && Number.isFinite(Number(w)) && Number.isFinite(Number(h))) {
			return `${w} / ${h}`;
		}
	}
	return undefined;
}

function GalleryVideoCard({
	video,
	onDelete,
	busy,
}: {
	video: GalleryVideo;
	onDelete: () => void;
	busy: boolean;
}) {
	const [downloading, setDownloading] = useState(false);
	const [open, setOpen] = useState(false);
	const runConnection = useQuery(
		api.studio.queries.getGalleryVideoRunConnection,
		open ? { videoId: video.id as Id<"galleryVideos"> } : "skip",
	);
	const canDownload = Boolean(video.objectKey || video.url);
	const duration =
		video.meta?.durationSeconds ?? video.videoParams?.durationSeconds;
	const modelId = video.videoParams?.modelId;
	const modelLabel = modelId
		? (MODEL_CAPABILITY_PROFILES[modelId as VideoModelId]?.displayName ??
			modelId)
		: null;
	const ratio = aspectRatioValue(video);
	const prompt = video.videoPrompt ?? video.videoParams?.prompt;

	const onDownload = async () => {
		if (!canDownload || downloading) return;
		setDownloading(true);
		try {
			const filename = `studio-video-${video.id}.${extensionForMime(video.meta?.mimeType)}`;
			if (video.url) {
				await downloadVideoFile(video.url, filename);
			} else {
				throw new Error("No download URL available");
			}
		} catch (error) {
			console.error(error);
			window.alert(
				error instanceof Error ? error.message : "Could not download video",
			);
		} finally {
			setDownloading(false);
		}
	};

	return (
		<article className="mb-4 break-inside-avoid overflow-hidden rounded-2xl border border-border/70 bg-card">
			<div className="relative bg-black">
				{video.url ? (
					<video
						src={video.url}
						controls
						playsInline
						preload="metadata"
						style={ratio ? { aspectRatio: ratio } : undefined}
						className={cn(
							"block w-full object-contain",
							ratio ? "max-h-[min(75vh,42rem)]" : "max-h-[min(70vh,560px)]",
						)}
					>
						<track kind="captions" />
					</video>
				) : (
					<div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
						Video unavailable
					</div>
				)}
			</div>

			<div className="flex items-center gap-2 px-3 py-2.5">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<div className="flex min-w-0 flex-wrap items-center gap-1.5">
						{modelLabel ? (
							<span className="truncate text-sm font-medium">{modelLabel}</span>
						) : (
							<span className="text-sm font-medium">Generated clip</span>
						)}
						{duration != null ? (
							<span className="text-xs text-muted-foreground">{duration}s</span>
						) : null}
					</div>
					<span className="text-xs text-muted-foreground">
						{new Date(video.createdAt).toLocaleString()}
					</span>
				</div>

				<Popover open={open} onOpenChange={setOpen}>
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
						<div className="flex flex-col gap-2 text-xs">
							<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
								<span className="text-muted-foreground">Created</span>
								<span>{new Date(video.createdAt).toLocaleString()}</span>
							</div>
							{modelLabel ? (
								<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
									<span className="text-muted-foreground">Model</span>
									<span>{modelLabel}</span>
								</div>
							) : null}
							{video.videoParams?.resolution ? (
								<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
									<span className="text-muted-foreground">Resolution</span>
									<span>{video.videoParams.resolution}</span>
								</div>
							) : null}
							{video.videoParams?.aspectRatio ? (
								<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
									<span className="text-muted-foreground">Aspect</span>
									<span>{video.videoParams.aspectRatio}</span>
								</div>
							) : null}
							{duration != null ? (
								<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
									<span className="text-muted-foreground">Duration</span>
									<span>{duration}s</span>
								</div>
							) : null}
							{formatBytes(video.meta?.bytes) ? (
								<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
									<span className="text-muted-foreground">Size</span>
									<span>{formatBytes(video.meta?.bytes)}</span>
								</div>
							) : null}
						</div>
						<div className="flex flex-col gap-1.5 border-t border-border/70 pt-3">
							<span className="text-xs text-muted-foreground">Connection</span>
							{runConnection === undefined ? (
								<p className="text-xs text-muted-foreground">Checking…</p>
							) : runConnection ? (
								<p className="truncate text-xs text-foreground">
									Connected to {runLabel(runConnection)}
								</p>
							) : (
								<p className="text-xs text-muted-foreground">
									Abandoned — not connected to any run.
								</p>
							)}
						</div>
						{prompt?.trim() ? (
							<div className="flex flex-col gap-1.5 border-t border-border/70 pt-3">
								<span className="text-xs text-muted-foreground">Prompt</span>
								<p className="max-h-28 overflow-y-auto text-xs leading-relaxed text-foreground">
									{prompt.trim()}
								</p>
							</div>
						) : null}
					</PopoverContent>
				</Popover>

				{canDownload ? (
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						disabled={downloading}
						aria-label="Download video"
						onClick={() => void onDownload()}
					>
						{downloading ? <Loader2 className="animate-spin" /> : <Download />}
					</Button>
				) : null}

				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					disabled={busy}
					aria-label="Delete clip"
					onClick={onDelete}
				>
					<Trash2 />
				</Button>
			</div>
		</article>
	);
}

export function VideoGallery() {
	const [sort, setSort] = useState<SortOrder>("latest");
	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);
	const deleteVideo = useMutation(api.studio.mutations.deleteGalleryVideo);

	const videos = useQuery(api.studio.queries.listGalleryVideos, { limit: 80 });
	const objectKeys = (videos ?? []).map(
		(video: { objectKey?: string }) => video.objectKey,
	);
	const urlsByKey = useSignedMediaUrls(null, objectKeys);
	const withUrls = (videos ?? []).map((video: GalleryVideo) =>
		withSignedUrl(video, urlsByKey),
	);

	const videoConnection = useQuery(
		api.studio.queries.getGalleryVideoRunConnection,
		pendingDeleteId
			? { videoId: pendingDeleteId as Id<"galleryVideos"> }
			: "skip",
	);
	const connectedRun =
		videoConnection && videoConnection !== null
			? (videoConnection as RunConnection)
			: null;
	const canDeleteVideo =
		!deleting && videoConnection === null && pendingDeleteId != null;

	const ordered =
		sort === "oldest"
			? [...withUrls].sort((a, b) => a.createdAt - b.createdAt)
			: [...withUrls].sort((a, b) => b.createdAt - a.createdAt);

	const confirmDelete = async () => {
		if (!pendingDeleteId) return;
		setDeleting(true);
		try {
			await deleteVideo({ videoId: pendingDeleteId as Id<"galleryVideos"> });
			setPendingDeleteId(null);
		} catch (error) {
			notifyStudioError("Could not delete clip", error);
		} finally {
			setDeleting(false);
		}
	};

	return (
		<section className="space-y-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
						Video gallery
					</h1>
					<p className="text-sm text-muted-foreground">
						Shared library of generated clips. Deleting a run does not remove
						these files.
					</p>
				</div>
				{videos && videos.length > 0 ? (
					<Select
						value={sort}
						onValueChange={(value) => value && setSort(value as SortOrder)}
					>
						<SelectTrigger size="sm" aria-label="Sort videos">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="latest">Latest</SelectItem>
							<SelectItem value="oldest">Oldest</SelectItem>
						</SelectContent>
					</Select>
				) : null}
			</div>

			{videos === undefined ? (
				<p className="text-sm text-muted-foreground">Loading video gallery…</p>
			) : videos.length === 0 ? (
				<div className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
					No videos yet. Generate a clip from Shloka Studio or Model Studio.
				</div>
			) : (
				<div className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4">
					{ordered.map((video) => (
						<GalleryVideoCard
							key={video.id}
							video={video}
							busy={deleting}
							onDelete={() => setPendingDeleteId(video.id)}
						/>
					))}
				</div>
			)}

			<AlertDialog
				open={pendingDeleteId != null}
				onOpenChange={(open) => {
					if (!open) setPendingDeleteId(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this clip?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently removes the clip from the shared gallery. This
							cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{connectedRun ? (
						<div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/50 p-3 text-sm">
							<span className="font-medium">
								This clip is connected to a run
							</span>
							<span className="truncate text-xs text-muted-foreground">
								{runLabel(connectedRun)}
							</span>
							<p className="text-xs text-muted-foreground">
								Clips that are part of an existing run flow cannot be deleted.
								Delete the run in the history sidebar (or abandon it) before
								removing this clip.
							</p>
						</div>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={!canDeleteVideo}
							onClick={() => void confirmDelete()}
						>
							{deleting ? "Deleting…" : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}
