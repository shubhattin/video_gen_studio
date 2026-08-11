import { Download, Loader2, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";
import type { VideoResultItem } from "./video-result";

export type CompositionClipResult = {
	_id: string;
	clipIndex: number;
	status: "pending" | "generating" | "completed" | "failed" | "cancelled";
	scenePrompt: string;
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
	onDownloadMerged?: () => void;
	merging?: boolean;
};

function statusLabel(status: CompositionClipResult["status"]) {
	return status.replace("-", " ");
}

export function CompositionResult({
	status,
	clips,
	totalDurationSeconds,
	onDownloadMerged,
	merging,
}: CompositionResultProps) {
	const completed = useMemo(
		() =>
			[...clips]
				.filter((clip) => clip.status === "completed" && clip.video?.url)
				.sort((a, b) => a.clipIndex - b.clipIndex),
		[clips],
	);
	const [activeIndex, setActiveIndex] = useState(0);
	const active = completed[activeIndex];

	useEffect(() => {
		setActiveIndex((current) =>
			Math.min(current, Math.max(completed.length - 1, 0)),
		);
	}, [completed.length]);

	if (!clips.length) {
		return null;
	}

	return (
		<section className="flex flex-col gap-4 border-t border-border/80 pt-6">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<div className="flex items-center gap-2">
						<h2 className="font-heading text-xl font-semibold">
							Composed video
						</h2>
						<Badge variant={status === "failed" ? "destructive" : "secondary"}>
							{status}
						</Badge>
					</div>
					<p className="text-sm text-muted-foreground">
						{status === "awaiting_terminal_frame"
							? "Capturing continuity frame from the last clip…"
							: `${completed.length}/${clips.length} clips ready · ${totalDurationSeconds}s planned`}
					</p>
				</div>
				{onDownloadMerged &&
				status === "completed" &&
				completed.length === clips.length ? (
					<Button
						type="button"
						variant="outline"
						disabled={merging}
						onClick={onDownloadMerged}
					>
						{merging ? (
							<Loader2 className="animate-spin" data-icon="inline-start" />
						) : (
							<Download data-icon="inline-start" />
						)}
						{merging ? "Merging…" : "Download merged MP4"}
					</Button>
				) : null}
			</div>

			{active?.video?.url ? (
				<div className="overflow-hidden rounded-xl border border-border bg-black">
					<video
						key={active.video.id}
						src={active.video.url}
						controls
						autoPlay
						playsInline
						preload="auto"
						onEnded={() => {
							if (activeIndex < completed.length - 1) {
								setActiveIndex(activeIndex + 1);
							}
						}}
						className="mx-auto max-h-[min(70vh,560px)] w-full object-contain"
					>
						<track kind="captions" srcLang="en" label="Captions unavailable" />
					</video>
					<p className="border-t border-white/15 px-3 py-2 text-sm text-white/75">
						Playing clip {active.clipIndex + 1} of {clips.length}
					</p>
				</div>
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
											onClick={() => setActiveIndex(playableIndex)}
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
