import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ModelStudio } from "#/components/studio/model/model-studio";
import { HistoryPanel } from "#/components/studio/shell/history-panel";
import { NewRunSetup } from "#/components/studio/shell/new-run-setup";
import { StudioShell } from "#/components/studio/shell/studio-shell";
import { StudioRunSkeleton } from "#/components/studio/shell/studio-run-skeleton";
import {
	studioRunSearchSchema,
	type StudioRunSearch,
} from "#/lib/studio-run-search";

export const Route = createFileRoute("/studio")({
	validateSearch: studioRunSearchSchema,
	component: ModelStudioPage,
});

function clearRunSearch(prev: StudioRunSearch): StudioRunSearch {
	const { run: _removed, ...rest } = prev;
	return rest;
}

function ModelStudioPage() {
	const navigate = useNavigate({ from: Route.fullPath });
	const { run: runSearch } = Route.useSearch();
	const selectedRunId = (runSearch as Id<"generationRuns"> | undefined) ?? null;

	const setSelectedRunId = (
		id: Id<"generationRuns"> | null,
		replace = false,
	) => {
		void navigate({
			search: (prev) => (id ? { ...prev, run: id } : clearRunSearch(prev)),
			replace,
		});
	};

	const run = useQuery(
		api.studio.queries.getRun,
		selectedRunId ? { runId: selectedRunId } : "skip",
	);

	useEffect(() => {
		if (!selectedRunId) {
			return;
		}
		if (run === null) {
			setSelectedRunId(null, true);
			return;
		}
		if (!run) {
			return;
		}
		if (run.provenance === "shloka") {
			void navigate({
				to: "/",
				search: { run: selectedRunId },
				replace: true,
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedRunId, run?._id, run === null]);

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
						provenance="model-studio"
						onCreated={(id) => setSelectedRunId(id)}
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
