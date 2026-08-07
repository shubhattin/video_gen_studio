import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ModelCard } from "#/components/studio/model-card";
import {
	VideoConfiguration,
	type VideoConfigState,
} from "#/components/studio/video-configuration";
import { GenerationStatus } from "#/components/studio/generation-status";
import { VideoResult } from "#/components/studio/video-result";
import { ReferenceImagePanel } from "#/components/studio/reference-image-panel";
import { Button } from "#/components/ui/button";
import {
	MODEL_CAPABILITY_PROFILES,
	VIDEO_MODEL_IDS,
	defaultVideoParams,
	isVideoModelId,
	type VideoModelId,
} from "#/lib/model-catalog";

export function ModelStudio() {
	const catalog = useQuery(api.studio.getCachedOpenRouterCatalog);
	const refreshCatalog = useAction(api.studioActions.refreshModelCatalog);
	const createDraft = useMutation(api.studio.createModelStudioDraft);
	const updateDraft = useMutation(api.studio.updateDraft);
	const removeReferenceImage = useMutation(api.studio.removeReferenceImage);
	const generateImage = useAction(api.studioActions.generateReferenceImage);
	const generateVideo = useAction(api.studioActions.generateVideoForRun);

	const [activeRunId, setActiveRunId] = useState<Id<"generationRuns"> | null>(
		null,
	);
	const [selectedModel, setSelectedModel] = useState<VideoModelId>(
		"google/veo-3.1-lite",
	);
	const [videoConfig, setVideoConfig] = useState<VideoConfigState>(() => ({
		...defaultVideoParams("google/veo-3.1-lite"),
		prompt: "",
	}));
	const [imageSize, setImageSize] = useState("1024x1536");
	const [imageQuality, setImageQuality] = useState("low");
	const [busy, setBusy] = useState(false);
	const [refreshingCatalog, setRefreshingCatalog] = useState(false);

	const run = useQuery(
		api.studio.getRun,
		activeRunId ? { runId: activeRunId } : "skip",
	);
	const profile = MODEL_CAPABILITY_PROFILES[selectedModel];

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
				pricing_skus?: Record<string, string>;
			}>) {
				map.set(model.id, {
					output: model.pricing_skus
						? Object.values(model.pricing_skus)[0]
						: undefined,
				});
			}
		}
		return map;
	}, [catalog]);

	const ensureDraft = async () => {
		if (activeRunId) {
			await updateDraft({
				runId: activeRunId,
				videoParams: { ...videoConfig, modelId: selectedModel },
				videoPrompt: videoConfig.prompt,
				selectedModelId: selectedModel,
				imageSize,
				imageQuality,
			});
			return activeRunId;
		}
		const runId = await createDraft({
			modelId: selectedModel,
			prompt: videoConfig.prompt,
		});
		setActiveRunId(runId);
		await updateDraft({
			runId,
			videoParams: { ...videoConfig, modelId: selectedModel },
			videoPrompt: videoConfig.prompt,
			imageSize,
			imageQuality,
		});
		return runId;
	};

	const startVideo = async () => {
		setBusy(true);
		try {
			const runId = await ensureDraft();
			await generateVideo({ runId });
		} finally {
			setBusy(false);
		}
	};

	const onGenerateImage = async () => {
		setBusy(true);
		try {
			const runId = await ensureDraft();
			await generateImage({ runId });
		} finally {
			setBusy(false);
		}
	};

	const images = run?.referenceImages ?? [];
	const videos = run?.videos ?? [];
	const extraIds = run?.extraReferenceImageIds ?? [];

	return (
		<div className="space-y-8">
			<section className="space-y-2">
				<h1 className="font-heading text-2xl font-semibold">Model Studio</h1>
				<p className="text-sm text-muted-foreground">
					OpenRouter video models with capability-driven controls. Each generate
					appends another clip to the run.
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
					{refreshingCatalog
						? "Refreshing catalog…"
						: "Refresh OpenRouter catalog"}
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

			<ReferenceImagePanel
				imageSize={imageSize}
				imageQuality={imageQuality}
				onSizeChange={setImageSize}
				onQualityChange={setImageQuality}
				onGenerate={onGenerateImage}
				generating={busy}
				images={images}
				firstFrameImageId={run?.firstFrameImageId}
				lastFrameImageId={run?.lastFrameImageId}
				extraReferenceImageIds={extraIds}
				supportsLastFrame={profile.supportsLastFrame}
				supportsInputReferences={profile.supportsInputReferences}
				maxInputReferences={profile.maxInputReferences}
				disabled={busy}
				onSelectFirstFrame={async (id) => {
					const runId = await ensureDraft();
					await updateDraft({ runId, firstFrameImageId: id });
				}}
				onSelectLastFrame={async (id) => {
					const runId = await ensureDraft();
					await updateDraft({ runId, lastFrameImageId: id });
				}}
				onToggleExtraReference={async (id) => {
					const runId = await ensureDraft();
					const next = extraIds.includes(id)
						? extraIds.filter((item) => item !== id)
						: [...extraIds, id];
					await updateDraft({ runId, extraReferenceImageIds: next });
				}}
				onRemoveImage={async (id) => {
					if (!activeRunId) return;
					await removeReferenceImage({ runId: activeRunId, imageId: id });
				}}
			/>

			<div className="flex flex-wrap gap-3">
				<Button className="min-h-11" disabled={busy} onClick={startVideo}>
					{busy ? "Working…" : "Generate video (append)"}
				</Button>
			</div>

			{run ? (
				<>
					<GenerationStatus
						status={run.status}
						lastError={run.lastError}
						warnings={run.warnings}
					/>
					<VideoResult videos={videos} />
				</>
			) : null}
		</div>
	);
}
