import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { AutosaveStatus } from "#/components/studio/shell/autosave-status";
import { GenerationProgressDock } from "#/components/studio/video/generation-progress-dock";
import { ReferenceImagePanel } from "#/components/studio/video/reference-image-panel";
import {
	type VideoConfigState,
	VideoConfiguration,
} from "#/components/studio/video/video-configuration";
import { VideoGenerateConfirm } from "#/components/studio/video/video-generate-confirm";
import { VideoModelSelector } from "#/components/studio/video/video-model-selector";
import { VideoResult } from "#/components/studio/video/video-result";
import { Label } from "#/components/ui/label";
import { MarkdownTextarea } from "#/components/ui/markdown-textarea";
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
	runId: Id<"modelStudioRuns">;
	onRunIdChange?: (runId: Id<"modelStudioRuns">) => void;
};

/**
 * Direct-to-API video generation: a raw prompt, model settings, reference
 * images, and an append-only list of generated clips. No planner involved.
 */
export function ModelStudio({ runId }: ModelStudioProps) {
	const run = useQuery(api.studio.queries.getModelStudioRun, { runId });
	const catalog = useQuery(api.studio.queries.getCachedOpenRouterCatalog);
	const refreshCatalog = useAction(api.studio.actions.refreshModelCatalog);

	const updateDraft = useMutation(api.studio.mutations.updateModelStudioDraft);
	const removeReferenceImage = useMutation(
		api.studio.mutations.removeModelStudioReferenceImage,
	);
	const attachImage = useMutation(
		api.studio.mutations.attachImageToModelStudioRun,
	);
	const prepareUpload = useAction(
		api.studio.r2.prepareModelStudioReferenceImageUpload,
	);
	const finalizeUpload = useAction(
		api.studio.r2.finalizeModelStudioReferenceImageUpload,
	);
	const generateImageAction = useAction(
		api.studio.actions.generateModelStudioImage,
	);
	const generateVideoAction = useAction(
		api.studio.actions.generateModelStudioVideo,
	);

	const [prompt, setPrompt] = useState("");
	const [selectedModel, setSelectedModel] = useState<VideoModelId>(
		"bytedance/seedance-2.5",
	);
	const [videoConfig, setVideoConfig] = useState<VideoConfigState>(() =>
		defaultVideoParams("bytedance/seedance-2.5"),
	);
	const [imageSize, setImageSize] = useState("1024x1536");
	const [imageQuality, setImageQuality] = useState("medium");
	const [busyStage, setBusyStage] = useState<StudioBusyStage>(null);

	const profile = MODEL_CAPABILITY_PROFILES[selectedModel];

	useEffect(() => {
		if (!catalog) {
			refreshCatalog({}).catch(() => undefined);
		}
	}, [catalog, refreshCatalog]);

	// Hydrate local state when the selected run changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: Hydrate only when run changes.
	useEffect(() => {
		if (!run) return;
		const modelId = isVideoModelId(run.selectedModelId ?? "")
			? (run.selectedModelId as VideoModelId)
			: "bytedance/seedance-2.5";
		setSelectedModel(modelId);
		setPrompt(run.prompt ?? "");
		setImageSize(run.imageSize ?? "1024x1536");
		setImageQuality(run.imageQuality ?? "medium");
		setVideoConfig({
			...defaultVideoParams(modelId),
			...(run.videoParams ?? {}),
			modelId,
			prompt: undefined,
		} as VideoConfigState);
	}, [run?._id]);

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

	const rawImages = (run?.images ?? []) as Array<{
		id: string;
		objectKey?: string;
		source?: "generated" | "uploaded" | "terminal_frame";
		revisedImagePrompt?: string;
		createdAt: number;
		meta?: { width?: number; height?: number };
	}>;
	const rawVideos = (run?.videos ?? []) as Array<{
		id: string;
		objectKey?: string;
		createdAt: number;
	}>;
	const mediaObjectKeys = [
		...rawImages.map((image) => image.objectKey),
		...rawVideos.map((video) => video.objectKey),
	];
	const urlsByKey = useSignedMediaUrls(null, mediaObjectKeys);
	const images = rawImages.map((image) => withSignedUrl(image, urlsByKey));
	const videos = rawVideos.map((video) => withSignedUrl(video, urlsByKey));

	const extraIds = (run?.extraReferenceImageIds ?? []) as Id<"galleryImages">[];

	const persistPrompt = (value: string) => {
		void updateDraft({ runId, prompt: value }).catch((error) =>
			notifyStudioError("Could not save prompt", error),
		);
	};

	const onPromptChange = (value: string) => {
		setPrompt(value);
	};

	const commitPrompt = () => {
		persistPrompt(prompt);
	};

	const onModelChange = (modelId: VideoModelId) => {
		const next = defaultVideoParams(modelId);
		setSelectedModel(modelId);
		setVideoConfig(next);
		void updateDraft({
			runId,
			selectedModelId: modelId,
			videoParams: { ...next, modelId },
		}).catch((error) => notifyStudioError("Could not save settings", error));
	};

	const onVideoConfigChange = (next: VideoConfigState) => {
		setVideoConfig(next);
		void updateDraft({
			runId,
			videoParams: { ...next, modelId: selectedModel },
		}).catch((error) => notifyStudioError("Could not save settings", error));
	};

	const onGenerateImage = async () => {
		setBusyStage("image");
		try {
			await generateImageAction({ runId });
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
			await uploadReferenceImage({
				runId,
				file,
				prepareUpload,
				finalizeUpload,
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
			await updateDraft({
				runId,
				prompt,
				selectedModelId: selectedModel,
				videoParams: { ...videoConfig, modelId: selectedModel },
			});
			await generateVideoAction({ runId });
			notifyStudioSuccess("Video clip saved", "Added to this run.");
		} catch (error) {
			notifyStudioError("Video generation failed", error);
		} finally {
			setBusyStage(null);
		}
	};

	const anyBusy = busyStage !== null;

	return (
		<>
			<div className="space-y-6">
				<div className="flex items-start justify-end">
					<AutosaveStatus
						status={anyBusy ? "saving" : "idle"}
						hasPending={false}
						onRetry={() => undefined}
						className="pt-1"
					/>
				</div>

				<section className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<Label
							htmlFor="model-studio-prompt"
							className="text-sm font-medium"
						>
							Video prompt
						</Label>
						<span className="text-xs text-muted-foreground">
							Sent directly to the provider
						</span>
					</div>
					<MarkdownTextarea
						id="model-studio-prompt"
						value={prompt}
						onChange={(event) => onPromptChange(event.target.value)}
						onBlur={commitPrompt}
						placeholder="Describe the shot: subject, action, scene, style, camera, audio…"
						className="min-h-72 max-h-[60vh] resize-y overflow-y-auto"
						disabled={anyBusy}
					/>
				</section>

				<div className="flex flex-col gap-3 border-t border-border/80 pt-5">
					<div className="flex flex-col gap-1.5">
						<h2 className="font-heading text-lg font-semibold">
							Video model &amp; settings
						</h2>
						<p className="text-sm text-muted-foreground">
							Pick a model and tune the generation settings.
						</p>
					</div>
					<VideoModelSelector
						value={selectedModel}
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
				</div>

				<ReferenceImagePanel
					runId={null}
					imageSize={imageSize}
					imageQuality={imageQuality}
					onSizeChange={(value) => {
						setImageSize(value);
						void updateDraft({ runId, imageSize: value }).catch(
							() => undefined,
						);
					}}
					onQualityChange={(value) => {
						setImageQuality(value);
						void updateDraft({ runId, imageQuality: value }).catch(
							() => undefined,
						);
					}}
					onGenerate={() => void onGenerateImage()}
					onUpload={(file) => onUploadImage(file)}
					onReuseImage={async (imageId) => {
						await attachImage({
							runId,
							imageId: imageId as Id<"galleryImages">,
						});
						notifyStudioSuccess(
							"Image attached",
							"Reused from the shared gallery.",
						);
					}}
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
					globalBusy={anyBusy}
					onSelectFirstFrame={(id) => {
						const imageId = id as Id<"galleryImages"> | null;
						void updateDraft({
							runId,
							firstFrameImageId: imageId,
							lastFrameImageId:
								imageId && run?.lastFrameImageId === imageId
									? null
									: (run?.lastFrameImageId ?? null),
							extraReferenceImageIds:
								imageId && extraIds.includes(imageId)
									? extraIds.filter((item) => item !== imageId)
									: extraIds,
						}).catch((error) =>
							notifyStudioError("Could not save selection", error),
						);
					}}
					onSelectLastFrame={(id) => {
						const imageId = id as Id<"galleryImages"> | null;
						void updateDraft({
							runId,
							lastFrameImageId: imageId,
							firstFrameImageId:
								imageId && run?.firstFrameImageId === imageId
									? null
									: (run?.firstFrameImageId ?? null),
							extraReferenceImageIds:
								imageId && extraIds.includes(imageId)
									? extraIds.filter((item) => item !== imageId)
									: extraIds,
						}).catch((error) =>
							notifyStudioError("Could not save selection", error),
						);
					}}
					onToggleExtraReference={(id) => {
						const imageId = id as Id<"galleryImages">;
						const adding = !extraIds.includes(imageId);
						const next = adding
							? [...extraIds, imageId]
							: extraIds.filter((item) => item !== imageId);
						void updateDraft({
							runId,
							extraReferenceImageIds: next,
							firstFrameImageId:
								adding && run?.firstFrameImageId === imageId
									? null
									: (run?.firstFrameImageId ?? null),
							lastFrameImageId:
								adding && run?.lastFrameImageId === imageId
									? null
									: (run?.lastFrameImageId ?? null),
						}).catch((error) =>
							notifyStudioError("Could not save selection", error),
						);
					}}
					onRemoveImage={async (id) => {
						await removeReferenceImage({
							runId,
							imageId: id as Id<"galleryImages">,
						});
					}}
				/>

				<div className="flex flex-col gap-3 border-t border-border/80 pt-5">
					<h2 className="font-heading text-lg font-semibold">Generate video</h2>
					<VideoGenerateConfirm
						config={videoConfig}
						className="min-h-11"
						disabled={anyBusy || !prompt.trim()}
						generating={busyStage === "video"}
						triggerLabel="Generate video"
						onConfirm={() => void onGenerateVideo()}
					/>
					<VideoResult runId={null} videos={videos} />
				</div>
			</div>
			<GenerationProgressDock
				status={
					run?.status === "generating"
						? (busyStage ?? "video_generating")
						: run?.status === "completed"
							? "completed"
							: run?.status === "failed"
								? "failed"
								: "draft"
				}
				busyStage={busyStage}
				warnings={run?.warnings}
				contextLabel={profile?.displayName ?? null}
			/>
		</>
	);
}
