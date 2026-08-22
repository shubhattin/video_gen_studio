import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoConfigState } from "#/components/studio/video/video-configuration";
import type { PlannerPromptSelection } from "#/lib/planner-prompt";
import type { NormalizedVideoScene } from "#/lib/video-plan-markdown";

export type RunAutosaveStatus = "idle" | "saving" | "saved" | "error";

/** Run-level draft patch (shloka runs). */
export type DraftPatch = {
	shlokaText?: string;
	customInstructions?: string;
	plannerPromptSelection?: PlannerPromptSelection | null;
	imageSize?: string;
	imageQuality?: string;
	firstFrameImageId?: Id<"galleryImages"> | null;
	lastFrameImageId?: Id<"galleryImages"> | null;
	extraReferenceImageIds?: Id<"galleryImages">[];
};

/** Plan-level patch (video config + generated content edits). */
export type PlanPatch = {
	videoParams?: VideoConfigState;
	imagePrompt?: string;
	videoScenes?: NormalizedVideoScene[];
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

function isBusyError(error: unknown): boolean {
	return (
		error instanceof Error &&
		/run is busy|wait for generation to finish/i.test(error.message)
	);
}

type QueueOptions<P> = {
	isBusy: () => boolean;
	flush: (patch: P) => Promise<void>;
	onError?: (error: unknown) => void;
};

/**
 * Shared autosave queue: debounced/immediate writes, pending merge, busy-hold
 * with retry-on-idle, flush on run switch / pagehide / unmount.
 */
function useAutosaveQueue<P extends object>(options: QueueOptions<P>) {
	const [status, setStatus] = useState<RunAutosaveStatus>("idle");
	const [hasPending, setHasPending] = useState(false);

	const pendingRef = useRef<P>({} as P);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const busyRef = useRef(false);
	const retryWhenIdleRef = useRef(false);
	const chainRef = useRef<Promise<void>>(Promise.resolve());
	const onErrorRef = useRef(options.onError);
	const optionsRef = useRef(options);

	busyRef.current = options.isBusy();
	onErrorRef.current = options.onError;
	optionsRef.current = options;

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

	const flush = useCallback((): Promise<void> => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		const patch = pendingRef.current;
		if (Object.keys(patch).length === 0) {
			return chainRef.current;
		}
		// Hold the patch while the stage is busy; retry when it finishes.
		if (busyRef.current) {
			retryWhenIdleRef.current = true;
			return chainRef.current;
		}
		pendingRef.current = {} as P;
		setHasPending(false);
		if (savedTimerRef.current) {
			clearTimeout(savedTimerRef.current);
			savedTimerRef.current = null;
		}
		setStatus("saving");
		const attempt = async () => {
			try {
				await optionsRef.current.flush(patch);
				if (Object.keys(pendingRef.current).length === 0) {
					markSaved();
				}
			} catch (error) {
				// Newer edits win when merging the failed patch back.
				pendingRef.current = { ...patch, ...pendingRef.current };
				setHasPending(true);
				if (isBusyError(error)) {
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
	}, [markSaved]);

	const save = useCallback(
		(patch: Partial<P>, mode: SaveMode = "immediate") => {
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

	// Retry held writes once the target leaves a busy stage.
	useEffect(() => {
		if (!busyRef.current && retryWhenIdleRef.current) {
			retryWhenIdleRef.current = false;
			void flush();
		}
	});

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

	// Fire-and-forget flush on unmount (SPA navigation).
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
		};
	}, []);

	return { status, hasPending, save, flush, retry };
}

/** Autosave pipeline for shloka-run-level draft fields. */
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
	const runIdRef = useRef(runId);

	// Flush pending edits to the previous run before switching runs.
	useEffect(() => {
		if (runIdRef.current === runId) {
			return;
		}
		runIdRef.current = runId;
	}, [runId]);

	const queue = useAutosaveQueue<DraftPatch>({
		isBusy: () => runStatus === "planning" || runStatus === "video_generating",
		flush: async (patch) => {
			const target = runIdRef.current;
			if (!target) return;
			await updateDraft({ runId: target, ...patch });
		},
		onError,
	});

	return queue;
}

/** Autosave pipeline for plan-scoped config + content edits. */
export function usePlanAutosave({
	runId,
	planId,
	planStatus,
	onError,
}: {
	runId: Id<"generationRuns"> | null;
	planId: Id<"shlokaPlans"> | null;
	planStatus?: string | null;
	onError?: (error: unknown) => void;
}) {
	const updatePlanConfig = useMutation(api.studio.mutations.updatePlanConfig);
	const updatePlanContent = useMutation(api.studio.mutations.updatePlanContent);
	const idsRef = useRef({ runId, planId });

	useEffect(() => {
		idsRef.current = { runId, planId };
	}, [runId, planId]);

	const queue = useAutosaveQueue<PlanPatch>({
		isBusy: () => planStatus === "planning",
		flush: async (patch) => {
			const { runId: rid, planId: pid } = idsRef.current;
			if (!rid || !pid) return;
			const { videoParams, ...content } = patch;
			if (videoParams) {
				const { prompt: _prompt, ...config } = videoParams;
				await updatePlanConfig({
					runId: rid,
					planId: pid,
					videoParams: config,
				});
			}
			if (Object.keys(content).length > 0) {
				await updatePlanContent({
					runId: rid,
					planId: pid,
					...content,
				});
			}
		},
		onError,
	});

	return queue;
}
