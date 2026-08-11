import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { GenerationStatus } from "#/components/studio/generation-status";
import { ReferenceImagePanel } from "#/components/studio/reference-image-panel";
import { StudioErrorAlert } from "#/components/studio/studio-error-alert";
import { VideoModelSelector } from "#/components/studio/video-model-selector";
import {
	VideoConfiguration,
	type VideoConfigState,
} from "#/components/studio/video-configuration";
import { VideoResult } from "#/components/studio/video-result";
import { Button } from "#/components/ui/button";
import {
	MODEL_CAPABILITY_PROFILES,
	defaultVideoParams,
	isVideoModelId,
	type VideoModelId,
} from "#/lib/model-catalog";
import { notifyStudioError, notifyStudioSuccess } from "#/lib/studio-toast";
import { uploadReferenceImage } from "#/lib/upload-reference-image";

type ModelStudioProps = {
	runId?: Id<"generationRuns"> | null;
	onRunIdChange?: (runId: Id<"generationRuns"> | null) => void;
};

export function ModelStudio({
	runId: controlledRunId = null,
	onRunIdChange,
}: ModelStudioProps) {
	const catalog = useQuery(api.studio.getCachedOpenRouterCatalog);
	const refreshCatalog = useAction(api.studioActions.refreshModelCatalog);
	const createDraft = useMutation(api.studio.createModelStudioDraft);
	const updateDraft = useMutation(api.studio.updateDraft);
	const removeReferenceImage = useMutation(api.studio.removeReferenceImage);
	const generateUploadUrl = useMutation(api.studio.generateUploadUrl);
	const attachUploadedReferenceImage = useMutation(
		api.studio.attachUploadedReferenceImage,
	);
	const generateImage = useAction(api.studioActions.generateReferenceImage);
	const generateVideo = useAction(api.studioActions.generateVideoForRun);

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
	const [uploading, setUploading] = useState(false);
	const [refreshingCatalog, setRefreshingCatalog] = useState(false);

	const activeRunId = controlledRunId;
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

	useEffect(() => {
		if (!controlledRunId) {
			setSelectedModel("google/veo-3.1-lite");
			setVideoConfig({
				...defaultVideoParams("google/veo-3.1-lite"),
				prompt: "",
			});
			setImageSize("1024x1536");
			setImageQuality("low");
			return;
		}
		if (!run || run._id !== controlledRunId) {
			return;
		}
		const modelId = isVideoModelId(run.selectedModelId ?? "")
			? (run.selectedModelId as VideoModelId)
			: "google/veo-3.1-lite";
		setSelectedModel(modelId);
		setImageSize(run.imageSize ?? "1024x1536");
		setImageQuality(run.imageQuality ?? "low");
		setVideoConfig({
			...defaultVideoParams(modelId),
			...(run.videoParams ?? {}),
			modelId,
			prompt: run.videoPrompt ?? run.videoParams?.prompt ?? "",
		});
	}, [controlledRunId, run?._id]);

	const { gatewayById, pricingSkusById } = useMemo(() => {
		const gateway = new Map<string, { input?: string; output?: string }>();
		const skus = new Map<string, Record<string, string>>();
		if (catalog?.models) {
			for (const model of catalog.models as Array<{
				id: string;
				pricing_skus?: Record<string, string>;
			}>) {
				if (model.pricing_skus) {
					skus.set(model.id, model.pricing_skus);
					gateway.set(model.id, {
						output: Object.values(model.pricing_skus)[0],
					});
				}
			}
		}
		return { gatewayById: gateway, pricingSkusById: skus };
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
		onRunIdChange?.(runId);
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
			notifyStudioSuccess("Video appended", "Clip saved to this run.");
		} catch (error) {
			notifyStudioError("Video generation failed", error);
		} finally {
			setBusy(false);
		}
	};

	const onGenerateImage = async () => {
		setBusy(true);
		try {
			const runId = await ensureDraft();
			await generateImage({ runId });
			notifyStudioSuccess("Reference image ready");
		} catch (error) {
			notifyStudioError("Image generation failed", error);
		} finally {
			setBusy(false);
		}
	};

	const onUploadImage = async (file: File) => {
		setUploading(true);
		try {
			const runId = await ensureDraft();
			await uploadReferenceImage({
				runId,
				file,
				generateUploadUrl,
				attachUploadedReferenceImage,
			});
			notifyStudioSuccess("Reference image uploaded");
		} catch (error) {
			notifyStudioError("Image upload failed", error);
		} finally {
			setUploading(false);
		}
	};

	const images = run?.referenceImages ?? [];
	const videos = run?.videos ?? [];
	const extraIds = run?.extraReferenceImageIds ?? [];

	return (
		<div className="flex flex-col gap-8">
			<section className="flex flex-col gap-3">
				<div className="flex flex-col gap-2">
					<h1 className="font-heading text-2xl font-semibold">Model Studio</h1>
					<p className="text-sm text-muted-foreground">
						OpenRouter video models with capability-driven controls. Each
						generate appends another clip to the run.
					</p>
				</div>
				<div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
					<div className="min-w-0 flex-1 sm:max-w-xl">
						<p className="mb-2 text-sm font-medium">Video model</p>
						<VideoModelSelector
							value={selectedModel}
							gatewayPricingById={gatewayById}
							pricingSkusById={pricingSkusById}
							disabled={busy || uploading}
							onValueChange={(modelId) => {
								setSelectedModel(modelId);
								setVideoConfig({
									...defaultVideoParams(modelId),
									prompt: videoConfig.prompt,
								});
							}}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<Button
							variant="outline"
							size="sm"
							className="min-h-11 w-fit"
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
					</div>
				</div>
			</section>

			<StudioErrorAlert
				error={run?.lastError}
				title="Error (video prompt / generate)"
			/>
			<VideoConfiguration
				value={{ ...videoConfig, modelId: selectedModel }}
				onChange={(next) => {
					if (isVideoModelId(next.modelId)) {
						setSelectedModel(next.modelId);
					}
					setVideoConfig(next);
				}}
				showPrompt
				disabled={busy || uploading}
			/>

			<StudioErrorAlert
				error={run?.lastError}
				title="Error (reference image)"
			/>
			<ReferenceImagePanel
				imageSize={imageSize}
				imageQuality={imageQuality}
				onSizeChange={setImageSize}
				onQualityChange={setImageQuality}
				onGenerate={onGenerateImage}
				onUpload={onUploadImage}
				generating={busy}
				uploading={uploading}
				images={images}
				firstFrameImageId={run?.firstFrameImageId}
				lastFrameImageId={run?.lastFrameImageId}
				extraReferenceImageIds={extraIds}
				supportsLastFrame={profile.supportsLastFrame}
				supportsInputReferences={profile.supportsInputReferences}
				maxInputReferences={profile.maxInputReferences}
				disabled={busy || uploading}
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
				<Button
					className="min-h-11"
					disabled={busy || uploading}
					onClick={startVideo}
				>
					{busy ? "Working…" : "Generate video (append)"}
				</Button>
			</div>

			{run ? (
				<>
					<GenerationStatus status={run.status} warnings={run.warnings} />
					<VideoResult videos={videos} />
				</>
			) : null}
		</div>
	);
}
