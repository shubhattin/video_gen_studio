import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ModelCard } from "#/components/studio/model-card";
import { VideoConfiguration, type VideoConfigState } from "#/components/studio/video-configuration";
import { GenerationStatus } from "#/components/studio/generation-status";
import { VideoResult } from "#/components/studio/video-result";
import { Button } from "#/components/ui/button";
import {
	VIDEO_MODEL_IDS,
	defaultVideoParams,
	isVideoModelId,
	type VideoModelId,
} from "#/lib/model-catalog";

export function ModelStudio() {
	const catalog = useQuery(api.studio.getCachedGatewayCatalog);
	const refreshCatalog = useAction(api.studioActions.refreshModelCatalog);
	const createDraft = useMutation(api.studio.createModelStudioDraft);
	const updateDraft = useMutation(api.studio.updateDraft);
	const generateVideo = useAction(api.studioActions.generateVideoForRun);

	const [activeRunId, setActiveRunId] = useState<Id<"generationRuns"> | null>(
		null,
	);
	const [selectedModel, setSelectedModel] = useState<VideoModelId>(
		"google/veo-3.1-generate-001",
	);
	const [videoConfig, setVideoConfig] = useState<VideoConfigState>(() => ({
		...defaultVideoParams("google/veo-3.1-generate-001"),
		prompt: "",
	}));
	const [busy, setBusy] = useState(false);
	const [refreshingCatalog, setRefreshingCatalog] = useState(false);

	const run = useQuery(
		api.studio.getRun,
		activeRunId ? { runId: activeRunId } : "skip",
	);

	useEffect(() => {
		if (!catalog) {
			refreshCatalog({}).catch(() => undefined);
		}
	}, [catalog, refreshCatalog]);

	const gatewayById = useMemo(() => {
		const map = new Map<string, { input?: string; output?: string }>();
		if (catalog?.models) {
			for (const model of catalog.models as Array<{
				id: string;
				pricing?: { input?: string; output?: string };
			}>) {
				map.set(model.id, model.pricing ?? {});
			}
		}
		return map;
	}, [catalog]);

	const startRun = async () => {
		setBusy(true);
		try {
			const runId = await createDraft({
				modelId: selectedModel,
				prompt: videoConfig.prompt,
			});
			setActiveRunId(runId);
			await updateDraft({
				runId,
				videoParams: videoConfig,
				videoPrompt: videoConfig.prompt,
			});
			await generateVideo({ runId });
		} finally {
			setBusy(false);
		}
	};

	const generateForActiveRun = async () => {
		if (!activeRunId) {
			return;
		}
		setBusy(true);
		try {
			await updateDraft({
				runId: activeRunId,
				videoParams: videoConfig,
				videoPrompt: videoConfig.prompt,
				selectedModelId: selectedModel,
			});
			await generateVideo({ runId: activeRunId, force: true });
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-8">
			<section className="space-y-2">
				<h1 className="font-heading text-2xl font-semibold">Model Studio</h1>
				<p className="text-sm text-muted-foreground">
					Direct access to each Gateway video model with capability-driven controls
					and live pricing estimates.
				</p>
				<Button
					variant="outline"
					size="sm"
					className="min-h-11"
					disabled={refreshingCatalog}
					onClick={async () => {
						setRefreshingCatalog(true);
						try {
							await refreshCatalog({});
						} finally {
							setRefreshingCatalog(false);
						}
					}}
				>
					{refreshingCatalog ? "Refreshing catalog…" : "Refresh Gateway catalog"}
				</Button>
				{catalog?.fetchedAt ? (
					<p className="text-xs text-muted-foreground">
						Catalog updated {new Date(catalog.fetchedAt).toLocaleString()}
					</p>
				) : null}
			</section>

			<div className="grid gap-4 lg:grid-cols-3">
				{VIDEO_MODEL_IDS.map((modelId) => (
					<ModelCard
						key={modelId}
						modelId={modelId}
						selected={selectedModel === modelId}
						gatewayPricing={gatewayById.get(modelId)}
						onSelect={() => {
							setSelectedModel(modelId);
							setVideoConfig({
								...defaultVideoParams(modelId),
								prompt: videoConfig.prompt,
							});
						}}
					/>
				))}
			</div>

			<VideoConfiguration
				value={{ ...videoConfig, modelId: selectedModel }}
				onChange={(next) => {
					if (isVideoModelId(next.modelId)) {
						setSelectedModel(next.modelId);
					}
					setVideoConfig(next);
				}}
				showPrompt
				disabled={busy}
			/>

			<div className="flex flex-wrap gap-3">
				<Button className="min-h-11" disabled={busy} onClick={startRun}>
					{busy ? "Generating…" : "Generate video"}
				</Button>
				{activeRunId ? (
					<Button
						variant="outline"
						className="min-h-11"
						disabled={busy}
						onClick={generateForActiveRun}
					>
						Retry / regenerate
					</Button>
				) : null}
			</div>

			{run ? (
				<>
					<GenerationStatus
						status={run.status}
						lastError={run.lastError}
						warnings={run.warnings}
					/>
					<VideoResult
						videoUrl={run.videoUrl}
						mimeType={run.videoMeta?.mimeType}
						durationSeconds={run.videoMeta?.durationSeconds}
						gatewayGenerationId={run.gatewayGenerationId}
						actualCostUsd={run.actualCostUsd}
						warnings={run.warnings}
					/>
				</>
			) : null}
		</div>
	);
}
