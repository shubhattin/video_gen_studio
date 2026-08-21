import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { ModelStudio } from "#/components/studio/model/model-studio";
import { HistoryPanel } from "#/components/studio/shell/history-panel";
import { NewRunSetup } from "#/components/studio/shell/new-run-setup";
import { StudioRunSkeleton } from "#/components/studio/shell/studio-run-skeleton";
import { StudioShell } from "#/components/studio/shell/studio-shell";
import {
	type StudioRunSearch,
	studioRunSearchSchema,
} from "#/lib/studio-run-search";

export const Route = createFileRoute("/studio")({
	validateSearch: studioRunSearchSchema,
	component: ModelStudioPage,
});

function clearRunSearch(prev: StudioRunSearch): StudioRunSearch {
	const { run: _run, plan: _plan, ...rest } = prev;
	return rest;
}

function ModelStudioPage() {
	const navigate = useNavigate({ from: Route.fullPath });
	const { run: runSearch } = Route.useSearch();
	const selectedRunId =
		(runSearch as Id<"modelStudioRuns"> | undefined) ?? null;

	const setSelectedRunId = (
		id: Id<"modelStudioRuns"> | null,
		replace = false,
	) => {
		void navigate({
			search: (prev) => (id ? { ...prev, run: id } : clearRunSearch(prev)),
			replace,
		});
	};

	const run = useQuery(
		api.studio.queries.getModelStudioRun,
		selectedRunId ? { runId: selectedRunId } : "skip",
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: only re-check existence when the selected run or its load state changes.
	useEffect(() => {
		if (!selectedRunId) {
			return;
		}
		if (run === null) {
			setSelectedRunId(null, true);
		}
	}, [selectedRunId, run === null, run]);

	return (
		<StudioShell
			activePath="/studio"
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
					<NewRunSetup
						onCreated={(id) => setSelectedRunId(id as Id<"modelStudioRuns">)}
					/>
				</div>
			) : run === undefined ? (
				<StudioRunSkeleton />
			) : (
				<div className="rounded-2xl border border-border/80 bg-card p-4 sm:p-6">
					<ModelStudio
						runId={selectedRunId}
						onRunIdChange={(id) => setSelectedRunId(id)}
					/>
				</div>
			)}
		</StudioShell>
	);
}
