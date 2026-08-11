import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { GenerationStatus } from "#/components/studio/generation-status";
import { HistoryPanel } from "#/components/studio/history-panel";
import { ReferenceImagePanel } from "#/components/studio/reference-image-panel";
import { ShlokaComposer } from "#/components/studio/shloka-composer";
import { ShlokaPlanPreview } from "#/components/studio/shloka-plan-preview";
import { StudioErrorAlert } from "#/components/studio/studio-error-alert";
import { StudioShell } from "#/components/studio/studio-shell";
import {
	VideoConfiguration,
	type VideoConfigState,
} from "#/components/studio/video-configuration";
import { VideoModelSelector } from "#/components/studio/video-model-selector";
import { VideoResult } from "#/components/studio/video-result";
import { Button } from "#/components/ui/button";
import {
	MODEL_CAPABILITY_PROFILES,
	defaultVideoParams,
	type VideoModelId,
} from "#/lib/model-catalog";
import {
	studioRunSearchSchema,
	type StudioRunSearch,
} from "#/lib/studio-run-search";
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
	const [imageSize, setImageSize] = useState("1024x1536");
	const [imageQuality, setImageQuality] = useState("low");
	const [videoConfig, setVideoConfig] = useState<VideoConfigState>(
		defaultVideoParams("google/veo-3.1-lite"),
	);
	const [busyStage, setBusyStage] = useState<string | null>(null);

	const run = useQuery(api.studio.getRun, runId ? { runId } : "skip");
	const catalog = useQuery(api.studio.getCachedOpenRouterCatalog);
	const refreshCatalog = useAction(api.studioActions.refreshModelCatalog);

	const createDraft = useMutation(api.studio.createShlokaDraft);
	const updateDraft = useMutation(api.studio.updateDraft);
	const removeReferenceImage = useMutation(api.studio.removeReferenceImage);
	const generateUploadUrl = useMutation(api.studio.generateUploadUrl);
	const attachUploadedReferenceImage = useMutation(
		api.studio.attachUploadedReferenceImage,
	);
	const planRun = useAction(api.studioActions.planShlokaRun);
	const generateImage = useAction(api.studioActions.generateReferenceImage);
	const generateVideo = useAction(api.studioActions.generateVideoForRun);

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

	useEffect(() => {
		if (!runId) {
			setShlokaText("");
			setCustomInstructions("");
			setImageSize("1024x1536");
			setImageQuality("low");
			setVideoConfig(defaultVideoParams("google/veo-3.1-lite"));
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
		setImageSize(run.imageSize ?? "1024x1536");
		setImageQuality(run.imageQuality ?? "low");
		if (run.videoParams) {
			setVideoConfig({
				modelId: (run.selectedModelId as VideoModelId) ?? "google/veo-3.1-lite",
				aspectRatio: run.videoParams.aspectRatio,
				resolution: run.videoParams.resolution,
				durationSeconds: run.videoParams.durationSeconds,
				generateAudio: run.videoParams.generateAudio,
				negativePrompt: run.videoParams.negativePrompt,
				cfgScale: run.videoParams.cfgScale,
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [runId, run?._id, run === null]);

	const ensureRun = async () => {
		if (runId) {
			await updateDraft({
				runId,
				customInstructions,
				imageSize,
				imageQuality,
				selectedModelId: videoConfig.modelId,
				videoParams: videoConfig,
			});
			return runId;
		}
		const id = await createDraft({
			shlokaText,
			customInstructions,
		});
		setRunId(id);
		await updateDraft({
			runId: id,
			imageSize,
			imageQuality,
			selectedModelId: videoConfig.modelId,
			videoParams: videoConfig,
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
				generateUploadUrl,
				attachUploadedReferenceImage,
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

	const profile =
		MODEL_CAPABILITY_PROFILES[videoConfig.modelId as VideoModelId];

	const planReady =
		run?.status === "plan_ready" ||
		run?.status === "image_generating" ||
		run?.status === "image_ready" ||
		run?.status === "video_generating" ||
		run?.status === "completed" ||
		run?.status === "failed";

	const images = run?.referenceImages ?? [];
	const videos = run?.videos ?? [];
	const extraIds = run?.extraReferenceImageIds ?? [];

	return (
		<StudioShell
			activePath="/"
			history={
				<HistoryPanel
					to="/"
					provenance="shloka"
					selectedRunId={runId}
					onDeleted={(id) => {
						if (runId === id) {
							setRunId(null, true);
						}
					}}
				/>
			}
		>
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

				{run ? (
					<GenerationStatus status={run.status} warnings={run.warnings} />
				) : null}

				<ShlokaComposer
					shlokaText={shlokaText}
					customInstructions={customInstructions}
					onShlokaChange={setShlokaText}
					onInstructionsChange={setCustomInstructions}
					disabled={busyStage !== null}
				/>

				<div className="flex flex-wrap gap-3">
					<Button
						className="min-h-11"
						disabled={!shlokaText.trim() || busyStage !== null}
						onClick={onPlan}
					>
						{busyStage === "planning" ? "Planning…" : "Generate creative plan"}
					</Button>
				</div>

				{planReady ? (
					<div className="flex flex-col gap-4">
						<ShlokaPlanPreview
							imagePrompt={run?.imagePrompt}
							videoScenes={run?.videoScenes}
							plannerModel={run?.plannerModel}
							plannerReasoning={run?.plannerReasoning}
							onRegenerate={() => planRun({ runId: runId!, force: true })}
							regenerating={busyStage === "planning"}
						/>
						<StudioErrorAlert
							error={run?.lastError}
							title="Error (image / plan)"
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

				{planReady ? (
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
						<StudioErrorAlert
							error={run?.lastError}
							title="Error (video generation)"
						/>
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
								? "Generating video (OpenRouter poll)…"
								: "Generate video (append)"}
						</Button>
					</div>
				) : null}

				<VideoResult videos={videos} />
			</div>
		</StudioShell>
	);
}
