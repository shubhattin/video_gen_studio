import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { ModelStudio } from "#/components/studio/model-studio";
import { HistoryPanel } from "#/components/studio/history-panel";
import { StudioShell } from "#/components/studio/studio-shell";

export const Route = createFileRoute("/studio")({
	component: ModelStudioPage,
});

function ModelStudioPage() {
	const [selectedRunId, setSelectedRunId] =
		useState<Id<"generationRuns"> | null>(null);

	return (
		<StudioShell
			activePath="/studio"
			sidebar={
				<HistoryPanel
					selectedRunId={selectedRunId}
					onSelect={setSelectedRunId}
					onDeleted={(id) => {
						if (selectedRunId === id) {
							setSelectedRunId(null);
						}
					}}
				/>
			}
		>
			<div className="rounded-2xl border border-border/80 bg-card p-5 sm:p-8">
				<ModelStudio />
			</div>
		</StudioShell>
	);
}
