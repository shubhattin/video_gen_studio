import {
	createFileRoute,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { HistoryPanel } from "#/components/studio/shell/history-panel";
import { StudioShell } from "#/components/studio/shell/studio-shell";
import { SystemPromptsPage } from "#/components/studio/system-prompts/system-prompts-page";

export const Route = createFileRoute("/system-prompts")({
	component: SystemPromptsRoute,
});

function SystemPromptsRoute() {
	const navigate = useNavigate();
	const { hash } = useLocation();
	const focusKey = hash ? hash.replace(/^#/, "") : null;

	return (
		<StudioShell activePath="/system-prompts" history={<HistoryPanel />}>
			<div className="rounded-2xl border border-border/80 bg-card p-5 sm:p-8">
				<SystemPromptsPage
					focusKey={focusKey}
					onFocusHandled={() => {
						// Clear the hash so a repeated visit to the same template still
						// re-expands and re-scrolls.
						void navigate({ to: "/system-prompts", replace: true });
					}}
				/>
			</div>
		</StudioShell>
	);
}
