import { createFileRoute } from "@tanstack/react-router";
import { ModelStudio } from "#/components/studio/model-studio";
import { HistoryPanel } from "#/components/studio/history-panel";
import { StudioShell } from "#/components/studio/studio-shell";

export const Route = createFileRoute("/studio")({
	component: ModelStudioPage,
});

function ModelStudioPage() {
	return (
		<StudioShell activePath="/studio" sidebar={<HistoryPanel onSelect={() => undefined} />}>
			<div className="rounded-2xl border border-border/80 bg-card p-5 sm:p-8">
				<ModelStudio />
			</div>
		</StudioShell>
	);
}
