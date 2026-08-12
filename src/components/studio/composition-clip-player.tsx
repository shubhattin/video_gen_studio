import { type CSSProperties, useEffect, useEffectEvent, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";

export type CompositionPlayerClip = {
	id: string;
	label: number;
	url: string;
};

type CompositionClipPlayerProps = {
	clips: CompositionPlayerClip[];
	totalClipCount: number;
	aspectRatio?: string | null;
	activeIndex: number;
	onActiveIndexChange: (index: number) => void;
	/** When set, play the merged full video instead of individual clips. */
	mergedUrl?: string | null;
	onExitMerged?: () => void;
	className?: string;
};

function parseAspectParts(aspectRatio?: string | null): {
	w: number;
	h: number;
} {
	const match = aspectRatio
		?.trim()
		.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
	if (!match) {
		return { w: 9, h: 16 };
	}
	const w = Number(match[1]);
	const h = Number(match[2]);
	if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
		return { w: 9, h: 16 };
	}
	return { w, h };
}

function stageStyle(aspectRatio?: string | null): CSSProperties {
	const { w, h } = parseAspectParts(aspectRatio);
	return {
		aspectRatio: `${w} / ${h}`,
		height: "min(70vh, 560px)",
		width: `min(100%, calc(min(70vh, 560px) * ${w} / ${h}))`,
		maxWidth: "100%",
	};
}

export function CompositionClipPlayer({
	clips,
	totalClipCount,
	aspectRatio,
	activeIndex,
	onActiveIndexChange,
	mergedUrl,
	onExitMerged,
	className,
}: CompositionClipPlayerProps) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const viewingMerged = Boolean(mergedUrl);
	const active = clips[activeIndex];
	const canGoPrev = !viewingMerged && activeIndex > 0;
	const canGoNext = !viewingMerged && activeIndex < clips.length - 1;

	const playSource = useEffectEvent((url: string) => {
		const video = videoRef.current;
		if (!video || !url) return;
		video.loop = false;
		if (video.getAttribute("src") !== url) {
			video.setAttribute("src", url);
			video.load();
		}
		video.currentTime = 0;
		void video.play().catch(() => undefined);
	});

	useEffect(() => {
		if (mergedUrl) {
			playSource(mergedUrl);
			return;
		}
		const url = clips[activeIndex]?.url;
		if (url) {
			playSource(url);
		}
	}, [mergedUrl, activeIndex, active?.url, playSource, clips]);

	if (!viewingMerged && !active?.url) {
		return null;
	}

	return (
		<div
			className={cn(
				"overflow-hidden rounded-xl border border-border bg-black",
				className,
			)}
		>
			<div className="flex w-full justify-center bg-black">
				<div className="relative bg-black" style={stageStyle(aspectRatio)}>
					<video
						ref={videoRef}
						key={mergedUrl ? "merged" : active?.id}
						controls
						playsInline
						preload="auto"
						loop={false}
						crossOrigin={mergedUrl ? undefined : "anonymous"}
						className="absolute inset-0 h-full w-full object-contain"
					>
						<track kind="captions" srcLang="en" label="Captions unavailable" />
					</video>
				</div>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/15 px-3 py-2.5">
				<p className="text-sm text-white/75">
					{viewingMerged
						? `Full video · ${totalClipCount} clips`
						: `Clip ${active?.label ?? activeIndex + 1} of ${totalClipCount}`}
				</p>
				<div className="flex flex-wrap items-center gap-1.5">
					{viewingMerged ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="h-8 text-white hover:bg-white/10 hover:text-white"
							onClick={onExitMerged}
						>
							Back to clips
						</Button>
					) : (
						<>
							<Button
								type="button"
								size="icon-sm"
								variant="ghost"
								disabled={!canGoPrev}
								aria-label="Previous clip"
								className="text-white hover:bg-white/10 hover:text-white disabled:text-white/30"
								onClick={() =>
									onActiveIndexChange(Math.max(0, activeIndex - 1))
								}
							>
								<ChevronLeft />
							</Button>
							{clips.map((clip, index) => {
								const isActive = index === activeIndex;
								return (
									<button
										key={clip.id}
										type="button"
										aria-label={`Play clip ${clip.label}`}
										aria-current={isActive ? "true" : undefined}
										onClick={() => onActiveIndexChange(index)}
										className={cn(
											"flex size-8 items-center justify-center rounded-md border text-sm font-medium transition-colors",
											isActive
												? "border-white bg-white text-black"
												: "border-white/30 bg-transparent text-white/80 hover:border-white/60 hover:bg-white/10",
										)}
									>
										{clip.label}
									</button>
								);
							})}
							<Button
								type="button"
								size="icon-sm"
								variant="ghost"
								disabled={!canGoNext}
								aria-label="Next clip"
								className="text-white hover:bg-white/10 hover:text-white disabled:text-white/30"
								onClick={() =>
									onActiveIndexChange(
										Math.min(clips.length - 1, activeIndex + 1),
									)
								}
							>
								<ChevronRight />
							</Button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
