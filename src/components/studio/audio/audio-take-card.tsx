import { Download, Info, Loader2, Trash2 } from "lucide-react";
import prettyMs from "pretty-ms";
import { type ReactNode, useState } from "react";
import { MessageResponse } from "#/components/ai-elements/message";
import {
	formatBytes,
	saveDownloadResponse,
} from "#/components/studio/video/video-result";
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
import { Skeleton } from "#/components/ui/skeleton";
import { AUDIO_MODEL_PROFILES, type AudioModelId } from "#/lib/audio-catalog";
import { cn } from "#/lib/utils";

export type AudioTakeItem = {
	id: string;
	objectKey?: string;
	url?: string | null;
	meta?: { mimeType?: string; durationSeconds?: number; bytes?: number };
	audioParams?: {
		modelId?: string;
		voice?: string;
		targetDurationSeconds?: number;
		instrumental?: boolean;
	};
	prompt?: string;
	outputText?: string;
	referenceImageCount?: number;
	actualCostUsd?: number;
	timeTakenMs?: number;
	warnings?: string[];
	/** Guided takes: 0-based script revision the take was generated from. */
	scriptRevisionIndex?: number;
	createdAt: number;
};

const markdownClassName =
	"text-xs leading-relaxed [&_strong]:font-semibold [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

function InfoRow({ label, value }: { label: string; value?: ReactNode }) {
	if (value == null || value === "") return null;
	return (
		<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 text-xs">
			<span className="text-muted-foreground">{label}</span>
			<span className="min-w-0 break-words">{value}</span>
		</div>
	);
}

export function formatAudioDuration(seconds?: number) {
	if (seconds == null || !Number.isFinite(seconds)) return null;
	const whole = Math.round(seconds);
	const minutes = Math.floor(whole / 60);
	const rest = whole % 60;
	return minutes > 0
		? `${minutes}:${String(rest).padStart(2, "0")}`
		: `${rest}s`;
}

function formatUsd(value?: number) {
	if (value == null || !Number.isFinite(value)) return null;
	return `$${value >= 0.01 ? value.toFixed(2) : value.toFixed(4)}`;
}

function extensionForAudio(mimeType?: string) {
	return mimeType === "audio/wav" ? "wav" : "mp3";
}

type AudioTakeCardProps = {
	take: AudioTakeItem;
	/** e.g. "Take 3" in a run, omitted in the gallery. */
	label?: string;
	isLatest?: boolean;
	/** Label the take with its script revision (runs with several revisions). */
	showRevision?: boolean;
	urlPending?: boolean;
	/** Extra rows in the details popover (gallery: run connection). */
	details?: ReactNode;
	onDelete?: () => void;
	deleteDisabled?: boolean;
	className?: string;
};

/** One generated track: player, lyrics/transcript, details, download. */
export function AudioTakeCard({
	take,
	label,
	isLatest,
	showRevision,
	urlPending,
	details,
	onDelete,
	deleteDisabled,
	className,
}: AudioTakeCardProps) {
	const [downloading, setDownloading] = useState(false);
	const modelId = take.audioParams?.modelId;
	const profile = modelId
		? AUDIO_MODEL_PROFILES[modelId as AudioModelId]
		: undefined;
	const modelLabel = profile?.displayName ?? modelId ?? "Audio";
	const duration = formatAudioDuration(take.meta?.durationSeconds);
	const outputText = take.outputText?.trim();
	const isInstrumentalText = outputText === "<instrumental>";
	// Legacy GPT Audio takes carry a transcript instead of lyrics.
	const textLabel = take.audioParams?.voice ? "Transcript" : "Lyrics";

	const onDownload = async () => {
		if (!take.url || downloading) return;
		setDownloading(true);
		try {
			const response = await fetch(take.url, { cache: "no-store" });
			await saveDownloadResponse(
				response,
				`studio-audio-${take.id}.${extensionForAudio(take.meta?.mimeType)}`,
			);
		} catch (error) {
			window.alert(
				error instanceof Error ? error.message : "Could not download audio",
			);
		} finally {
			setDownloading(false);
		}
	};

	return (
		<article
			className={cn(
				"overflow-hidden rounded-2xl border border-border/70 bg-card",
				className,
			)}
		>
			<div className="flex items-center gap-2 px-3 pt-3">
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
					{label ? <span className="text-sm font-medium">{label}</span> : null}
					{isLatest ? (
						<Badge variant="secondary" className="font-normal">
							Latest
						</Badge>
					) : null}
					{showRevision && take.scriptRevisionIndex !== undefined ? (
						<Badge variant="outline" className="font-normal tabular-nums">
							Rev {take.scriptRevisionIndex + 1}
						</Badge>
					) : null}
					<span
						className={cn(
							"truncate",
							label ? "text-xs text-muted-foreground" : "text-sm font-medium",
						)}
					>
						{modelLabel}
					</span>
					{duration ? (
						<span className="text-xs text-muted-foreground">{duration}</span>
					) : null}
					{take.audioParams?.voice ? (
						<span className="text-xs capitalize text-muted-foreground">
							{take.audioParams.voice}
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
								aria-label="Track details"
							/>
						}
					>
						<Info />
					</PopoverTrigger>
					<PopoverContent align="end" className="w-80 gap-3 p-4">
						<PopoverHeader>
							<PopoverTitle>Track details</PopoverTitle>
							<PopoverDescription>
								Generation details for this track.
							</PopoverDescription>
						</PopoverHeader>
						<div className="flex flex-col gap-2">
							<InfoRow
								label="id"
								value={<span className="break-all font-mono">{take.id}</span>}
							/>
							<InfoRow
								label="Created"
								value={new Date(take.createdAt).toLocaleString()}
							/>
							<InfoRow label="Model" value={modelLabel} />
							<InfoRow
								label="Voice"
								value={
									take.audioParams?.voice ? (
										<span className="capitalize">{take.audioParams.voice}</span>
									) : null
								}
							/>
							<InfoRow label="Duration" value={duration} />
							<InfoRow
								label="Images"
								value={
									take.referenceImageCount
										? `${take.referenceImageCount} sent`
										: null
								}
							/>
							<InfoRow label="Size" value={formatBytes(take.meta?.bytes)} />
							<InfoRow
								label="Final cost"
								value={formatUsd(take.actualCostUsd)}
							/>
							<InfoRow
								label="Time taken"
								value={
									take.timeTakenMs != null ? prettyMs(take.timeTakenMs) : null
								}
							/>
							{take.warnings?.length ? (
								<InfoRow label="Warnings" value={take.warnings.join(" · ")} />
							) : null}
						</div>
						{details}
						{take.prompt?.trim() ? (
							<div className="flex flex-col gap-1.5 border-t border-border/70 pt-3">
								<span className="text-xs text-muted-foreground">
									Prompt sent
								</span>
								<div className="max-h-36 overflow-y-auto text-foreground">
									<MessageResponse className={markdownClassName}>
										{take.prompt.trim()}
									</MessageResponse>
								</div>
							</div>
						) : null}
					</PopoverContent>
				</Popover>

				<Button
					type="button"
					variant="outline"
					size="icon-sm"
					disabled={!take.url || downloading}
					aria-label="Download track"
					onClick={() => void onDownload()}
				>
					{downloading ? <Loader2 className="animate-spin" /> : <Download />}
				</Button>
				{onDelete ? (
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={deleteDisabled}
						aria-label="Delete track"
						onClick={onDelete}
					>
						<Trash2 />
					</Button>
				) : null}
			</div>

			<div className="px-3 pt-2.5 pb-3">
				{take.url ? (
					<audio
						src={take.url}
						controls
						preload="metadata"
						className="block h-10 w-full"
					>
						<track kind="captions" />
					</audio>
				) : urlPending ? (
					<Skeleton className="h-10 w-full rounded-full" />
				) : (
					<div className="flex h-10 items-center justify-center rounded-full bg-muted/40 text-xs text-muted-foreground">
						Audio unavailable
					</div>
				)}
			</div>

			{outputText && !isInstrumentalText ? (
				<details className="group border-t border-border/70">
					<summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
						<span className="group-open:hidden">
							Show {textLabel.toLowerCase()}
						</span>
						<span className="hidden group-open:inline">
							Hide {textLabel.toLowerCase()}
						</span>
					</summary>
					<pre className="max-h-56 overflow-y-auto px-3 pb-3 font-sans text-sm leading-relaxed whitespace-pre-wrap">
						{outputText}
					</pre>
				</details>
			) : isInstrumentalText ? (
				<p className="border-t border-border/70 px-3 py-2 text-xs text-muted-foreground">
					Instrumental
				</p>
			) : null}
		</article>
	);
}

export const AUDIO_TAKE_SKELETON_KEYS = Array.from(
	{ length: 4 },
	(_, i) => `audio-skeleton-${i}`,
);

export function AudioTakeCardSkeleton() {
	return (
		<article className="overflow-hidden rounded-2xl border border-border/70 bg-card p-3">
			<div className="flex items-center gap-2">
				<Skeleton className="h-4 w-28" />
				<Skeleton className="h-3 w-10" />
				<Skeleton className="ml-auto size-7 rounded-md" />
				<Skeleton className="size-7 rounded-md" />
			</div>
			<Skeleton className="mt-3 h-10 w-full rounded-full" />
		</article>
	);
}
