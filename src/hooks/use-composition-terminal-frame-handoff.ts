import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { extractCompositionTerminalFrame } from "#/lib/extract-composition-terminal-frame";
import { useMutation } from "convex/react";
import { useEffect, useEffectEvent, useRef } from "react";

type CompositionHandoffClip = {
	_id: Id<"compositionClips">;
	clipIndex: number;
	status: string;
	terminalFrameStorageId?: Id<"_storage">;
	video?: { url?: string | null };
};

type CompositionHandoffJob = {
	_id: Id<"compositionJobs">;
	status: string;
	mode: "continuation" | "cut-scenes";
	currentClipIndex?: number;
	clips: CompositionHandoffClip[];
} | null | undefined;

/**
 * When continuation mode pauses for a terminal frame, extract it in the browser
 * and resume the composition. Convex cloud cannot reach localhost FFmpeg.
 */
export function useCompositionTerminalFrameHandoff(args: {
	runId?: Id<"generationRuns"> | null;
	compositionJob: CompositionHandoffJob;
	onError?: (error: unknown) => void;
}) {
	const generateUploadUrl = useMutation(api.studio.generateUploadUrl);
	const submitFrame = useMutation(api.studio.submitCompositionTerminalFrame);
	const inFlightRef = useRef<string | null>(null);
	const onError = useEffectEvent((error: unknown) => {
		args.onError?.(error);
	});

	const job = args.compositionJob;
	const runId = args.runId;
	const jobId = job?._id;
	const jobStatus = job?.status;
	const jobMode = job?.mode;
	const currentClipIndex = job?.currentClipIndex;
	const handoffClip =
		job &&
		jobStatus === "awaiting_terminal_frame" &&
		jobMode === "continuation"
			? typeof currentClipIndex === "number"
				? job.clips.find((item) => item.clipIndex === currentClipIndex)
				: job.clips
						.filter(
							(item) =>
								item.status === "completed" &&
								!item.terminalFrameStorageId &&
								item.video?.url,
						)
						.sort((a, b) => b.clipIndex - a.clipIndex)[0]
			: undefined;
	const clipId = handoffClip?._id;
	const videoUrl = handoffClip?.video?.url ?? null;
	const hasTerminalFrame = Boolean(handoffClip?.terminalFrameStorageId);

	useEffect(() => {
		if (
			!runId ||
			!jobId ||
			jobStatus !== "awaiting_terminal_frame" ||
			jobMode !== "continuation" ||
			!clipId ||
			!videoUrl ||
			hasTerminalFrame
		) {
			return;
		}
		const flightKey = `${jobId}:${clipId}`;
		if (inFlightRef.current === flightKey) {
			return;
		}
		inFlightRef.current = flightKey;
		let cancelled = false;

		void (async () => {
			try {
				const frame = await extractCompositionTerminalFrame(videoUrl);
				if (cancelled) return;
				const uploadUrl = await generateUploadUrl({});
				const uploaded = await fetch(uploadUrl, {
					method: "POST",
					headers: { "Content-Type": frame.type || "image/jpeg" },
					body: frame,
				});
				if (!uploaded.ok) {
					throw new Error(
						`Continuity-frame upload failed (${uploaded.status}).`,
					);
				}
				const { storageId } = (await uploaded.json()) as {
					storageId: Id<"_storage">;
				};
				if (cancelled) return;
				await submitFrame({
					runId,
					clipId,
					storageId,
				});
			} catch (error) {
				if (!cancelled) {
					onError(error);
				}
			} finally {
				if (inFlightRef.current === flightKey) {
					inFlightRef.current = null;
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [
		clipId,
		generateUploadUrl,
		hasTerminalFrame,
		jobId,
		jobMode,
		jobStatus,
		onError,
		runId,
		submitFrame,
		videoUrl,
	]);
}
