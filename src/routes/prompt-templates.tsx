import {
	createFileRoute,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { HistoryPanel } from "#/components/studio/shell/history-panel";
import { StudioShell } from "#/components/studio/shell/studio-shell";
import { z } from "zod";
import { SystemPromptsPage } from "#/components/studio/system-prompts/system-prompts-page";

const promptTemplatesSearchSchema = z.object({
	kind: z.enum(["video", "audio"]).optional().catch(undefined),
});

export const Route = createFileRoute("/prompt-templates")({
	validateSearch: promptTemplatesSearchSchema,
	component: SystemPromptsRoute,
});

function SystemPromptsRoute() {
	const navigate = useNavigate();
	const { hash } = useLocation();
	const { kind = "video" } = Route.useSearch();
	const focusKey = hash ? hash.replace(/^#/, "") : null;

	return (
		<StudioShell activePath="/prompt-templates" history={<HistoryPanel />}>
			<div className="rounded-2xl border border-border/80 bg-card p-4 sm:p-6">
				<SystemPromptsPage
					kind={kind}
					onKindChange={(next) => {
						void navigate({
							to: "/prompt-templates",
							search: { kind: next },
							hash,
							replace: true,
						});
					}}
					focusKey={focusKey}
					onFocusHandled={() => {
						// Clear the hash so a repeated visit to the same template still
						// re-expands and re-scrolls.
						void navigate({
							to: "/prompt-templates",
							search: { kind },
							replace: true,
						});
					}}
				/>
			</div>
		</StudioShell>
	);
}
