import { createFileRoute } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
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
import { VideoResult } from "#/components/studio/video-result";
import { Button } from "#/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import {
	MODEL_CAPABILITY_PROFILES,
	VIDEO_MODEL_IDS,
	defaultVideoParams,
	type VideoModelId,
} from "#/lib/model-catalog";
import { notifyStudioError, notifyStudioSuccess } from "#/lib/studio-toast";

export const Route = createFileRoute("/")({
	component: ShlokaStudioPage,
});

function ShlokaStudioPage() {
	const [runId, setRunId] = useState<Id<"generationRuns"> | null>(null);
	const [shlokaText, setShlokaText] = useState("");
	const [customInstructions, setCustomInstructions] = useState("");
	const [imageSize, setImageSize] = useState("1024x1536");
	const [imageQuality, setImageQuality] = useState("low");
	const [videoConfig, setVideoConfig] = useState<VideoConfigState>(
		defaultVideoParams("google/veo-3.1-lite"),
	);
	const [busyStage, setBusyStage] = useState<string | null>(null);

	const run = useQuery(api.studio.getRun, runId ? { runId } : "skip");

	const createDraft = useMutation(api.studio.createShlokaDraft);
	const updateDraft = useMutation(api.studio.updateDraft);
	const removeReferenceImage = useMutation(api.studio.removeReferenceImage);
	const planRun = useAction(api.studioActions.planShlokaRun);
	const generateImage = useAction(api.studioActions.generateReferenceImage);
	const generateVideo = useAction(api.studioActions.generateVideoForRun);

	useEffect(() => {
		if (!run) {
			return;
		}
		setShlokaText(run.shlokaText ?? "");
		setCustomInstructions(run.customInstructions ?? "");
		setImageSize(run.imageSize ?? "1024x1536");
		setImageQuality(run.imageQuality ?? "low");
		if (run.videoParams) {
			setVideoConfig({
				modelId: (run.selectedModelId as VideoModelId) ?? videoConfig.modelId,
				aspectRatio: run.videoParams.aspectRatio,
				resolution: run.videoParams.resolution,
				durationSeconds: run.videoParams.durationSeconds,
				generateAudio: run.videoParams.generateAudio,
				negativePrompt: run.videoParams.negativePrompt,
				cfgScale: run.videoParams.cfgScale,
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [run?._id]);

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
			sidebar={
				<HistoryPanel
					selectedRunId={runId}
					onSelect={(id) => setRunId(id)}
					onDeleted={(id) => {
						if (runId === id) {
							setRunId(null);
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
							generating={busyStage === "image"}
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
						<div className="space-y-2">
							<h2 className="font-heading text-xl font-semibold">
								Video model
							</h2>
							<Select
								value={videoConfig.modelId}
								onValueChange={(modelId) => {
									if (!modelId) return;
									setVideoConfig({
										...defaultVideoParams(modelId as VideoModelId),
									});
								}}
								disabled={busyStage !== null}
							>
								<SelectTrigger className="min-h-11 w-full min-w-0 sm:min-w-[28rem] md:min-w-[36rem]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent className="min-w-[var(--anchor-width)] w-[var(--anchor-width)]">
									{VIDEO_MODEL_IDS.map((modelId) => (
										<SelectItem key={modelId} value={modelId}>
											{MODEL_CAPABILITY_PROFILES[modelId].displayName} ·{" "}
											{modelId}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
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
