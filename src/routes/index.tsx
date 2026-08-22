import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { AutosaveStatus } from "#/components/studio/shell/autosave-status";
import { HistoryPanel } from "#/components/studio/shell/history-panel";
import { StudioLauncher } from "#/components/studio/shell/studio-launcher";
import { StudioRunSkeleton } from "#/components/studio/shell/studio-run-skeleton";
import { StudioShell } from "#/components/studio/shell/studio-shell";
import { DivergenceWarning } from "#/components/studio/shloka/divergence-warning";
import { PlanTabs } from "#/components/studio/shloka/plan-tabs";
import { ShlokaComposer } from "#/components/studio/shloka/shloka-composer";
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
import { Button } from "#/components/ui/button";
import { usePlanAutosave, useRunAutosave } from "#/hooks/use-run-autosave";
import {
	useSignedMediaUrls,
	withSignedUrl,
} from "#/hooks/use-signed-media-urls";
import {
	defaultVideoParams,
	MODEL_CAPABILITY_PROFILES,
	type VideoModelId,
} from "#/lib/model-catalog";
import type {
	PlannerPromptSelection,
	SystemPromptTemplate,
} from "#/lib/planner-prompt";
import {
	type StudioRunSearch,
	studioRunSearchSchema,
} from "#/lib/studio-run-search";
import {
	isActiveRunStatus,
	type StudioBusyStage,
} from "#/lib/studio-run-status";
import { notifyStudioError, notifyStudioSuccess } from "#/lib/studio-toast";
import { uploadReferenceImage } from "#/lib/upload-reference-image";
import { buildVideoPromptFromScenes } from "#/lib/video-plan-markdown";

export const Route = createFileRoute("/")({
	validateSearch: studioRunSearchSchema,
	component: ShlokaStudioPage,
});

function clearRunSearch(prev: StudioRunSearch): StudioRunSearch {
	const { run: _run, plan: _plan, ...rest } = prev;
	return rest;
}

function ShlokaStudioPage() {
	const navigate = useNavigate({ from: Route.fullPath });
	const { run: runSearch, plan: planSearch } = Route.useSearch();
	const runId = (runSearch as Id<"generationRuns"> | undefined) ?? null;
	const searchPlanId = (planSearch as Id<"shlokaPlans"> | undefined) ?? null;

	const setRunId = (id: Id<"generationRuns"> | null, replace = false) => {
		void navigate({
			search: (prev) => (id ? { ...prev, run: id } : clearRunSearch(prev)),
			replace,
		});
	};

	const [shlokaText, setShlokaText] = useState("");
	const [customInstructions, setCustomInstructions] = useState("");
	const [plannerPromptSelection, setPlannerPromptSelection] =
		useState<PlannerPromptSelection | null>(null);
	const [imageSize, setImageSize] = useState("1024x1536");
	const [imageQuality, setImageQuality] = useState("medium");
	const [videoConfig, setVideoConfig] = useState<VideoConfigState>(
		defaultVideoParams("bytedance/seedance-2.5"),
	);
	const [busyStage, setBusyStage] = useState<StudioBusyStage>(null);
	const [creatingPlan, setCreatingPlan] = useState(false);

	const run = useQuery(api.studio.queries.getRun, runId ? { runId } : "skip");
	const plans = useQuery(
		api.studio.queries.listPlansForRun,
		runId ? { runId } : "skip",
	);
	const templateDocs = useQuery(api.studio.queries.listSystemPromptTemplates);
	const templates: SystemPromptTemplate[] | undefined = templateDocs;
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
	const createPlan = useMutation(api.studio.mutations.createPlan);
	const deletePlan = useMutation(api.studio.mutations.deletePlan);
	const renamePlan = useMutation(api.studio.mutations.renamePlan);
	const updatePlanContent = useMutation(api.studio.mutations.updatePlanContent);
	const prepareReferenceImageUpload = useAction(
		api.studio.r2.prepareReferenceImageUpload,
	);
	const finalizeReferenceImageUpload = useAction(
		api.studio.r2.finalizeReferenceImageUpload,
	);
	const planRun = useAction(api.studio.actions.planShlokaRun);
	const generateImage = useAction(api.studio.actions.generateReferenceImage);
	const generateVideo = useAction(api.studio.actions.generateVideoForRun);

	// Active plan: URL param wins when valid; else the run's active plan.
	const activePlanId = useMemo(() => {
		if (!plans || plans.length === 0) return null;
		if (
			searchPlanId &&
			plans.some((p: { _id: string }) => p._id === searchPlanId)
		) {
			return searchPlanId as Id<"shlokaPlans">;
		}
		return (run?.activePlanId as Id<"shlokaPlans"> | undefined) ?? plans[0]._id;
	}, [plans, searchPlanId, run?.activePlanId]);

	const activePlan = plans?.find(
		(p: { _id: string }) => p._id === activePlanId,
	);

	const selectPlanTab = (id: Id<"shlokaPlans">) => {
		if (!runId || id === activePlanId) return;
		// Search-only update: keep the current scroll position and do not
		// treat the tab switch as a "new page" navigation.
		void navigate({
			search: (prev) => ({ ...prev, run: runId, plan: id }),
			replace: true,
			resetScroll: false,
		});
	};

	const autosave = useRunAutosave({
		runId,
		runStatus: run?.status ?? null,
		onError: (error) => notifyStudioError("Could not save draft", error),
	});
	const planAutosave = usePlanAutosave({
		runId,
		planId: activePlanId,
		planStatus: activePlan?.status ?? null,
		onError: (error) => notifyStudioError("Could not save plan", error),
	});

	// Signed URLs for the run's images + the active plan's videos.
	const rawImages = (run?.images ?? []) as Array<{
		id: string;
		objectKey?: string;
		source?: "generated" | "uploaded" | "terminal_frame";
		revisedImagePrompt?: string;
		createdAt: number;
		meta?: { width?: number; height?: number };
	}>;
	const rawVideos = (activePlan?.videos ?? []) as Array<{
		id: string;
		objectKey?: string;
		createdAt: number;
	}>;
	const mediaObjectKeys = [
		...rawImages.map((image) => image.objectKey),
		...rawVideos.map((video) => video.objectKey),
	];
	const urlsByKey = useSignedMediaUrls(mediaObjectKeys);
	const images = rawImages.map((image) => withSignedUrl(image, urlsByKey));
	const videos = rawVideos.map((video) => withSignedUrl(video, urlsByKey));

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

	// Hydrate local draft state when the selected run changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: Hydrate the local draft only when the selected run changes.
	useEffect(() => {
		if (!runId) {
			setShlokaText("");
			setCustomInstructions("");
			setImageSize("1024x1536");
			setImageQuality("medium");
			setVideoConfig(defaultVideoParams("bytedance/seedance-2.5"));
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
		setShlokaText(run.shlokaText ?? "");
		setCustomInstructions(run.customInstructions ?? "");
		setImageSize(run.imageSize ?? "1024x1536");
		setImageQuality(run.imageQuality ?? "medium");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [runId, run?._id, run === null]);

	// Keep prompt selection in sync with the run.
	// biome-ignore lint/correctness/useExhaustiveDependencies: Runs grouped by runId; selection is the sync source.
	useEffect(() => {
		if (!runId || !run) {
			setPlannerPromptSelection(null);
			return;
		}
		const selected = run.plannerPromptSelection ?? null;
		const dangling =
			selected &&
			selected.kind === "template" &&
			templates !== undefined &&
			!templates.some((template) => template._id === selected.templateId);
		setPlannerPromptSelection(dangling ? null : selected);
	}, [runId, run?.plannerPromptSelection, templates, run === null]);

	// Mirror the ACTIVE PLAN's config into local state for the config controls.
	// biome-ignore lint/correctness/useExhaustiveDependencies: Hydrate config only when the active plan changes.
	useEffect(() => {
		if (!activePlan) {
			return;
		}
		const params = activePlan.videoParams ?? {};
		setVideoConfig({
			modelId: (params.modelId as VideoModelId) ?? "bytedance/seedance-2.5",
			aspectRatio: params.aspectRatio ?? "9:16",
			resolution: params.resolution ?? "720p",
			durationSeconds: params.durationSeconds ?? 8,
			generateAudio: params.generateAudio,
			negativePrompt: params.negativePrompt,
			cfgScale: params.cfgScale,
		});
	}, [activePlanId, activePlan?.videoParams]);

	const ensureRun = async () => {
		if (runId) {
			await updateDraft({
				runId,
				shlokaText,
				customInstructions,
				plannerPromptSelection,
				imageSize,
				imageQuality,
			});
			return runId;
		}
		const { runId: id } = await createDraft({
			shlokaText,
			customInstructions,
			...(plannerPromptSelection ? { plannerPromptSelection } : {}),
		});
		setRunId(id);
		await updateDraft({
			runId: id,
			shlokaText,
			plannerPromptSelection,
			imageSize,
			imageQuality,
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

	const onPlannerPromptSelectionChange = (
		selection: PlannerPromptSelection | null,
	) => {
		setPlannerPromptSelection(selection);
		autosave.save({ plannerPromptSelection: selection }, "immediate");
	};

	const onVideoConfigChange = (next: VideoConfigState) => {
		setVideoConfig(next);
		planAutosave.save({ videoParams: next }, "immediate");
	};

	const onModelChange = (modelId: VideoModelId) => {
		const next = defaultVideoParams(modelId);
		setVideoConfig(next);
		planAutosave.save({ videoParams: next }, "immediate");
	};

	const onImageSizeChange = (value: string) => {
		setImageSize(value);
		autosave.save({ imageSize: value }, "immediate");
	};

	const onImageQualityChange = (value: string) => {
		setImageQuality(value);
		autosave.save({ imageQuality: value }, "immediate");
	};

	const onCreatePlan = async () => {
		if (!runId) return;
		setCreatingPlan(true);
		try {
			const id = await createPlan({ runId });
			selectPlanTab(id);
			notifyStudioSuccess(
				"Plan created",
				"A fresh plan is ready to configure.",
			);
		} catch (error) {
			notifyStudioError("Could not create plan", error);
		} finally {
			setCreatingPlan(false);
		}
	};

	const handleDeletePlan = async (planIdValue: Id<"shlokaPlans">) => {
		if (!runId) return;
		try {
			await deletePlan({ runId, planId: planIdValue });
			// Clear the selected-tab URL param; the active plan falls back to
			// the run's next plan automatically.
			void navigate({
				search: (prev) => ({ ...prev, plan: undefined }),
				replace: true,
				resetScroll: false,
			});
		} catch (error) {
			notifyStudioError("Could not delete plan", error);
		}
	};

	const onPlan = async () => {
		if (!plannerPromptSelection) {
			notifyStudioError(
				"Planning blocked",
				new Error("Select a system prompt template before planning."),
			);
			return;
		}
		if (!runId || !activePlanId) return;
		setBusyStage("planning");
		try {
			await planAutosave.flush();
			await ensureRun();
			await planRun({ runId, planId: activePlanId });
			notifyStudioSuccess("Plan ready", "Image and video prompts updated.");
		} catch (error) {
			notifyStudioError("Planning failed", error);
		} finally {
			setBusyStage(null);
		}
	};

	const onGenerateImage = async () => {
		if (!runId) return;
		setBusyStage("image");
		try {
			await ensureRun();
			await generateImage({ runId });
			notifyStudioSuccess("Reference image ready");
		} catch (error) {
			notifyStudioError("Image generation failed", error);
		} finally {
			setBusyStage(null);
		}
	};

	const onUploadImage = async (file: File) => {
		if (!runId) return;
		setBusyStage("upload");
		try {
			await ensureRun();
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

	const onGenerateVideo = async () => {
		if (!runId || !activePlanId) return;
		setBusyStage("video");
		try {
			await ensureRun();
			await generateVideo({ runId, planId: activePlanId });
			notifyStudioSuccess("Video clip saved", "Added to this plan.");
		} catch (error) {
			notifyStudioError("Video generation failed", error);
		} finally {
			setBusyStage(null);
		}
	};

	const profile =
		MODEL_CAPABILITY_PROFILES[videoConfig.modelId as VideoModelId];

	const planReady =
		activePlan?.status === "ready" ||
		busyStage === "planning" ||
		run?.status === "planning";

	const videoBusy = busyStage === "video";
	const anyBusy =
		busyStage !== null ||
		isActiveRunStatus(run?.status) ||
		activePlan?.status === "planning" ||
		creatingPlan;

	// Divergence: current config differs from what the plan was generated with.
	const divergenceFields = useMemo(() => {
		if (!activePlan || activePlan.status !== "ready") return [];
		const used = activePlan.lastModelParamsUsed;
		if (!used) return [];
		const fields: Array<{ label: string; current: string; used: string }> = [];
		if (videoConfig.modelId !== used.modelId) {
			fields.push({
				label: "model",
				current:
					MODEL_CAPABILITY_PROFILES[videoConfig.modelId as VideoModelId]
						?.displayName ?? videoConfig.modelId,
				used:
					MODEL_CAPABILITY_PROFILES[used.modelId as VideoModelId]
						?.displayName ?? used.modelId,
			});
		}
		if (videoConfig.aspectRatio !== used.aspectRatio) {
			fields.push({
				label: "aspect ratio",
				current: videoConfig.aspectRatio,
				used: used.aspectRatio,
			});
		}
		if (videoConfig.resolution !== used.resolution) {
			fields.push({
				label: "resolution",
				current: videoConfig.resolution,
				used: used.resolution,
			});
		}
		if (videoConfig.durationSeconds !== used.durationSeconds) {
			fields.push({
				label: "duration",
				current: `${videoConfig.durationSeconds}s`,
				used: `${used.durationSeconds}s`,
			});
		}
		if (Boolean(videoConfig.generateAudio) !== Boolean(used.generateAudio)) {
			fields.push({
				label: "audio generation",
				current: videoConfig.generateAudio ? "on" : "off",
				used: used.generateAudio ? "on" : "off",
			});
		}
		return fields;
	}, [activePlan, videoConfig]);

	const hasDivergence = divergenceFields.length > 0;

	// Rendered inside the plan preview header so Regenerate / Copy / Edit sit
	// on one line. Only shown when a generated plan actually exists.
	// Keep it visible (disabled) during regeneration so the extra
	// "Planning…" button is not needed.
	const hasExistingPlanContent = Boolean(
		activePlan?.imagePrompt || activePlan?.videoScenes?.length,
	);
	const showRegenerate =
		activePlan?.status === "ready" ||
		(hasExistingPlanContent &&
			(busyStage === "planning" || activePlan?.status === "planning"));
	const regeneratePlanControl = showRegenerate ? (
		<AlertDialog>
			<AlertDialogTrigger
				render={
					<Button
						className="min-h-11"
						disabled={!shlokaText.trim() || !plannerPromptSelection || anyBusy}
					/>
				}
			>
				Regenerate plan
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Regenerate this plan?</AlertDialogTitle>
					<AlertDialogDescription>
						This overwrites the plan's reference-image prompt and video scenes
						using your current settings. This cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={() => void onPlan()}>
						Regenerate
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	) : null;

	const extraIds = (run?.extraReferenceImageIds ?? []) as Id<"galleryImages">[];
	const isRunLoading = Boolean(runId) && run === undefined;

	return (
		<StudioShell
			activePath="/"
			title={runId ? "Shloka Studio" : undefined}
			subtitle={runId ? "Turn shlokas into explainer videos" : undefined}
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
					<div className="space-y-6 rounded-2xl border border-border/80 bg-linear-to-b from-card to-card/40 p-4 shadow-sm sm:p-6">
						{runId ? (
							<div className="flex items-start justify-end">
								<AutosaveStatus
									status={autosave.status}
									hasPending={autosave.hasPending}
									onRetry={autosave.retry}
									className="pt-1"
								/>
							</div>
						) : null}

						{!runId ? (
							<StudioLauncher onShlokaRunCreated={(id) => setRunId(id)} />
						) : (
							<>
								<ShlokaComposer
									shlokaText={shlokaText}
									customInstructions={customInstructions}
									plannerPromptSelection={plannerPromptSelection}
									templates={templates}
									onShlokaChange={onShlokaChange}
									onInstructionsChange={onInstructionsChange}
									onPlannerPromptSelectionChange={
										onPlannerPromptSelectionChange
									}
									onPersist={() => void autosave.flush()}
									disabled={anyBusy}
								/>

								{plans && plans.length > 0 ? (
									<div className="border-t border-border/80 pt-5">
										<div className="mb-3 flex items-center justify-between gap-3">
											<h2 className="font-heading text-lg font-semibold">
												Plans
											</h2>
											<p className="text-xs text-muted-foreground">
												Each plan holds its own settings, prompts, and videos.
											</p>
										</div>
										<PlanTabs
											plans={(plans ?? []).map(
												(plan: {
													_id: string;
													attemptNumber: number;
													title?: string;
													status: string;
													videos?: unknown[];
												}) => ({
													_id: plan._id,
													attemptNumber: plan.attemptNumber,
													title: plan.title,
													status: plan.status,
													videoCount: plan.videos?.length ?? 0,
												}),
											)}
											activePlanId={activePlanId}
											onSelect={(id) => selectPlanTab(id as Id<"shlokaPlans">)}
											onCreate={() => void onCreatePlan()}
											onRename={async (planIdValue, title) => {
												await renamePlan({
													planId: planIdValue as Id<"shlokaPlans">,
													title,
												});
											}}
											onDelete={(planIdValue) =>
												void handleDeletePlan(planIdValue as Id<"shlokaPlans">)
											}
											creating={creatingPlan}
											disabled={anyBusy}
										/>
									</div>
								) : null}

								{!activePlan ? (
									<div className="rounded-xl border border-dashed border-border/80 p-6 text-center">
										<p className="text-sm text-muted-foreground">
											This run has no plans yet. Create one to get started.
										</p>
										<Button
											className="mt-3 min-h-11"
											disabled={anyBusy || creatingPlan}
											onClick={() => void onCreatePlan()}
										>
											Create plan
										</Button>
									</div>
								) : (
									<>
										<div className="flex flex-col gap-3 border-t border-border/80 pt-5">
											<div className="flex flex-col gap-1.5">
												<h2 className="font-heading text-lg font-semibold">
													Video model &amp; settings
												</h2>
												<p className="text-sm text-muted-foreground">
													Saved to this plan. Plan generation uses these — video
													generation uses the settings the plan was generated
													with.
												</p>
											</div>
											<VideoModelSelector
												value={videoConfig.modelId as VideoModelId}
												gatewayPricingById={gatewayById}
												pricingSkusById={pricingSkusById}
												disabled={anyBusy}
												onValueChange={onModelChange}
											/>
											<VideoConfiguration
												value={videoConfig}
												onChange={onVideoConfigChange}
												disabled={anyBusy}
											/>
											{hasDivergence ? (
												<DivergenceWarning
													fields={divergenceFields}
													onRegenerate={() => void onPlan()}
												/>
											) : null}
										</div>

										{showRegenerate ? null : (
											<div className="flex flex-wrap items-center gap-3 border-t border-border/80 pt-5">
												<Button
													className="min-h-11"
													disabled={
														!shlokaText.trim() ||
														!plannerPromptSelection ||
														anyBusy
													}
													onClick={onPlan}
												>
													Generate plan
												</Button>
												{activePlan.status === "failed" ? (
													<p className="text-xs text-destructive">
														{activePlan.lastError ?? "Planning failed."}
													</p>
												) : null}
											</div>
										)}

										{planReady ? (
											<div className="flex flex-col gap-3">
												<ShlokaPlanPreview
													imagePrompt={activePlan.imagePrompt}
													videoScenes={activePlan.videoScenes}
													videoPrompt={
														activePlan.videoScenes?.length
															? buildVideoPromptFromScenes(
																	activePlan.videoScenes,
																)
															: undefined
													}
													summarizedVideoPrompt={
														activePlan.summarizedVideoPrompt
													}
													disabled={anyBusy}
													actions={regeneratePlanControl}
													onSaveImagePrompt={async (imagePrompt) => {
														if (!runId || !activePlanId) return;
														await updatePlanContent({
															runId,
															planId: activePlanId,
															imagePrompt,
														});
														notifyStudioSuccess(
															"Image prompt saved",
															"Reference image generation will use the updated prompt.",
														);
													}}
													onSaveVideoScenes={async (scenes) => {
														if (!runId || !activePlanId) return;
														await updatePlanContent({
															runId,
															planId: activePlanId,
															videoScenes: scenes,
														});
														notifyStudioSuccess(
															"Video plan saved",
															"Video generation will use the updated scenes.",
														);
													}}
												/>
												<ReferenceImagePanel
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
													supportsInputReferences={
														profile?.supportsInputReferences
													}
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
																		? extraIds.filter(
																				(item) => item !== imageId,
																			)
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
																		? extraIds.filter(
																				(item) => item !== imageId,
																			)
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
														await removeReferenceImage({
															runId,
															imageId: id as Id<"galleryImages">,
														});
													}}
												/>

												<div className="flex flex-col gap-3 border-t border-border/80 pt-5">
													<h2 className="font-heading text-lg font-semibold">
														Generate video
													</h2>
													<VideoGenerateConfirm
														config={
															hasDivergence && activePlan.lastModelParamsUsed
																? {
																		modelId: activePlan.lastModelParamsUsed
																			.modelId as VideoModelId,
																		aspectRatio:
																			activePlan.lastModelParamsUsed
																				.aspectRatio,
																		resolution:
																			activePlan.lastModelParamsUsed.resolution,
																		durationSeconds:
																			activePlan.lastModelParamsUsed
																				.durationSeconds,
																		generateAudio:
																			activePlan.lastModelParamsUsed
																				.generateAudio,
																		negativePrompt:
																			activePlan.lastModelParamsUsed
																				.negativePrompt,
																		cfgScale:
																			activePlan.lastModelParamsUsed.cfgScale,
																	}
																: videoConfig
														}
														warning={
															hasDivergence
																? "Current settings differ from this plan — generation uses the plan’s original settings."
																: undefined
														}
														className="min-h-11"
														disabled={anyBusy || !hasScenes(activePlan)}
														generating={videoBusy}
														triggerLabel="Generate video"
														onConfirm={onGenerateVideo}
													/>
													<VideoResult runId={runId} videos={videos} />
												</div>
											</div>
										) : null}
									</>
								)}
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

function hasScenes(plan: { videoScenes?: unknown[] } | undefined) {
	return Boolean(plan?.videoScenes?.length);
}

export { clearRunSearch };
