import { Download, Film, Loader2, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	compositionMergeCacheKey,
	getCachedMergedComposition,
	type MergeVideoSource,
	mergeCompositionVideos,
	triggerMergedDownload,
} from "#/lib/merge-composition-videos";
import { notifyStudioError, notifyStudioSuccess } from "#/lib/studio-toast";
import { cn } from "#/lib/utils";
import {
	CompositionClipPlayer,
	type CompositionPlayerClip,
} from "./composition-clip-player";
import type { VideoResultItem } from "./video-result";

export type CompositionClipResult = {
	_id: string;
	clipIndex: number;
	status: "pending" | "generating" | "completed" | "failed" | "cancelled";
	scenePrompt: string;
	continuityInstructions?: string;
	transition: string;
	warnings?: string[];
	lastError?: string;
	video?: VideoResultItem;
};

type CompositionResultProps = {
	status:
		| "planned"
		| "generating"
		| "awaiting_terminal_frame"
		| "completed"
		| "failed"
		| "cancelled";
	clips: CompositionClipResult[];
	totalDurationSeconds: number;
	aspectRatio?: string | null;
	mergeSources: MergeVideoSource[];
};

function statusLabel(status: CompositionClipResult["status"]) {
	return status.replace("-", " ");
}

function resolveAspectRatio(
	aspectRatio: string | null | undefined,
	firstCompleted?: CompositionClipResult,
) {
	if (aspectRatio?.trim()) return aspectRatio;
	const fromParams = firstCompleted?.video?.videoParams?.aspectRatio;
	if (fromParams?.trim()) return fromParams;
	const width = firstCompleted?.video?.meta?.width;
	const height = firstCompleted?.video?.meta?.height;
	if (width && height) return `${width}:${height}`;
	return "9:16";
}

export function CompositionResult({
	status,
	clips,
	totalDurationSeconds,
	aspectRatio,
	mergeSources,
}: CompositionResultProps) {
	const completed = useMemo(
		() =>
			[...clips]
				.filter((clip) => clip.status === "completed" && clip.video?.url)
				.sort((a, b) => a.clipIndex - b.clipIndex),
		[clips],
	);
	const playerClips: CompositionPlayerClip[] = useMemo(
		() =>
			completed.map((clip) => ({
				id: clip._id,
				label: clip.clipIndex + 1,
				url: clip.video!.url!,
			})),
		[completed],
	);
	const usableMergeSources = useMemo(
		() =>
			mergeSources.filter(
				(source) => Boolean(source.url) || Boolean(source.objectKey),
			),
		[mergeSources],
	);
	const cacheKey = useMemo(
		() => compositionMergeCacheKey(usableMergeSources),
		[usableMergeSources],
	);
	const [activeIndex, setActiveIndex] = useState(0);
	const [mergeAction, setMergeAction] = useState<"view" | "download" | null>(
		null,
	);
	const [mergeProgress, setMergeProgress] = useState<number | null>(null);
	const [viewingMerged, setViewingMerged] = useState(false);
	const [mergedUrl, setMergedUrl] = useState<string | null>(null);

	const allClipsReady =
		status === "completed" &&
		completed.length === clips.length &&
		completed.length > 0 &&
		usableMergeSources.length > 0;

	useEffect(() => {
		setActiveIndex((current) =>
			Math.min(current, Math.max(completed.length - 1, 0)),
		);
	}, [completed.length]);

	useEffect(() => {
		const cached = cacheKey ? getCachedMergedComposition(cacheKey) : null;
		if (cached) {
			setMergedUrl(cached.objectUrl);
			return;
		}
		setMergedUrl(null);
		setViewingMerged(false);
	}, [cacheKey]);

	const ensureMerged = async () => {
		const cached = getCachedMergedComposition(cacheKey);
		if (cached) {
			setMergedUrl(cached.objectUrl);
			return cached;
		}
		setMergeProgress(0);
		try {
			const merged = await mergeCompositionVideos(usableMergeSources, {
				cacheKey,
				onProgress: setMergeProgress,
			});
			setMergedUrl(merged.objectUrl);
			return merged;
		} finally {
			setMergeProgress(null);
		}
	};

	const onViewFullVideo = async () => {
		setMergeAction("view");
		try {
			const hadCache = Boolean(getCachedMergedComposition(cacheKey));
			await ensureMerged();
			setViewingMerged(true);
			if (!hadCache) {
				notifyStudioSuccess("Full video ready");
			}
		} catch (error) {
			notifyStudioError("Could not build full video", error);
		} finally {
			setMergeAction(null);
		}
	};

	const onDownloadMerged = async () => {
		setMergeAction("download");
		try {
			const hadCache = Boolean(getCachedMergedComposition(cacheKey));
			const merged = await ensureMerged();
			triggerMergedDownload(merged.blob);
			notifyStudioSuccess(
				hadCache ? "Download started" : "Merged download ready",
			);
		} catch (error) {
			notifyStudioError("Merged download failed", error);
		} finally {
			setMergeAction(null);
		}
	};

	if (!clips.length) {
		return null;
	}

	const hasCachedMerge = Boolean(mergedUrl);
	const merging = mergeAction != null;
	const mergeLabel =
		mergeProgress != null ? `Merging… ${mergeProgress}%` : "Merging…";

	return (
		<section className="flex flex-col gap-4 border-t border-border/80 pt-6">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-2">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="font-heading text-xl font-semibold">
							Composed video
						</h2>
						<Badge variant={status === "failed" ? "destructive" : "secondary"}>
							{status}
						</Badge>
					</div>
					<p className="text-sm text-muted-foreground">
						{status === "awaiting_terminal_frame"
							? "Waiting for this browser to capture the continuity frame… Keep the tab open."
							: `${completed.length}/${clips.length} clips ready · ${totalDurationSeconds}s planned`}
					</p>
				</div>
				{allClipsReady ? (
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant={viewingMerged ? "secondary" : "outline"}
							disabled={merging}
							onClick={() => void onViewFullVideo()}
						>
							{mergeAction === "view" ? (
								<Loader2 className="animate-spin" data-icon="inline-start" />
							) : (
								<Film data-icon="inline-start" />
							)}
							{mergeAction === "view"
								? mergeLabel
								: viewingMerged
									? "Playing full video"
									: "View full video"}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={merging}
							onClick={() => void onDownloadMerged()}
						>
							{mergeAction === "download" ? (
								<Loader2 className="animate-spin" data-icon="inline-start" />
							) : (
								<Download data-icon="inline-start" />
							)}
							{mergeAction === "download"
								? mergeLabel
								: hasCachedMerge
									? "Download MP4"
									: "Download merged MP4"}
						</Button>
					</div>
				) : null}
			</div>

			{playerClips.length > 0 ? (
				<CompositionClipPlayer
					clips={playerClips}
					totalClipCount={clips.length}
					aspectRatio={resolveAspectRatio(aspectRatio, completed[0])}
					activeIndex={activeIndex}
					onActiveIndexChange={(index) => {
						setViewingMerged(false);
						setActiveIndex(index);
					}}
					mergedUrl={viewingMerged ? mergedUrl : null}
					onExitMerged={() => setViewingMerged(false)}
				/>
			) : (
				<div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
					The composed player will be ready when the first clip completes.
				</div>
			)}

			<ol className="grid gap-3 md:grid-cols-2">
				{[...clips]
					.sort((a, b) => a.clipIndex - b.clipIndex)
					.map((clip) => {
						const playableIndex = completed.findIndex(
							(item) => item._id === clip._id,
						);
						return (
							<li
								key={clip._id}
								className={cn(
									"rounded-lg border border-border/80 p-3",
									!viewingMerged &&
										playableIndex === activeIndex &&
										"border-primary bg-primary/5",
								)}
							>
								<div className="flex items-start gap-3">
									{playableIndex >= 0 ? (
										<Button
											type="button"
											size="icon-sm"
											variant="ghost"
											aria-label={`Play clip ${clip.clipIndex + 1}`}
											onClick={() => {
												setViewingMerged(false);
												setActiveIndex(playableIndex);
											}}
										>
											<Play />
										</Button>
									) : (
										<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium">
											{clip.clipIndex + 1}
										</span>
									)}
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<p className="text-sm font-medium">
												Clip {clip.clipIndex + 1}
											</p>
											<Badge
												variant={
													clip.status === "failed" ? "destructive" : "outline"
												}
											>
												{statusLabel(clip.status)}
											</Badge>
										</div>
										<p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
											{clip.scenePrompt}
										</p>
										{clip.lastError ? (
											<p className="mt-2 text-xs text-destructive">
												{clip.lastError}
											</p>
										) : null}
										{clip.warnings?.map((warning) => (
											<p
												key={warning}
												className="mt-2 text-xs text-amber-700 dark:text-amber-300"
											>
												{warning}
											</p>
										))}
									</div>
								</div>
							</li>
						);
					})}
			</ol>
		</section>
	);
}
