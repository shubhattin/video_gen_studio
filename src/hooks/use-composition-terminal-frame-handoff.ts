import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { extractCompositionTerminalFrame } from "#/lib/extract-composition-terminal-frame";
import { useAction } from "convex/react";
import { useEffect, useEffectEvent, useRef } from "react";

type CompositionHandoffClip = {
	_id: Id<"compositionClips">;
	clipIndex: number;
	status: string;
	terminalFrameObjectKey?: string;
	video?: { url?: string | null; objectKey?: string };
};

type CompositionHandoffJob =
	| {
			_id: Id<"compositionJobs">;
			status: string;
			mode: "continuation" | "cut-scenes";
			currentClipIndex?: number;
			clips: CompositionHandoffClip[];
	  }
	| null
	| undefined;

/**
 * When continuation mode pauses for a terminal frame, extract it in the browser
 * (WASM FFmpeg) and resume the composition. Next-clip generation stays paused
 * until this client handoff completes — keep the studio tab open.
 */
export function useCompositionTerminalFrameHandoff(args: {
	runId?: Id<"generationRuns"> | null;
	compositionJob: CompositionHandoffJob;
	onError?: (error: unknown) => void;
}) {
	const prepareUpload = useAction(api.studioR2.prepareTerminalFrameUpload);
	const finalizeUpload = useAction(api.studioR2.finalizeTerminalFrameUpload);
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
		job && jobStatus === "awaiting_terminal_frame" && jobMode === "continuation"
			? typeof currentClipIndex === "number"
				? job.clips.find((item) => item.clipIndex === currentClipIndex)
				: job.clips
						.filter(
							(item) =>
								item.status === "completed" &&
								!item.terminalFrameObjectKey &&
								item.video?.url,
						)
						.sort((a, b) => b.clipIndex - a.clipIndex)[0]
			: undefined;
	const clipId = handoffClip?._id;
	const videoUrl = handoffClip?.video?.url ?? null;
	const hasTerminalFrame = Boolean(handoffClip?.terminalFrameObjectKey);

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
				const prepared = await prepareUpload({
					runId,
					clipId,
					mimeType: frame.type || "image/jpeg",
				});
				const uploaded = await fetch(prepared.uploadUrl, {
					method: "PUT",
					headers: { "Content-Type": prepared.contentType },
					body: frame,
				});
				if (!uploaded.ok) {
					throw new Error(
						`Continuity-frame upload failed (${uploaded.status}).`,
					);
				}
				if (cancelled) return;
				await finalizeUpload({
					runId,
					clipId,
					objectKey: prepared.objectKey,
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
		finalizeUpload,
		hasTerminalFrame,
		jobId,
		jobMode,
		jobStatus,
		onError,
		prepareUpload,
		runId,
		videoUrl,
	]);
}
