import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import {
	type CompositionClipResult,
	CompositionResult,
} from "#/components/studio/composition-result";
import { GenerationProgressDock } from "#/components/studio/generation-progress-dock";
import {
	type CompositionSettings,
	MultiClipCompositionControls,
} from "#/components/studio/multi-clip-composition-controls";
import { ReferenceImagePanel } from "#/components/studio/reference-image-panel";
import {
	type VideoConfigState,
	VideoConfiguration,
} from "#/components/studio/video-configuration";
import { VideoModelSelector } from "#/components/studio/video-model-selector";
import { VideoResult } from "#/components/studio/video-result";
import { Button } from "#/components/ui/button";
import { useCompositionTerminalFrameHandoff } from "#/hooks/use-composition-terminal-frame-handoff";
import {
	useSignedMediaUrls,
	withSignedUrl,
} from "#/hooks/use-signed-media-urls";
import {
	defaultVideoParams,
	isVideoModelId,
	MODEL_CAPABILITY_PROFILES,
	type VideoModelId,
} from "#/lib/model-catalog";
import type { StudioBusyStage } from "#/lib/studio-run-status";
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
	const prepareReferenceImageUpload = useAction(
		api.studioR2.prepareReferenceImageUpload,
	);
	const finalizeReferenceImageUpload = useAction(
		api.studioR2.finalizeReferenceImageUpload,
	);
	const generateImage = useAction(api.studioActions.generateReferenceImage);
	const generateVideo = useAction(api.studioActions.generateVideoForRun);
	const planComposition = useAction(
		api.studioActions.planModelStudioComposition,
	);
	const startComposition = useMutation(api.studio.startComposition);
	const cancelComposition = useMutation(api.studio.cancelComposition);
	const selectCompositionJob = useMutation(api.studio.selectCompositionJob);

	const [selectedModel, setSelectedModel] = useState<VideoModelId>(
		"bytedance/seedance-2.0-fast",
	);
	const [videoConfig, setVideoConfig] = useState<VideoConfigState>(() => ({
		...defaultVideoParams("bytedance/seedance-2.0-fast"),
		prompt: "",
	}));
	const [imageSize, setImageSize] = useState("1024x1536");
	const [imageQuality, setImageQuality] = useState("medium");
	const [busyStage, setBusyStage] = useState<StudioBusyStage>(null);
	const [refreshingCatalog, setRefreshingCatalog] = useState(false);
	const [composition, setComposition] = useState<CompositionSettings>({
		enabled: false,
		mode: "continuation",
		multiplier: 2,
	});

	const activeRunId = controlledRunId;
	const run = useQuery(
		api.studio.getRun,
		activeRunId ? { runId: activeRunId } : "skip",
	);
	const compositionJob = useQuery(
		api.studio.getCompositionForRun,
		activeRunId ? { runId: activeRunId } : "skip",
	);
	const compositionAttempts = useQuery(
		api.studio.listCompositionJobsForRun,
		activeRunId ? { runId: activeRunId } : "skip",
	);
	const profile = MODEL_CAPABILITY_PROFILES[selectedModel];

	const rawImages = run?.referenceImages ?? [];
	const rawVideos = run?.videos ?? [];
	const mediaObjectKeys = [
		...rawImages.map((image) => image.objectKey),
		...rawVideos.map((video) => video.objectKey),
		...(compositionJob?.clips ?? []).flatMap((clip) => [
			clip.video?.objectKey,
			clip.terminalFrameObjectKey,
		]),
	];
	const urlsByKey = useSignedMediaUrls(activeRunId, mediaObjectKeys);
	const images = rawImages.map((image) => withSignedUrl(image, urlsByKey));
	const videos = rawVideos.map((video) => withSignedUrl(video, urlsByKey));
	const compositionJobWithUrls = compositionJob
		? {
				...compositionJob,
				clips: (compositionJob.clips ?? []).map((clip) => ({
					...clip,
					video: clip.video ? withSignedUrl(clip.video, urlsByKey) : undefined,
				})),
			}
		: compositionJob;

	useCompositionTerminalFrameHandoff({
		runId: activeRunId,
		compositionJob: compositionJobWithUrls,
		onError: (error) =>
			notifyStudioError("Continuity frame capture failed", error),
	});

	useEffect(() => {
		if (!catalog) {
			refreshCatalog({}).catch(() => undefined);
		}
	}, [catalog, refreshCatalog]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Hydrate the local draft only when the selected run changes.
	useEffect(() => {
		if (!controlledRunId) {
			setSelectedModel("bytedance/seedance-2.0-fast");
			setVideoConfig({
				...defaultVideoParams("bytedance/seedance-2.0-fast"),
				prompt: "",
			});
			setImageSize("1024x1536");
			setImageQuality("medium");
			setComposition({
				enabled: false,
				mode: "continuation",
				multiplier: 2,
			});
			return;
		}
		if (!run || run._id !== controlledRunId) {
			return;
		}
		const modelId = isVideoModelId(run.selectedModelId ?? "")
			? (run.selectedModelId as VideoModelId)
			: "bytedance/seedance-2.0-fast";
		setSelectedModel(modelId);
		setImageSize(run.imageSize ?? "1024x1536");
		setImageQuality(run.imageQuality ?? "medium");
		setVideoConfig({
			...defaultVideoParams(modelId),
			...(run.videoParams ?? {}),
			modelId,
			prompt: run.videoPrompt ?? run.videoParams?.prompt ?? "",
		});
		setComposition({
			enabled: Boolean(run.compositionMode),
			mode: run.compositionMode ?? "continuation",
			multiplier: run.compositionMultiplier ?? 2,
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
				compositionMode: composition.enabled ? composition.mode : null,
				compositionMultiplier: composition.enabled
					? composition.multiplier
					: null,
				compositionClipCount: composition.enabled
					? composition.multiplier
					: null,
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
			compositionMode: composition.enabled ? composition.mode : null,
			compositionMultiplier: composition.enabled
				? composition.multiplier
				: null,
			compositionClipCount: composition.enabled ? composition.multiplier : null,
		});
		return runId;
	};

	const startVideo = async () => {
		setBusyStage("video");
		try {
			const runId = await ensureDraft();
			await generateVideo({ runId });
			notifyStudioSuccess("Video appended", "Clip saved to this run.");
		} catch (error) {
			notifyStudioError("Video generation failed", error);
		} finally {
			setBusyStage(null);
		}
	};

	const onPlanComposition = async () => {
		setBusyStage("planning");
		try {
			const runId = await ensureDraft();
			await planComposition({ runId, force: true });
			notifyStudioSuccess("Composition plan ready");
		} catch (error) {
			notifyStudioError("Composition planning failed", error);
		} finally {
			setBusyStage(null);
		}
	};

	const onStartComposition = async () => {
		setBusyStage("video");
		try {
			const runId = await ensureDraft();
			await startComposition({ runId });
			notifyStudioSuccess(
				"Composition started",
				"Clips will generate sequentially and can be resumed if one fails.",
			);
		} catch (error) {
			notifyStudioError("Composition could not start", error);
		} finally {
			setBusyStage(null);
		}
	};

	const onGenerateImage = async () => {
		setBusyStage("image");
		try {
			const runId = await ensureDraft();
			await generateImage({ runId });
			notifyStudioSuccess("Reference image ready");
		} catch (error) {
			notifyStudioError("Image generation failed", error);
		} finally {
			setBusyStage(null);
		}
	};

	const onUploadImage = async (file: File) => {
		setBusyStage("upload");
		try {
			const runId = await ensureDraft();
			await uploadReferenceImage({
				runId,
				file,
				prepareUpload: prepareReferenceImageUpload,
				finalizeUpload: finalizeReferenceImageUpload,
			});
			notifyStudioSuccess("Reference image uploaded");
		} catch (error) {
			notifyStudioError("Image upload failed", error);
		} finally {
			setBusyStage(null);
		}
	};

	const extraIds = run?.extraReferenceImageIds ?? [];
	const isBusy = busyStage !== null;
	const isModelLocked =
		Boolean(run?.videos?.length) ||
		run?.status === "video_generating" ||
		compositionJob?.status === "generating" ||
		compositionJob?.status === "awaiting_terminal_frame";

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
							disabled={isBusy || isModelLocked}
							onValueChange={(modelId) => {
								setSelectedModel(modelId);
								setVideoConfig({
									...defaultVideoParams(modelId),
									prompt: videoConfig.prompt,
								});
							}}
						/>
						{isModelLocked ? (
							<p className="mt-2 text-xs text-muted-foreground">
								{run?.videos?.length
									? "The video model is fixed after single-clip generation begins for this run."
									: "Model is locked while this composition attempt is generating."}
							</p>
						) : null}
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

			<VideoConfiguration
				value={{ ...videoConfig, modelId: selectedModel }}
				onChange={(next) => {
					if (isVideoModelId(next.modelId)) {
						setSelectedModel(next.modelId);
					}
					setVideoConfig(next);
				}}
				showPrompt
				disabled={isBusy}
			/>

			<MultiClipCompositionControls
				value={composition}
				modelId={selectedModel}
				durationSeconds={videoConfig.durationSeconds}
				onChange={setComposition}
				disabled={
					isBusy ||
					compositionJob?.status === "generating" ||
					compositionJob?.status === "awaiting_terminal_frame"
				}
			/>

			<ReferenceImagePanel
				imageSize={imageSize}
				imageQuality={imageQuality}
				onSizeChange={setImageSize}
				onQualityChange={setImageQuality}
				onGenerate={onGenerateImage}
				onUpload={onUploadImage}
				generating={busyStage === "image"}
				uploading={busyStage === "upload"}
				images={images}
				firstFrameImageId={run?.firstFrameImageId}
				lastFrameImageId={run?.lastFrameImageId}
				extraReferenceImageIds={extraIds}
				supportsLastFrame={profile.supportsLastFrame}
				supportsInputReferences={profile.supportsInputReferences}
				maxInputReferences={profile.maxInputReferences}
				disabled={isBusy}
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
				{composition.enabled ? (
					<>
						<Button
							className="min-h-11"
							disabled={isBusy || !videoConfig.prompt?.trim()}
							onClick={onPlanComposition}
						>
							{busyStage === "planning"
								? "Planning composition…"
								: (compositionAttempts?.length ?? 0) > 0
									? "Plan another attempt"
									: "Generate composition plan"}
						</Button>
						{compositionJob?.status === "planned" ||
						compositionJob?.status === "failed" ? (
							<Button
								className="min-h-11"
								disabled={isBusy}
								onClick={onStartComposition}
							>
								{busyStage === "video"
									? "Starting composition…"
									: `Generate ${composition.multiplier} clips`}
							</Button>
						) : null}
						{compositionJob?.status === "generating" ||
						compositionJob?.status === "awaiting_terminal_frame" ? (
							<Button
								className="min-h-11"
								variant="outline"
								disabled={isBusy}
								onClick={() =>
									activeRunId && cancelComposition({ runId: activeRunId })
								}
							>
								Cancel composition
							</Button>
						) : null}
					</>
				) : (
					<Button className="min-h-11" disabled={isBusy} onClick={startVideo}>
						{busyStage === "video"
							? "Generating video…"
							: "Generate video (append)"}
					</Button>
				)}
			</div>

			{compositionJobWithUrls ? (
				<CompositionResult
					status={compositionJobWithUrls.status}
					clips={compositionJobWithUrls.clips as CompositionClipResult[]}
					totalDurationSeconds={compositionJobWithUrls.totalDurationSeconds}
					aspectRatio={compositionJobWithUrls.videoParams?.aspectRatio}
					mergeSources={(compositionJobWithUrls.clips ?? []).map(
						(clip: {
							video?: { url?: string | null; objectKey?: string | null };
						}) => ({
							url: clip.video?.url,
							objectKey: clip.video?.objectKey,
							runId: activeRunId,
						}),
					)}
					attempts={compositionAttempts ?? []}
					activeJobId={compositionJobWithUrls._id}
					activeConfig={{
						_id: compositionJobWithUrls._id,
						attemptNumber: compositionJobWithUrls.attemptNumber ?? 1,
						status: compositionJobWithUrls.status,
						mode: compositionJobWithUrls.mode,
						clipCount: compositionJobWithUrls.clipCount,
						videoParams: compositionJobWithUrls.videoParams,
						overallDescription: compositionJobWithUrls.overallDescription,
						plannerModel: compositionJobWithUrls.plannerModel,
						plannerReasoning: compositionJobWithUrls.plannerReasoning,
						estimatedCostUsd: compositionJobWithUrls.estimatedCostUsd,
						actualCostUsd: compositionJobWithUrls.actualCostUsd,
						createdAt: compositionJobWithUrls.createdAt,
					}}
					attemptControlsDisabled={
						isBusy ||
						compositionJobWithUrls.status === "generating" ||
						compositionJobWithUrls.status === "awaiting_terminal_frame"
					}
					onSelectAttempt={(jobId) => {
						if (!activeRunId) return;
						void selectCompositionJob({
							runId: activeRunId,
							jobId: jobId as Id<"compositionJobs">,
						}).catch((error) =>
							notifyStudioError("Could not switch composition attempt", error),
						);
					}}
				/>
			) : null}

			{run ? <VideoResult runId={activeRunId} videos={videos} /> : null}

			<GenerationProgressDock
				status={run?.status}
				busyStage={busyStage}
				warnings={run?.warnings}
				contextLabel={selectedModel}
			/>
		</div>
	);
}
