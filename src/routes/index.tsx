import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import {
	type CompositionClipResult,
	CompositionResult,
} from "#/components/studio/composition-result";
import { CompositionAttemptControls } from "#/components/studio/composition-attempt-controls";
import { GenerationProgressDock } from "#/components/studio/generation-progress-dock";
import { HistoryPanel } from "#/components/studio/history-panel";
import {
	type CompositionSettings,
	MultiClipCompositionControls,
} from "#/components/studio/multi-clip-composition-controls";
import { ReferenceImagePanel } from "#/components/studio/reference-image-panel";
import { ShlokaComposer } from "#/components/studio/shloka-composer";
import { ShlokaPlanPreview } from "#/components/studio/shloka-plan-preview";
import { StudioShell } from "#/components/studio/studio-shell";
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
	MODEL_CAPABILITY_PROFILES,
	type VideoModelId,
} from "#/lib/model-catalog";
import {
	DEFAULT_PLANNER_SYSTEM_PROMPT,
	normalizePlannerSystemPromptForStorage,
	resolvePlannerSystemPrompt,
} from "#/lib/planner-prompt";
import {
	type StudioRunSearch,
	studioRunSearchSchema,
} from "#/lib/studio-run-search";
import type { StudioBusyStage } from "#/lib/studio-run-status";
import { notifyStudioError, notifyStudioSuccess } from "#/lib/studio-toast";
import { uploadReferenceImage } from "#/lib/upload-reference-image";
import { StudioRunSkeleton } from "#/components/studio/studio-run-skeleton";

export const Route = createFileRoute("/")({
	validateSearch: studioRunSearchSchema,
	component: ShlokaStudioPage,
});

function clearRunSearch(prev: StudioRunSearch): StudioRunSearch {
	const { run: _removed, ...rest } = prev;
	return rest;
}

function ShlokaStudioPage() {
	const navigate = useNavigate({ from: Route.fullPath });
	const { run: runSearch } = Route.useSearch();
	const runId = (runSearch as Id<"generationRuns"> | undefined) ?? null;

	const setRunId = (id: Id<"generationRuns"> | null, replace = false) => {
		void navigate({
			search: (prev) => (id ? { ...prev, run: id } : clearRunSearch(prev)),
			replace,
		});
	};

	const [shlokaText, setShlokaText] = useState("");
	const [customInstructions, setCustomInstructions] = useState("");
	const [plannerSystemPrompt, setPlannerSystemPrompt] = useState(
		DEFAULT_PLANNER_SYSTEM_PROMPT,
	);
	const [imageSize, setImageSize] = useState("1024x1536");
	const [imageQuality, setImageQuality] = useState("medium");
	const [videoConfig, setVideoConfig] = useState<VideoConfigState>(
		defaultVideoParams("bytedance/seedance-2.0-fast"),
	);
	const [busyStage, setBusyStage] = useState<StudioBusyStage>(null);
	const [composition, setComposition] = useState<CompositionSettings>({
		enabled: false,
		mode: "continuation",
		multiplier: 2,
	});

	const run = useQuery(api.studio.getRun, runId ? { runId } : "skip");
	const compositionJob = useQuery(
		api.studio.getCompositionForRun,
		runId ? { runId } : "skip",
	);
	const compositionAttempts = useQuery(
		api.studio.listCompositionJobsForRun,
		runId ? { runId } : "skip",
	);
	const catalog = useQuery(api.studio.getCachedOpenRouterCatalog);
	const refreshCatalog = useAction(api.studioActions.refreshModelCatalog);

	const createDraft = useMutation(api.studio.createShlokaDraft);
	const updateDraft = useMutation(api.studio.updateDraft);
	const removeReferenceImage = useMutation(api.studio.removeReferenceImage);
	const prepareReferenceImageUpload = useAction(
		api.studioR2.prepareReferenceImageUpload,
	);
	const finalizeReferenceImageUpload = useAction(
		api.studioR2.finalizeReferenceImageUpload,
	);
	const planRun = useAction(api.studioActions.planShlokaRun);
	const generateImage = useAction(api.studioActions.generateReferenceImage);
	const generateVideo = useAction(api.studioActions.generateVideoForRun);
	const startComposition = useMutation(api.studio.startComposition);
	const cancelComposition = useMutation(api.studio.cancelComposition);
	const selectCompositionJob = useMutation(api.studio.selectCompositionJob);

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
	const urlsByKey = useSignedMediaUrls(runId, mediaObjectKeys);
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
		runId,
		compositionJob: compositionJobWithUrls,
		onError: (error) =>
			notifyStudioError("Continuity frame capture failed", error),
	});

	const compositionSwitchDisabled =
		busyStage !== null ||
		compositionJob?.status === "generating" ||
		compositionJob?.status === "awaiting_terminal_frame";

	const onSelectCompositionAttempt = (jobId: string) => {
		if (!runId) return;
		void selectCompositionJob({
			runId,
			jobId: jobId as Id<"compositionJobs">,
		}).catch((error) =>
			notifyStudioError("Could not switch composition plan", error),
		);
	};
	useEffect(() => {
		if (!catalog) {
			refreshCatalog({}).catch(() => undefined);
		}
	}, [catalog, refreshCatalog]);

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

	// biome-ignore lint/correctness/useExhaustiveDependencies: Hydrate the local draft only when the selected run changes.
	useEffect(() => {
		if (!runId) {
			setShlokaText("");
			setCustomInstructions("");
			setPlannerSystemPrompt(DEFAULT_PLANNER_SYSTEM_PROMPT);
			setImageSize("1024x1536");
			setImageQuality("medium");
			setVideoConfig(defaultVideoParams("bytedance/seedance-2.0-fast"));
			setComposition({
				enabled: false,
				mode: "continuation",
				multiplier: 2,
			});
			setBusyStage(null);
			return;
		}
		if (run === null) {
			setRunId(null, true);
			return;
		}
		if (!run) {
			return;
		}
		if (run.provenance === "model-studio") {
			void navigate({
				to: "/studio",
				search: { run: runId },
				replace: true,
			});
			return;
		}
		setShlokaText(run.shlokaText ?? "");
		setCustomInstructions(run.customInstructions ?? "");
		setPlannerSystemPrompt(resolvePlannerSystemPrompt(run.plannerSystemPrompt));
		setImageSize(run.imageSize ?? "1024x1536");
		setImageQuality(run.imageQuality ?? "medium");
		if (run.videoParams) {
			setVideoConfig({
				modelId:
					(run.selectedModelId as VideoModelId) ??
					"bytedance/seedance-2.0-fast",
				aspectRatio: run.videoParams.aspectRatio,
				resolution: run.videoParams.resolution,
				durationSeconds: run.videoParams.durationSeconds,
				generateAudio: run.videoParams.generateAudio,
				negativePrompt: run.videoParams.negativePrompt,
				cfgScale: run.videoParams.cfgScale,
			});
		}
		setComposition({
			enabled: Boolean(run.compositionMode),
			mode: run.compositionMode ?? "continuation",
			multiplier: run.compositionMultiplier ?? 2,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [runId, run?._id, run === null]);

	const ensureRun = async () => {
		const storedPlannerSystemPrompt =
			normalizePlannerSystemPromptForStorage(plannerSystemPrompt) ?? null;
		if (runId) {
			await updateDraft({
				runId,
				customInstructions,
				plannerSystemPrompt: storedPlannerSystemPrompt,
				imageSize,
				imageQuality,
				selectedModelId: videoConfig.modelId,
				videoParams: videoConfig,
				compositionMode: composition.enabled ? composition.mode : null,
				compositionMultiplier: composition.enabled
					? composition.multiplier
					: null,
				compositionClipCount: composition.enabled
					? composition.multiplier
					: null,
			});
			return runId;
		}
		const id = await createDraft({
			shlokaText,
			customInstructions,
			...(storedPlannerSystemPrompt
				? { plannerSystemPrompt: storedPlannerSystemPrompt }
				: {}),
		});
		setRunId(id);
		await updateDraft({
			runId: id,
			plannerSystemPrompt: storedPlannerSystemPrompt,
			imageSize,
			imageQuality,
			selectedModelId: videoConfig.modelId,
			videoParams: videoConfig,
			compositionMode: composition.enabled ? composition.mode : null,
			compositionMultiplier: composition.enabled
				? composition.multiplier
				: null,
			compositionClipCount: composition.enabled ? composition.multiplier : null,
		});
		return id;
	};

	const onPlan = async () => {
		setBusyStage("planning");
		try {
			const id = await ensureRun();
			await planRun({ runId: id });
			notifyStudioSuccess("Plan ready", "Image and video prompts updated.");
		} catch (error) {
			notifyStudioError("Planning failed", error);
		} finally {
			setBusyStage(null);
		}
	};

	const onGenerateImage = async () => {
		setBusyStage("image");
		try {
			const id = await ensureRun();
			await generateImage({ runId: id });
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
			const id = await ensureRun();
			await uploadReferenceImage({
				runId: id,
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

	const onGenerateVideo = async () => {
		setBusyStage("video");
		try {
			const id = await ensureRun();
			await generateVideo({ runId: id });
			notifyStudioSuccess("Video appended", "Clip saved to this run.");
		} catch (error) {
			notifyStudioError("Video generation failed", error);
		} finally {
			setBusyStage(null);
		}
	};

	const onStartComposition = async () => {
		setBusyStage("video");
		try {
			const id = await ensureRun();
			await startComposition({ runId: id });
			notifyStudioSuccess(
				"Composition started",
				"Clips will generate one at a time.",
			);
		} catch (error) {
			notifyStudioError("Composition could not start", error);
		} finally {
			setBusyStage(null);
		}
	};

	const profile =
		MODEL_CAPABILITY_PROFILES[videoConfig.modelId as VideoModelId];

	const planReady =
		run?.status === "planning" ||
		run?.status === "plan_ready" ||
		run?.status === "image_generating" ||
		run?.status === "image_ready" ||
		run?.status === "video_generating" ||
		run?.status === "completed" ||
		run?.status === "failed" ||
		busyStage === "planning";

	const isPlanningNextComposition =
		composition.enabled &&
		(busyStage === "planning" || run?.status === "planning") &&
		(compositionAttempts?.length ?? 0) > 0;

	const extraIds = run?.extraReferenceImageIds ?? [];
	const isRunLoading = Boolean(runId) && run === undefined;

	return (
		<StudioShell
			activePath="/"
			history={
				<HistoryPanel
					selectedRunId={runId}
					onDeleted={(id) => {
						if (runId === id) {
							setRunId(null, true);
						}
					}}
				/>
			}
		>
			{isRunLoading ? (
				<StudioRunSkeleton />
			) : (
				<>
					<div className="space-y-8 rounded-2xl border border-border/80 bg-card p-5 sm:p-8">
						<section className="space-y-2">
							<h1 className="font-heading text-2xl font-semibold">
								Shloka Video Generator
							</h1>
							<p className="text-sm text-muted-foreground">
								Plan → reference stills → OpenRouter video. Default path is 9:16
								portrait for shorts.
							</p>
						</section>

						<ShlokaComposer
							shlokaText={shlokaText}
							customInstructions={customInstructions}
							plannerSystemPrompt={plannerSystemPrompt}
							onShlokaChange={setShlokaText}
							onInstructionsChange={setCustomInstructions}
							onPlannerSystemPromptChange={setPlannerSystemPrompt}
							disabled={busyStage !== null}
						/>

						<MultiClipCompositionControls
							value={composition}
							modelId={videoConfig.modelId as VideoModelId}
							durationSeconds={videoConfig.durationSeconds}
							onChange={setComposition}
							disabled={
								busyStage !== null ||
								compositionJob?.status === "generating" ||
								compositionJob?.status === "awaiting_terminal_frame"
							}
						/>

						{composition.enabled ? (
							<div className="flex flex-col gap-4 border-t border-border/80 pt-6">
								<div className="flex flex-col gap-2">
									<h2 className="font-heading text-xl font-semibold">
										Video model
									</h2>
									<p className="text-sm text-muted-foreground">
										Choose the model and native clip duration before generating
										the multi-clip plan.
									</p>
									<VideoModelSelector
										value={videoConfig.modelId as VideoModelId}
										gatewayPricingById={gatewayById}
										pricingSkusById={pricingSkusById}
										disabled={busyStage !== null}
										onValueChange={(modelId) => {
											setVideoConfig(defaultVideoParams(modelId));
										}}
									/>
								</div>
								<VideoConfiguration
									value={videoConfig}
									onChange={setVideoConfig}
									disabled={busyStage !== null}
								/>
							</div>
						) : null}

						<div className="flex flex-wrap gap-3">
							<Button
								className="min-h-11"
								disabled={!shlokaText.trim() || busyStage !== null}
								onClick={onPlan}
							>
								{busyStage === "planning"
									? "Planning…"
									: composition.enabled
										? (compositionAttempts?.length ?? 0) > 0
											? "Plan another multi-clip attempt"
											: "Generate multi-clip plan"
										: "Generate creative plan"}
							</Button>
						</div>

						{planReady ? (
							<div className="flex flex-col gap-4">
								{composition.enabled &&
								(compositionJob || isPlanningNextComposition) ? (
									<CompositionAttemptControls
										attempts={compositionAttempts ?? []}
										activeJobId={compositionJob?._id}
										activeConfig={
											compositionJob
												? {
														_id: compositionJob._id,
														attemptNumber: compositionJob.attemptNumber ?? 1,
														status: compositionJob.status,
														mode: compositionJob.mode,
														clipCount: compositionJob.clipCount,
														videoParams: compositionJob.videoParams,
														overallDescription:
															compositionJob.overallDescription,
														plannerModel: compositionJob.plannerModel,
														plannerReasoning: compositionJob.plannerReasoning,
														estimatedCostUsd: compositionJob.estimatedCostUsd,
														actualCostUsd: compositionJob.actualCostUsd,
														createdAt: compositionJob.createdAt,
													}
												: null
										}
										disabled={compositionSwitchDisabled}
										isPlanningNext={isPlanningNextComposition}
										onSelectAttempt={onSelectCompositionAttempt}
										scenes={(compositionJob?.clips ?? []).map(
											(clip: {
												clipIndex: number;
												scenePrompt: string;
												continuityInstructions?: string;
												transition?: string;
											}) => ({
												clipIndex: clip.clipIndex,
												scenePrompt: clip.scenePrompt,
												continuityInstructions: clip.continuityInstructions,
												transition: clip.transition,
											}),
										)}
									/>
								) : null}
								<ShlokaPlanPreview
									imagePrompt={run?.imagePrompt}
									videoScenes={run?.videoScenes}
									compositionOverallDescription={
										compositionJob?.overallDescription
									}
									compositionClips={compositionJob?.clips.map((clip) => ({
										clipIndex: clip.clipIndex,
										durationSeconds:
											compositionJob.videoParams?.durationSeconds ?? 0,
										scenePrompt: clip.scenePrompt,
										globalDescription: clip.globalDescription,
										continuityInstructions: clip.continuityInstructions,
										transition: clip.transition,
										usesPreviousTerminalFrame:
											compositionJob.mode === "continuation" &&
											clip.clipIndex > 0,
									}))}
									plannerModel={
										compositionJob?.plannerModel ?? run?.plannerModel
									}
									plannerReasoning={
										compositionJob?.plannerReasoning ?? run?.plannerReasoning
									}
									onRegenerate={
										runId
											? () => {
													void planRun({ runId, force: true });
												}
											: undefined
									}
									regenerating={busyStage === "planning"}
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
									supportsLastFrame={profile?.supportsLastFrame}
									supportsInputReferences={profile?.supportsInputReferences}
									maxInputReferences={profile?.maxInputReferences}
									disabled={busyStage !== null || !runId}
									onSelectFirstFrame={async (id) => {
										if (!runId) return;
										await updateDraft({ runId, firstFrameImageId: id });
									}}
									onSelectLastFrame={async (id) => {
										if (!runId) return;
										await updateDraft({ runId, lastFrameImageId: id });
									}}
									onToggleExtraReference={async (id) => {
										if (!runId) return;
										const next = extraIds.includes(id)
											? extraIds.filter((item) => item !== id)
											: [...extraIds, id];
										await updateDraft({ runId, extraReferenceImageIds: next });
									}}
									onRemoveImage={async (id) => {
										if (!runId) return;
										await removeReferenceImage({ runId, imageId: id });
									}}
								/>
							</div>
						) : null}

						{planReady && !composition.enabled ? (
							<div className="flex flex-col gap-4 border-t border-border/80 pt-6">
								<div className="flex flex-col gap-2">
									<h2 className="font-heading text-xl font-semibold">
										Video model
									</h2>
									<p className="text-sm text-muted-foreground">
										Compact picker with capabilities, limits, and pricing notes.
									</p>
									<VideoModelSelector
										value={videoConfig.modelId as VideoModelId}
										gatewayPricingById={gatewayById}
										pricingSkusById={pricingSkusById}
										disabled={busyStage !== null}
										onValueChange={(modelId) => {
											setVideoConfig({
												...defaultVideoParams(modelId),
											});
										}}
									/>
								</div>
								<VideoConfiguration
									value={videoConfig}
									onChange={setVideoConfig}
									disabled={busyStage !== null}
								/>
								<Button
									className="min-h-11"
									disabled={busyStage !== null}
									onClick={onGenerateVideo}
								>
									{busyStage === "video"
										? "Generating video…"
										: "Generate video (append)"}
								</Button>
							</div>
						) : null}

						{planReady && composition.enabled && compositionJob ? (
							<div className="flex flex-wrap gap-3 border-t border-border/80 pt-6">
								{compositionJob.status === "planned" ||
								compositionJob.status === "failed" ? (
									<Button
										className="min-h-11"
										disabled={busyStage !== null}
										onClick={onStartComposition}
									>
										{busyStage === "video"
											? "Starting composition…"
											: `Generate ${composition.multiplier} clips`}
									</Button>
								) : null}
								{compositionJob.status === "generating" ||
								compositionJob.status === "awaiting_terminal_frame" ? (
									<Button
										className="min-h-11"
										variant="outline"
										disabled={busyStage !== null}
										onClick={() => runId && cancelComposition({ runId })}
									>
										Cancel composition
									</Button>
								) : null}
							</div>
						) : null}

						{compositionJobWithUrls ? (
							<div
								className={
									isPlanningNextComposition
										? "opacity-70 transition-opacity"
										: undefined
								}
							>
								{isPlanningNextComposition ? (
									<p className="mb-2 text-xs text-amber-800 dark:text-amber-200">
										Showing previous plan clips while the next plan is
										generated.
									</p>
								) : null}
								<CompositionResult
									status={compositionJobWithUrls.status}
									clips={
										compositionJobWithUrls.clips as CompositionClipResult[]
									}
									totalDurationSeconds={
										compositionJobWithUrls.totalDurationSeconds
									}
									aspectRatio={compositionJobWithUrls.videoParams?.aspectRatio}
									mergeSources={(compositionJobWithUrls.clips ?? []).map(
										(clip: {
											video?: {
												url?: string | null;
												objectKey?: string | null;
											};
										}) => ({
											url: clip.video?.url,
											objectKey: clip.video?.objectKey,
											runId,
										}),
									)}
								/>
							</div>
						) : null}

						<VideoResult runId={runId} videos={videos} />
					</div>
					<GenerationProgressDock
						status={run?.status}
						busyStage={busyStage}
						warnings={run?.warnings}
						contextLabel={
							busyStage === "video" || run?.status === "video_generating"
								? videoConfig.modelId
								: shlokaText.slice(0, 40) || null
						}
					/>
				</>
			)}
		</StudioShell>
	);
}
