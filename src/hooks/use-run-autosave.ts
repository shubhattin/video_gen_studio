import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoConfigState } from "#/components/studio/video/video-configuration";
import type { PlannerPromptSelection } from "#/lib/planner-prompt";

export type RunAutosaveStatus = "idle" | "saving" | "saved" | "error";

/** Subset of updateDraft args that the studios autosave. */
export type DraftPatch = {
	shlokaText?: string;
	customInstructions?: string;
	plannerPromptSelection?: PlannerPromptSelection | null;
	imageSize?: string;
	imageQuality?: string;
	selectedModelId?: string;
	videoParams?: VideoConfigState;
	videoPrompt?: string;
	compositionMode?: "continuation" | "cut-scenes" | null;
	compositionMultiplier?: number | null;
	compositionClipCount?: number | null;
	firstFrameImageId?: Id<"galleryImages"> | null;
	lastFrameImageId?: Id<"galleryImages"> | null;
	extraReferenceImageIds?: Id<"galleryImages">[];
};

export type SaveMode = "debounced" | "immediate";

const TEXT_DEBOUNCE_MS = 1200;
const SAVED_BADGE_MS = 2000;

const TEXTUAL_CONFIG_KEYS = new Set(["negativePrompt", "prompt"]);

/**
 * True when only free-text fields differ between two video configs — text-only
 * edits are debounced; structural changes (model, ratio, duration…) save
 * immediately.
 */
export function isTextOnlyConfigChange(
	previous: VideoConfigState,
	next: VideoConfigState,
): boolean {
	const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
	for (const key of keys) {
		if (
			!TEXTUAL_CONFIG_KEYS.has(key) &&
			!Object.is(
				previous[key as keyof VideoConfigState],
				next[key as keyof VideoConfigState],
			)
		) {
			return false;
		}
	}
	return true;
}

function isRunBusyError(error: unknown): boolean {
	return error instanceof Error && /run is busy/i.test(error.message);
}

/**
 * Autosave pipeline for run drafts.
 *
 * - Text fields: debounced writes after the last keystroke.
 * - Discrete fields: immediate writes.
 * - Pending edits flush when the tab is hidden, on pagehide, on unmount, and
 *   when the selected run changes (flushed to the previous run).
 * - updateDraft rejects writes while a run is planning/generating; those
 *   writes are held and retried once the run becomes idle.
 */
export function useRunAutosave({
	runId,
	runStatus,
	onError,
}: {
	runId: Id<"generationRuns"> | null;
	runStatus?: string | null;
	onError?: (error: unknown) => void;
}) {
	const updateDraft = useMutation(api.studio.mutations.updateDraft);
	const [status, setStatus] = useState<RunAutosaveStatus>("idle");
	const [hasPending, setHasPending] = useState(false);

	const pendingRef = useRef<DraftPatch>({});
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const runIdRef = useRef(runId);
	const runBusyRef = useRef(false);
	const retryWhenIdleRef = useRef(false);
	const chainRef = useRef<Promise<void>>(Promise.resolve());
	const onErrorRef = useRef(onError);

	runBusyRef.current =
		runStatus === "planning" || runStatus === "video_generating";
	onErrorRef.current = onError;

	const markSaved = useCallback(() => {
		if (savedTimerRef.current) {
			clearTimeout(savedTimerRef.current);
		}
		setStatus("saved");
		savedTimerRef.current = setTimeout(() => {
			savedTimerRef.current = null;
			setStatus("idle");
		}, SAVED_BADGE_MS);
	}, []);

	const flush = useCallback(
		(targetRunId?: Id<"generationRuns">): Promise<void> => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			const effectiveRunId = targetRunId ?? runIdRef.current;
			const patch = pendingRef.current;
			if (!effectiveRunId) {
				pendingRef.current = {};
				setHasPending(false);
				return chainRef.current;
			}
			if (Object.keys(patch).length === 0) {
				return chainRef.current;
			}
			// Hold the patch while the stage is busy; retry when it finishes.
			if (runBusyRef.current && targetRunId === undefined) {
				retryWhenIdleRef.current = true;
				return chainRef.current;
			}
			const bestEffort = targetRunId !== undefined;
			pendingRef.current = {};
			setHasPending(false);
			if (savedTimerRef.current) {
				clearTimeout(savedTimerRef.current);
				savedTimerRef.current = null;
			}
			setStatus("saving");
			const attempt = async () => {
				try {
					await updateDraft({ runId: effectiveRunId, ...patch });
					if (Object.keys(pendingRef.current).length === 0) {
						markSaved();
					}
				} catch (error) {
					if (bestEffort) {
						console.warn("[autosave] dropped draft patch", error);
						return;
					}
					// Newer edits win when merging the failed patch back.
					pendingRef.current = { ...patch, ...pendingRef.current };
					setHasPending(true);
					if (isRunBusyError(error)) {
						retryWhenIdleRef.current = true;
						setStatus("idle");
					} else {
						setStatus("error");
						onErrorRef.current?.(error);
					}
				}
			};
			chainRef.current = chainRef.current.then(attempt, attempt);
			return chainRef.current;
		},
		[updateDraft, markSaved],
	);

	const save = useCallback(
		(patch: DraftPatch, mode: SaveMode = "immediate") => {
			pendingRef.current = { ...pendingRef.current, ...patch };
			setHasPending(true);
			setStatus((previous) => (previous === "error" ? "idle" : previous));
			if (mode === "immediate") {
				void flush();
				return;
			}
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				void flush();
			}, TEXT_DEBOUNCE_MS);
		},
		[flush],
	);

	const retry = useCallback(() => {
		retryWhenIdleRef.current = false;
		void flush();
	}, [flush]);

	// Retry held writes once the run leaves a busy stage.
	useEffect(() => {
		const busy = runStatus === "planning" || runStatus === "video_generating";
		if (!busy && retryWhenIdleRef.current) {
			retryWhenIdleRef.current = false;
			void flush();
		}
	}, [runStatus, flush]);

	// Flush pending edits to the previous run before switching runs.
	useEffect(() => {
		if (runIdRef.current === runId) {
			return;
		}
		const previousRunId = runIdRef.current;
		runIdRef.current = runId;
		setStatus("idle");
		setHasPending(false);
		if (previousRunId) {
			void flush(previousRunId);
		}
	}, [runId, flush]);

	// Best-effort flush when the tab is hidden or the page is being unloaded.
	useEffect(() => {
		const flushNow = () => {
			void flush();
		};
		const onVisibilityChange = () => {
			if (document.visibilityState === "hidden") {
				flushNow();
			}
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
		window.addEventListener("pagehide", flushNow);
		return () => {
			document.removeEventListener("visibilitychange", onVisibilityChange);
			window.removeEventListener("pagehide", flushNow);
		};
	}, [flush]);

	// Fire-and-forget flush when the studio unmounts (SPA navigation).
	useEffect(() => {
		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			if (savedTimerRef.current) {
				clearTimeout(savedTimerRef.current);
				savedTimerRef.current = null;
			}
			const patch = pendingRef.current;
			const id = runIdRef.current;
			if (id && Object.keys(patch).length > 0) {
				void updateDraft({ runId: id, ...patch }).catch(() => undefined);
			}
		};
	}, [updateDraft]);

	return { status, hasPending, save, flush, retry };
}
