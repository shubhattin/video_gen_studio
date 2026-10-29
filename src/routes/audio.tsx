import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { AudioRunSetup } from "#/components/studio/audio/audio-run-setup";
import { AudioStudio } from "#/components/studio/audio/audio-studio";
import { HistoryPanel } from "#/components/studio/shell/history-panel";
import { StudioRunSkeleton } from "#/components/studio/shell/studio-run-skeleton";
import { StudioShell } from "#/components/studio/shell/studio-shell";
import {
	type StudioRunSearch,
	studioRunSearchSchema,
} from "#/lib/studio-run-search";

export const Route = createFileRoute("/audio")({
	validateSearch: studioRunSearchSchema,
	component: AudioStudioPage,
});

function clearRunSearch(prev: StudioRunSearch): StudioRunSearch {
	const { run: _run, plan: _plan, ...rest } = prev;
	return rest;
}

function AudioStudioPage() {
	const navigate = useNavigate({ from: Route.fullPath });
	const { run: runSearch } = Route.useSearch();
	const selectedRunId = (runSearch as Id<"audioRuns"> | undefined) ?? null;

	const setSelectedRunId = (id: Id<"audioRuns"> | null, replace = false) => {
		void navigate({
			search: (prev) => (id ? { ...prev, run: id } : clearRunSearch(prev)),
			replace,
		});
	};

	const run = useQuery(
		api.audio.queries.getAudioRun,
		selectedRunId ? { runId: selectedRunId } : "skip",
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: only re-check existence when the selected run or its load state changes.
	useEffect(() => {
		if (selectedRunId && run === null) {
			setSelectedRunId(null, true);
		}
	}, [selectedRunId, run === null]);

	const guided = run?.mode === "guided";

	return (
		<StudioShell
			activePath="/audio"
			title={
				run
					? guided
						? "Sanskrit Song Studio"
						: "Audio Model Studio"
					: undefined
			}
			subtitle={
				run
					? guided
						? "Short Sanskrit musiclets from your instructions"
						: "Direct audio model API access"
					: undefined
			}
			history={
				<HistoryPanel
					selectedRunId={selectedRunId}
					onDeleted={(id) => {
						if (selectedRunId === id) {
							setSelectedRunId(null, true);
						}
					}}
				/>
			}
		>
			{!selectedRunId ? (
				<div className="rounded-2xl border border-border/80 bg-card p-4 sm:p-6">
					<AudioRunSetup onCreated={(id) => setSelectedRunId(id)} />
				</div>
			) : run === undefined ? (
				<StudioRunSkeleton />
			) : (
				<div className="rounded-2xl border border-border/80 bg-card p-4 sm:p-6">
					<AudioStudio key={selectedRunId} runId={selectedRunId} />
				</div>
			)}
		</StudioShell>
	);
}
