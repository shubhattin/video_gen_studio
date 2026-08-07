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
import { StudioShell } from "#/components/studio/studio-shell";
import { VideoConfiguration, type VideoConfigState } from "#/components/studio/video-configuration";
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
	VIDEO_MODEL_IDS,
	MODEL_CAPABILITY_PROFILES,
	defaultVideoParams,
	type VideoModelId,
} from "#/lib/model-catalog";

export const Route = createFileRoute("/")({
	component: ShlokaStudioPage,
});

function ShlokaStudioPage() {
	const [runId, setRunId] = useState<Id<"generationRuns"> | null>(null);
	const [shlokaText, setShlokaText] = useState("");
	const [customInstructions, setCustomInstructions] = useState("");
	const [imageSize, setImageSize] = useState("1024x1536");
	const [imageQuality, setImageQuality] = useState("medium");
	const [videoConfig, setVideoConfig] = useState<VideoConfigState>(
		defaultVideoParams("google/veo-3.1-generate-001"),
	);
	const [busyStage, setBusyStage] = useState<string | null>(null);

	const run = useQuery(
		api.studio.getRun,
		runId ? { runId } : "skip",
	);

	const createDraft = useMutation(api.studio.createShlokaDraft);
	const updateDraft = useMutation(api.studio.updateDraft);
	const createImageRevision = useMutation(api.studio.createImageRevision);
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
		setImageQuality(run.imageQuality ?? "medium");
		if (run.videoParams) {
			setVideoConfig({
				modelId: (run.selectedModelId as VideoModelId) ?? videoConfig.modelId,
				aspectRatio: run.videoParams.aspectRatio,
				resolution: run.videoParams.resolution,
				durationSeconds: run.videoParams.durationSeconds,
				generateAudio: run.videoParams.generateAudio,
				negativePrompt: run.videoParams.negativePrompt,
				klingMode: run.videoParams.klingMode as "std" | "pro" | undefined,
			});
		}
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
		return id;
	};

	const onPlan = async () => {
		setBusyStage("planning");
		try {
			const id = await ensureRun();
			await planRun({ runId: id });
		} finally {
			setBusyStage(null);
		}
	};

	const onGenerateImage = async (force = false) => {
		setBusyStage("image");
		try {
			const id = await ensureRun();
			await generateImage({ runId: id, force });
		} finally {
			setBusyStage(null);
		}
	};

	const onGenerateVideo = async () => {
		setBusyStage("video");
		try {
			const id = await ensureRun();
			await generateVideo({ runId: id });
		} finally {
			setBusyStage(null);
		}
	};

	const onNewImageRevision = async () => {
		if (!runId) {
			return;
		}
		setBusyStage("revision");
		try {
			const revisionId = await createImageRevision({ parentRunId: runId });
			setRunId(revisionId);
			await generateImage({ runId: revisionId, force: true });
		} finally {
			setBusyStage(null);
		}
	};

	const planReady =
		run?.status === "plan_ready" ||
		run?.status === "image_generating" ||
		run?.status === "image_ready" ||
		run?.status === "video_generating" ||
		run?.status === "completed" ||
		run?.status === "failed";

	const imageReady =
		run?.status === "image_ready" ||
		run?.status === "video_generating" ||
		run?.status === "completed";

	return (
		<StudioShell
			activePath="/"
			sidebar={
				<HistoryPanel
					selectedRunId={runId}
					onSelect={(id) => setRunId(id)}
				/>
			}
		>
			<div className="space-y-8 rounded-2xl border border-border/80 bg-card p-5 sm:p-8">
				<section className="space-y-2">
					<h1 className="font-heading text-2xl font-semibold">
						Shloka Video Generator
					</h1>
					<p className="text-sm text-muted-foreground">
						Plan → reference still → model-specific video. Default path is 9:16
						portrait for shorts.
					</p>
				</section>

				{run ? (
					<GenerationStatus
						status={run.status}
						lastError={run.lastError}
						warnings={run.warnings}
					/>
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
					<ShlokaPlanPreview
						imagePrompt={run?.imagePrompt}
						videoScenes={run?.videoScenes}
						plannerModel={run?.plannerModel}
						plannerReasoning={run?.plannerReasoning}
						onRegenerate={() => planRun({ runId: runId!, force: true })}
						regenerating={busyStage === "planning"}
					/>
				) : null}

				{planReady ? (
					<ReferenceImagePanel
						imageSize={imageSize}
						imageQuality={imageQuality}
						onSizeChange={setImageSize}
						onQualityChange={setImageQuality}
						onGenerate={() => onGenerateImage()}
						onRegenerate={onNewImageRevision}
						generating={busyStage === "image" || busyStage === "revision"}
						referenceImageUrl={run?.referenceImageUrl}
						revisedPrompt={run?.revisedImagePrompt}
						disabled={busyStage !== null}
					/>
				) : null}

				{imageReady || run?.provenance === "shloka" ? (
					<div className="space-y-4 border-t border-border/80 pt-6">
						<div className="space-y-2">
							<h2 className="font-heading text-xl font-semibold">Video model</h2>
							<Select
								value={videoConfig.modelId}
								onValueChange={(modelId) =>
									setVideoConfig({
										...defaultVideoParams(modelId as VideoModelId),
									})
								}
								disabled={busyStage !== null}
							>
								<SelectTrigger className="min-h-11">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{VIDEO_MODEL_IDS.map((modelId) => (
										<SelectItem key={modelId} value={modelId}>
											{modelId}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<VideoConfiguration
							value={videoConfig}
							onChange={setVideoConfig}
							disabled={busyStage !== null}
						/>
						<Button
							className="min-h-11"
							disabled={
								busyStage !== null ||
								(MODEL_CAPABILITY_PROFILES[
									videoConfig.modelId as VideoModelId
								].requiresFirstFrame &&
									!run?.referenceImageStorageId)
							}
							onClick={onGenerateVideo}
						>
							{busyStage === "video" ? "Generating video…" : "Generate video"}
						</Button>
					</div>
				) : null}

				<VideoResult
					videoUrl={run?.videoUrl}
					mimeType={run?.videoMeta?.mimeType}
					durationSeconds={run?.videoMeta?.durationSeconds}
					gatewayGenerationId={run?.gatewayGenerationId}
					actualCostUsd={run?.actualCostUsd}
					warnings={run?.warnings}
				/>
			</div>
		</StudioShell>
	);
}
