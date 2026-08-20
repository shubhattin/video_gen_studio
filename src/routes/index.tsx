import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { CompositionAttemptControls } from "#/components/studio/composition/composition-attempt-controls";
import {
	type CompositionClipResult,
	CompositionResult,
} from "#/components/studio/composition/composition-result";
import {
	type CompositionSettings,
	MultiClipCompositionControls,
} from "#/components/studio/composition/multi-clip-composition-controls";
import { AutosaveStatus } from "#/components/studio/shell/autosave-status";
import { HistoryPanel } from "#/components/studio/shell/history-panel";
import { NewRunSetup } from "#/components/studio/shell/new-run-setup";
import { StudioRunSkeleton } from "#/components/studio/shell/studio-run-skeleton";
import { StudioShell } from "#/components/studio/shell/studio-shell";
import { ShlokaComposer } from "#/components/studio/shloka/shloka-composer";
import { ShlokaPlanAttemptControls } from "#/components/studio/shloka/shloka-plan-attempt-controls";
import { ShlokaPlanPreview } from "#/components/studio/shloka/shloka-plan-preview";
import { GenerationProgressDock } from "#/components/studio/video/generation-progress-dock";
import { ReferenceImagePanel } from "#/components/studio/video/reference-image-panel";
import {
	type VideoConfigState,
	VideoConfiguration,
} from "#/components/studio/video/video-configuration";
import { VideoGenerateConfirm } from "#/components/studio/video/video-generate-confirm";
import { VideoModelSelector } from "#/components/studio/video/video-model-selector";
import { VideoResult } from "#/components/studio/video/video-result";
import { Button } from "#/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { useCompositionTerminalFrameHandoff } from "#/hooks/use-composition-terminal-frame-handoff";
import {
	isTextOnlyConfigChange,
	useRunAutosave,
} from "#/hooks/use-run-autosave";
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

	const run = useQuery(api.studio.queries.getRun, runId ? { runId } : "skip");
	const compositionJob = useQuery(
		api.studio.queries.getCompositionForRun,
		runId ? { runId } : "skip",
	);
	const compositionAttempts = useQuery(
		api.studio.queries.listCompositionJobsForRun,
		runId ? { runId } : "skip",
	);
	const shlokaPlans = useQuery(
		api.studio.queries.listShlokaPlansForRun,
		runId ? { runId } : "skip",
	);
	const catalog = useQuery(api.studio.queries.getCachedOpenRouterCatalog);
	const refreshCatalog = useAction(api.studio.actions.refreshModelCatalog);

	const createDraft = useMutation(api.studio.mutations.createShlokaDraft);
	const updateDraft = useMutation(api.studio.mutations.updateDraft);
	const removeReferenceImage = useMutation(
		api.studio.mutations.removeReferenceImage,
	);
	const attachGalleryImageToRun = useMutation(
		api.studio.mutations.attachGalleryImageToRun,
	);
	const selectShlokaPlan = useMutation(api.studio.mutations.selectShlokaPlan);
	const deleteShlokaPlan = useMutation(api.studio.mutations.deleteShlokaPlan);
	const forkShlokaPlan = useMutation(api.studio.mutations.forkShlokaPlan);
	const renameShlokaPlan = useMutation(api.studio.mutations.renameShlokaPlan);
	const prepareReferenceImageUpload = useAction(
		api.studio.r2.prepareReferenceImageUpload,
	);
	const finalizeReferenceImageUpload = useAction(
		api.studio.r2.finalizeReferenceImageUpload,
	);
	const planRun = useAction(api.studio.actions.planShlokaRun);
	const generateImage = useAction(api.studio.actions.generateReferenceImage);
	const generateVideo = useAction(api.studio.actions.generateVideoForRun);
	const startComposition = useMutation(api.studio.mutations.startComposition);
	const cancelComposition = useMutation(api.studio.mutations.cancelComposition);
	const selectCompositionJob = useMutation(
		api.studio.mutations.selectCompositionJob,
	);

	const autosave = useRunAutosave({
		runId,
		runStatus: run?.status ?? null,
		onError: (error) => notifyStudioError("Could not save draft", error),
	});

	const rawImages = (run?.referenceImages ?? []) as Array<{
		id: string;
		objectKey?: string;
		source?: "generated" | "uploaded" | "terminal_frame";
		revisedImagePrompt?: string;
		createdAt: number;
	}>;
	const rawVideos = (run?.videos ?? []) as Array<{
		id: string;
		objectKey?: string;
		createdAt: number;
	}>;
	const mediaObjectKeys = [
		...rawImages.map((image) => image.objectKey),
		...rawVideos.map((video) => video.objectKey),
		...(compositionJob?.clips ?? []).flatMap(
			(clip: {
				video?: { objectKey?: string };
				terminalFrameObjectKey?: string;
			}) => [clip.video?.objectKey, clip.terminalFrameObjectKey],
		),
	];
	const urlsByKey = useSignedMediaUrls(runId, mediaObjectKeys);
	const images = rawImages.map((image) => withSignedUrl(image, urlsByKey));
	const videos = rawVideos.map((video) => withSignedUrl(video, urlsByKey));
	const compositionJobWithUrls = compositionJob
		? {
				...compositionJob,
				clips: (compositionJob.clips ?? []).map(
					(
						clip: CompositionClipResult & { terminalFrameObjectKey?: string },
					) => ({
						...clip,
						video: clip.video
							? withSignedUrl(clip.video, urlsByKey)
							: undefined,
					}),
				),
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
				shlokaText,
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
			shlokaText,
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

	const onShlokaChange = (value: string) => {
		setShlokaText(value);
		// Server requires non-empty shloka text — skip while cleared.
		if (value.trim()) {
			autosave.save({ shlokaText: value }, "debounced");
		}
	};

	const onInstructionsChange = (value: string) => {
		setCustomInstructions(value);
		autosave.save({ customInstructions: value }, "debounced");
	};

	const onPlannerSystemPromptChange = (value: string) => {
		setPlannerSystemPrompt(value);
		autosave.save(
			{
				plannerSystemPrompt:
					normalizePlannerSystemPromptForStorage(value) ?? null,
			},
			"debounced",
		);
	};

	const onVideoConfigChange = (next: VideoConfigState) => {
		const mode = isTextOnlyConfigChange(videoConfig, next)
			? "debounced"
			: "immediate";
		setVideoConfig(next);
		autosave.save({ videoParams: next, selectedModelId: next.modelId }, mode);
	};

	const onModelChange = (modelId: VideoModelId) => {
		const next = defaultVideoParams(modelId);
		setVideoConfig(next);
		autosave.save({ selectedModelId: modelId, videoParams: next }, "immediate");
	};

	const onCompositionChange = (next: CompositionSettings) => {
		setComposition(next);
		autosave.save(
			{
				compositionMode: next.enabled ? next.mode : null,
				compositionMultiplier: next.enabled ? next.multiplier : null,
				compositionClipCount: next.enabled ? next.multiplier : null,
			},
			"immediate",
		);
	};

	const onImageSizeChange = (value: string) => {
		setImageSize(value);
		autosave.save({ imageSize: value }, "immediate");
	};

	const onImageQualityChange = (value: string) => {
		setImageQuality(value);
		autosave.save({ imageQuality: value }, "immediate");
	};

	const onPlan = async () => {
		setBusyStage("planning");
		try {
			const id = await ensureRun();
			await planRun({
				runId: id,
				force:
					(composition.enabled
						? (compositionAttempts?.length ?? 0)
						: (shlokaPlans?.length ?? 0)) > 0,
			});
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
			notifyStudioSuccess("Video clip saved", "Added to this run.");
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
	const isModelLocked = Boolean(run?.videos?.length);

	const planReady =
		run?.status === "planning" ||
		run?.status === "plan_ready" ||
		run?.status === "image_generating" ||
		run?.status === "image_ready" ||
		run?.status === "video_generating" ||
		run?.status === "completed" ||
		run?.status === "failed" ||
		busyStage === "planning";

	const activePlan = (shlokaPlans ?? []).find(
		(plan: { _id?: string }) => plan._id === run?.activePlanId,
	) as { title?: string; attemptNumber: number } | undefined;
	const activePlanLabel = activePlan
		? activePlan.title?.trim() || `Plan ${activePlan.attemptNumber}`
		: undefined;

	const isPlanningNextComposition =
		composition.enabled &&
		(busyStage === "planning" || run?.status === "planning") &&
		(compositionAttempts?.length ?? 0) > 0;

	const extraIds = (run?.extraReferenceImageIds ?? []) as Id<"galleryImages">[];
	const isPlanningNextShloka =
		!composition.enabled &&
		(busyStage === "planning" || run?.status === "planning") &&
		(shlokaPlans?.length ?? 0) > 0;
	const isRunLoading = Boolean(runId) && run === undefined;
	// Targeted busy flags so unrelated controls stay usable while one stage runs.
	const planningBusy = busyStage === "planning";
	const videoBusy = busyStage === "video";
	const anyBusy = busyStage !== null;

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
					<div className="space-y-6 rounded-2xl border border-border/80 bg-gradient-to-b from-card to-card/40 p-4 shadow-sm sm:p-6">
						<section className="flex flex-wrap items-start justify-between gap-3">
							<div className="space-y-1.5">
								<h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
									Shloka Video Generator
								</h1>
								<p className="text-sm text-muted-foreground">
									Turn a verse into a short video: plan the scenes, generate
									reference stills, then render the clips. Defaults to 9:16
									portrait.
								</p>
							</div>
							<AutosaveStatus
								status={autosave.status}
								hasPending={autosave.hasPending}
								onRetry={autosave.retry}
								className="pt-1"
							/>
						</section>

						{!runId ? (
							<NewRunSetup
								provenance="shloka"
								onCreated={(id) => setRunId(id)}
							/>
						) : (
							<>
								<ShlokaComposer
									shlokaText={shlokaText}
									customInstructions={customInstructions}
									plannerSystemPrompt={plannerSystemPrompt}
									onShlokaChange={onShlokaChange}
									onInstructionsChange={onInstructionsChange}
									onPlannerSystemPromptChange={onPlannerSystemPromptChange}
									onPersist={() => void autosave.flush()}
									disabled={planningBusy}
								/>

								<MultiClipCompositionControls
									value={composition}
									modelId={videoConfig.modelId as VideoModelId}
									durationSeconds={videoConfig.durationSeconds}
									onChange={onCompositionChange}
									hasPlan={planReady}
									disabled={
										planningBusy ||
										videoBusy ||
										compositionJob?.status === "generating" ||
										compositionJob?.status === "awaiting_terminal_frame"
									}
								/>

								{composition.enabled ? (
									<div className="flex flex-col gap-3 border-t border-border/80 pt-5">
										<div className="flex flex-col gap-1.5">
											<h2 className="font-heading text-lg font-semibold">
												Video model
											</h2>
											<p className="text-sm text-muted-foreground">
												Choose the model and clip duration before planning.
											</p>
											<VideoModelSelector
												value={videoConfig.modelId as VideoModelId}
												gatewayPricingById={gatewayById}
												pricingSkusById={pricingSkusById}
												disabled={planningBusy || videoBusy || isModelLocked}
												onValueChange={onModelChange}
											/>
											{isModelLocked ? (
												<p className="text-xs text-muted-foreground">
													The video model is fixed after single-clip generation
													begins for this run.
												</p>
											) : null}
										</div>
										<VideoConfiguration
											value={videoConfig}
											onChange={onVideoConfigChange}
											disabled={planningBusy || videoBusy}
										/>
									</div>
								) : null}

								<div className="flex flex-wrap gap-3">
									{busyStage === "planning" ? (
										<Button className="min-h-11" disabled>
											Planning…
										</Button>
									) : composition.enabled ? (
										(compositionAttempts?.length ?? 0) > 0 ? (
											<AlertDialog>
												<AlertDialogTrigger
													render={
														<Button
															className="min-h-11"
															disabled={!shlokaText.trim() || anyBusy}
														/>
													}
												>
													Plan another multi-clip attempt
												</AlertDialogTrigger>
												<AlertDialogContent>
													<AlertDialogHeader>
														<AlertDialogTitle>
															Plan another attempt?
														</AlertDialogTitle>
														<AlertDialogDescription>
															This creates a new multi-clip plan from your
															shloka and instructions. Your current plan stays
															available to switch back to.
														</AlertDialogDescription>
													</AlertDialogHeader>
													<AlertDialogFooter>
														<AlertDialogCancel>Cancel</AlertDialogCancel>
														<AlertDialogAction onClick={() => void onPlan()}>
															Plan another
														</AlertDialogAction>
													</AlertDialogFooter>
												</AlertDialogContent>
											</AlertDialog>
										) : (
											<Button
												className="min-h-11"
												disabled={!shlokaText.trim() || anyBusy}
												onClick={onPlan}
											>
												Generate multi-clip plan
											</Button>
										)
									) : (shlokaPlans?.length ?? 0) > 0 ? (
										<AlertDialog>
											<AlertDialogTrigger
												render={
													<Button
														className="min-h-11"
														disabled={!shlokaText.trim() || anyBusy}
													/>
												}
											>
												Plan another
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>Plan another?</AlertDialogTitle>
													<AlertDialogDescription>
														This creates a new plan from your shloka and
														instructions. Your current plan stays available to
														switch back to.
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Cancel</AlertDialogCancel>
													<AlertDialogAction onClick={() => void onPlan()}>
														Plan another
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									) : (
										<Button
											className="min-h-11"
											disabled={!shlokaText.trim() || anyBusy}
											onClick={onPlan}
										>
											Generate creative plan
										</Button>
									)}
								</div>

								{planReady ? (
									<div className="flex flex-col gap-3">
										{composition.enabled &&
										(compositionJob || isPlanningNextComposition) ? (
											<CompositionAttemptControls
												attempts={compositionAttempts ?? []}
												activeJobId={compositionJob?._id}
												activeConfig={
													compositionJob
														? {
																_id: compositionJob._id,
																attemptNumber:
																	compositionJob.attemptNumber ?? 1,
																status: compositionJob.status,
																mode: compositionJob.mode,
																clipCount: compositionJob.clipCount,
																videoParams: compositionJob.videoParams,
																overallDescription:
																	compositionJob.overallDescription,
																plannerModel: compositionJob.plannerModel,
																plannerReasoning:
																	compositionJob.plannerReasoning,
																estimatedCostUsd:
																	compositionJob.estimatedCostUsd,
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
										) : !composition.enabled ? (
											<ShlokaPlanAttemptControls
												attempts={shlokaPlans ?? []}
												activePlanId={run?.activePlanId}
												disabled={planningBusy}
												isPlanningNext={isPlanningNextShloka}
												onSelectAttempt={(planId) => {
													if (!runId) return;
													void selectShlokaPlan({
														runId,
														planId: planId as Id<"shlokaPlans">,
													}).catch((error) =>
														notifyStudioError("Could not switch plan", error),
													);
												}}
												onRenameAttempt={(planId, title) => {
													void renameShlokaPlan({
														planId: planId as Id<"shlokaPlans">,
														title,
													}).catch((error) =>
														notifyStudioError("Could not name plan", error),
													);
												}}
											/>
										) : null}
										<ShlokaPlanPreview
											imagePrompt={run?.imagePrompt}
											videoScenes={run?.videoScenes}
											compositionOverallDescription={
												compositionJob?.overallDescription
											}
											compositionClips={compositionJob?.clips.map(
												(clip: {
													clipIndex: number;
													scenePrompt: string;
													globalDescription?: string;
													continuityInstructions?: string;
													transition?: string;
												}) => ({
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
												}),
											)}
											disabled={planningBusy || !runId}
											onSaveImagePrompt={
												runId
													? async (imagePrompt) => {
															await updateDraft({ runId, imagePrompt });
															notifyStudioSuccess(
																"Image prompt saved",
																"Reference image generation will use the updated prompt.",
															);
														}
													: undefined
											}
											onSaveVideoScenes={
												runId
													? async (videoScenes) => {
															await updateDraft({ runId, videoScenes });
															notifyStudioSuccess(
																"Video plan saved",
																"Video generation will use the updated scenes.",
															);
														}
													: undefined
											}
											activePlanId={run?.activePlanId ?? null}
											attempts={
												(shlokaPlans ?? []) as Array<{
													attemptNumber: number;
												}>
											}
											onFork={
												runId && run?.activePlanId
													? (planId, title) => {
															void forkShlokaPlan({
																runId,
																planId: planId as Id<"shlokaPlans">,
																title,
															}).catch((error) =>
																notifyStudioError("Could not fork plan", error),
															);
														}
													: undefined
											}
											onDelete={
												runId && run?.activePlanId
													? (planId) => {
															void deleteShlokaPlan({
																runId,
																planId: planId as Id<"shlokaPlans">,
															}).catch((error) =>
																notifyStudioError(
																	"Could not delete plan",
																	error,
																),
															);
														}
													: undefined
											}
										/>
										<ReferenceImagePanel
											runId={runId}
											imageSize={imageSize}
											imageQuality={imageQuality}
											onSizeChange={onImageSizeChange}
											onQualityChange={onImageQualityChange}
											onGenerate={onGenerateImage}
											onUpload={onUploadImage}
											onReuseImage={
												runId
													? async (imageId) => {
															await attachGalleryImageToRun({
																runId,
																imageId: imageId as Id<"galleryImages">,
															});
															notifyStudioSuccess(
																"Image attached",
																"Reused from the shared gallery.",
															);
														}
													: undefined
											}
											generating={busyStage === "image"}
											uploading={busyStage === "upload"}
											images={images}
											firstFrameImageId={run?.firstFrameImageId}
											lastFrameImageId={run?.lastFrameImageId}
											extraReferenceImageIds={extraIds}
											supportsFirstFrame={profile?.supportsFirstFrame}
											supportsLastFrame={profile?.supportsLastFrame}
											supportsInputReferences={profile?.supportsInputReferences}
											maxInputReferences={profile?.maxInputReferences}
											disabled={!runId}
											globalBusy={anyBusy}
											onSelectFirstFrame={(id) => {
												if (!runId) return;
												const imageId = id as Id<"galleryImages"> | null;
												autosave.save(
													{
														firstFrameImageId: imageId,
														lastFrameImageId:
															imageId && run?.lastFrameImageId === imageId
																? null
																: (run?.lastFrameImageId ?? null),
														extraReferenceImageIds:
															imageId && extraIds.includes(imageId)
																? extraIds.filter((item) => item !== imageId)
																: extraIds,
													},
													"immediate",
												);
											}}
											onSelectLastFrame={(id) => {
												if (!runId) return;
												const imageId = id as Id<"galleryImages"> | null;
												autosave.save(
													{
														lastFrameImageId: imageId,
														firstFrameImageId:
															imageId && run?.firstFrameImageId === imageId
																? null
																: (run?.firstFrameImageId ?? null),
														extraReferenceImageIds:
															imageId && extraIds.includes(imageId)
																? extraIds.filter((item) => item !== imageId)
																: extraIds,
													},
													"immediate",
												);
											}}
											onToggleExtraReference={(id) => {
												if (!runId) return;
												const imageId = id as Id<"galleryImages">;
												const adding = !extraIds.includes(imageId);
												const next = adding
													? [...extraIds, imageId]
													: extraIds.filter((item) => item !== imageId);
												autosave.save(
													{
														extraReferenceImageIds: next,
														firstFrameImageId:
															adding && run?.firstFrameImageId === imageId
																? null
																: (run?.firstFrameImageId ?? null),
														lastFrameImageId:
															adding && run?.lastFrameImageId === imageId
																? null
																: (run?.lastFrameImageId ?? null),
													},
													"immediate",
												);
											}}
											onRemoveImage={async (id) => {
												if (!runId) return;
												await removeReferenceImage({ runId, imageId: id });
											}}
										/>
									</div>
								) : null}

								{planReady && !composition.enabled ? (
									<div className="flex flex-col gap-3 border-t border-border/80 pt-5">
										<div className="flex flex-col gap-1.5">
											<h2 className="font-heading text-lg font-semibold">
												Video model
											</h2>
											<p className="text-sm text-muted-foreground">
												Pick a model — capabilities, limits, and pricing shown
												below.
											</p>
											<VideoModelSelector
												value={videoConfig.modelId as VideoModelId}
												gatewayPricingById={gatewayById}
												pricingSkusById={pricingSkusById}
												disabled={planningBusy || videoBusy || isModelLocked}
												onValueChange={onModelChange}
											/>
											{isModelLocked ? (
												<p className="text-xs text-muted-foreground">
													The video model is fixed after single-clip generation
													begins for this run.
												</p>
											) : null}
										</div>
										<VideoConfiguration
											value={videoConfig}
											onChange={onVideoConfigChange}
											disabled={planningBusy || videoBusy}
										/>
										<VideoGenerateConfirm
											config={videoConfig}
											className="min-h-11"
											disabled={anyBusy}
											generating={busyStage === "video"}
											triggerLabel="Generate video clip"
											planLabel={activePlanLabel}
											onConfirm={onGenerateVideo}
										/>
									</div>
								) : null}

								{planReady && composition.enabled && compositionJob ? (
									<div className="flex flex-wrap gap-3 border-t border-border/80 pt-5">
										{compositionJob.status === "planned" ||
										compositionJob.status === "failed" ? (
											<Button
												className="min-h-11"
												disabled={anyBusy}
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
												disabled={anyBusy}
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
											aspectRatio={
												compositionJobWithUrls.videoParams?.aspectRatio
											}
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
							</>
						)}
					</div>
					<GenerationProgressDock
						status={run?.status}
						busyStage={busyStage}
						warnings={run?.warnings}
						contextLabel={
							busyStage === "video" || run?.status === "video_generating"
								? (profile?.displayName ?? null)
								: shlokaText.slice(0, 40) || null
						}
					/>
				</>
			)}
		</StudioShell>
	);
}
