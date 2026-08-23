import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { AlertTriangle, Info, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { MessageResponse } from "#/components/ai-elements/message";
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
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Label } from "#/components/ui/label";
import { MarkdownTextarea } from "#/components/ui/markdown-textarea";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Spinner } from "#/components/ui/spinner";
import {
	useSignedMediaUrls,
	withSignedUrl,
} from "#/hooks/use-signed-media-urls";
import {
	defaultVideoParams,
	isVideoModelId,
	MODEL_CAPABILITY_PROFILES,
	PROMPT_METER_THRESHOLD_PERCENT,
	type VideoModelId,
} from "#/lib/model-catalog";
import type { StudioBusyStage } from "#/lib/studio-run-status";
import { notifyStudioError, notifyStudioSuccess } from "#/lib/studio-toast";
import { uploadReferenceImage } from "#/lib/upload-reference-image";
import { cn } from "#/lib/utils";

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
	const summarizeAction = useAction(
		api.studio.actions.summarizeModelStudioPrompt,
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

	// — Direct-stay character budgeting (no LLM summarizer here — raw provider call) —
	const promptLength = prompt.length;
	const promptTrimmedLength = prompt.trim().length;
	const promptLimit = profile.maxPromptChars;
	const promptRemaining = Math.max(0, promptLimit - promptTrimmedLength);
	const promptOverBy = Math.max(0, promptTrimmedLength - promptLimit);
	const promptPercent =
		promptLimit > 0 ? (promptTrimmedLength / promptLimit) * 100 : 0;
	const isPromptOverLimit = promptTrimmedLength > promptLimit;
	const isPromptNearLimit =
		!isPromptOverLimit && promptPercent >= PROMPT_METER_THRESHOLD_PERCENT;
	const promptLimitState: "ok" | "warn" | "over" = isPromptOverLimit
		? "over"
		: isPromptNearLimit
			? "warn"
			: "ok";
	const showPromptMeter =
		promptPercent >= PROMPT_METER_THRESHOLD_PERCENT && promptTrimmedLength > 0;

	// Manual summarizer (reuses luna compressor via convex/lib/promptSummarizer.ts)
	const [confirmSummarizeOpen, setConfirmSummarizeOpen] = useState(false);
	const [summarizerOpen, setSummarizerOpen] = useState(false);
	const [summarizerPhase, setSummarizerPhase] = useState<
		"loading" | "preview" | "error"
	>("loading");
	const [summarizedText, setSummarizedText] = useState<string | null>(null);
	const [summarizerMeta, setSummarizerMeta] = useState<{
		originalLength: number;
		summarizedLength: number;
	} | null>(null);
	const [summarizerError, setSummarizerError] = useState<string | null>(null);
	const [applyChoice, setApplyChoice] = useState<"yes" | "no">("no");

	const handleRequestSummarize = () => setConfirmSummarizeOpen(true);

	const handleConfirmSummarize = async () => {
		setConfirmSummarizeOpen(false);
		setSummarizerOpen(true);
		setSummarizerPhase("loading");
		setSummarizedText(null);
		setSummarizerMeta(null);
		setSummarizerError(null);
		setApplyChoice("no");
		try {
			const result = await summarizeAction({
				prompt,
				maxPromptChars: promptLimit,
			});
			setSummarizedText(result.summarized);
			setSummarizerMeta({
				originalLength: result.originalLength,
				summarizedLength: result.summarizedLength,
			});
			setSummarizerPhase("preview");
		} catch (error) {
			setSummarizerError(
				error instanceof Error ? error.message : "Summarization failed.",
			);
			setSummarizerPhase("error");
		}
	};

	const handleApplySummarized = () => {
		if (applyChoice !== "yes" || !summarizedText) {
			setSummarizerOpen(false);
			return;
		}
		const next = summarizedText;
		setPrompt(next);
		setSummarizerOpen(false);
		void updateDraft({ runId, prompt: next }).catch((error) =>
			notifyStudioError("Could not save summarized prompt", error),
		);
		notifyStudioSuccess(
			"Prompt replaced",
			`Compressed ${promptTrimmedLength.toLocaleString()} → ${next.trim().length.toLocaleString()} chars for ${profile.displayName}.`,
		);
	};

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
	const urlsByKey = useSignedMediaUrls(mediaObjectKeys);
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

	const anyBusy = busyStage !== null || run?.status === "generating";

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
						className={cn(
							"min-h-72 max-h-[60vh] resize-y overflow-y-auto",
							promptLimitState === "over" &&
								"border-destructive/60 focus-visible:border-destructive focus-visible:ring-destructive/40",
							promptLimitState === "warn" &&
								"border-amber-500/60 focus-visible:border-amber-500 focus-visible:ring-amber-500/30",
						)}
						disabled={anyBusy}
						maxLength={20_000}
						aria-describedby="model-studio-prompt-counter model-studio-prompt-limit-note"
						aria-invalid={isPromptOverLimit}
					/>
					<AnimatePresence initial={false}>
						{showPromptMeter ? (
							<motion.div
								key="prompt-meter"
								initial={{ opacity: 0, y: -8, height: 0 }}
								animate={{ opacity: 1, y: 0, height: "auto" }}
								exit={{ opacity: 0, y: -8, height: 0 }}
								transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
								className="flex flex-col gap-2 overflow-hidden"
							>
								{/* Character counter — sourced from MODEL_CAPABILITY_PROFILES.maxPromptChars */}
								<div
									id="model-studio-prompt-counter"
									className="flex flex-wrap items-center justify-between gap-2 text-xs"
								>
									<div className="flex items-center gap-2">
										<Badge
											variant={
												promptLimitState === "over"
													? "destructive"
													: promptLimitState === "warn"
														? "secondary"
														: "outline"
											}
											className={cn(
												"h-6 px-2 font-mono text-[11px] font-medium tabular-nums",
												promptLimitState === "warn" &&
													"border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
											)}
											aria-live="polite"
										>
											{promptTrimmedLength.toLocaleString()} /{" "}
											{promptLimit.toLocaleString()} chars
										</Badge>
										<span
											className={cn(
												"tabular-nums",
												promptLimitState === "over"
													? "font-medium text-destructive"
													: promptLimitState === "warn"
														? "font-medium text-amber-600 dark:text-amber-400"
														: "text-muted-foreground",
											)}
										>
											{isPromptOverLimit
												? `+${promptOverBy.toLocaleString()} over`
												: `${promptRemaining.toLocaleString()} remaining`}
											{" · "}
											{Math.round(promptPercent)}%
										</span>
									</div>
									<span
										id="model-studio-prompt-limit-note"
										className="flex items-center gap-1 text-muted-foreground"
									>
										<Info className="size-3 shrink-0" />
										<span>
											{profile.displayName} limit:{" "}
											{promptLimit.toLocaleString()} chars
										</span>
									</span>
								</div>
								{/* Thin progress bar */}
								<div
									className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
									role="progressbar"
									aria-valuenow={Math.min(100, Math.round(promptPercent))}
									aria-valuemin={0}
									aria-valuemax={100}
									aria-label="Prompt length"
								>
									<motion.div
										className={cn(
											"h-full",
											promptLimitState === "over"
												? "bg-destructive"
												: promptLimitState === "warn"
													? "bg-amber-500"
													: "bg-primary",
										)}
										initial={{ width: 0 }}
										animate={{ width: `${Math.min(100, promptPercent)}%` }}
										transition={{ duration: 0.35, ease: "easeOut" }}
									/>
								</div>
								<div className="flex justify-start pt-0.5">
									<Button
										variant="outline"
										size="sm"
										onClick={handleRequestSummarize}
										disabled={anyBusy || !prompt.trim()}
										className="h-8 gap-1.5 text-xs"
									>
										<Sparkles className="size-3.5" />
										Summarise Prompt to fit
									</Button>
								</div>
								<AnimatePresence initial={false}>
									{isPromptOverLimit ? (
										<motion.div
											key="over-alert"
											initial={{ opacity: 0, y: -6, scale: 0.98 }}
											animate={{ opacity: 1, y: 0, scale: 1 }}
											exit={{ opacity: 0, y: -6, scale: 0.98 }}
											transition={{ duration: 0.22, ease: "easeOut" }}
										>
											<Alert
												variant="destructive"
												className="border-destructive/40 bg-destructive/5 py-3"
											>
												<AlertTriangle className="size-4" />
												<AlertTitle className="text-sm">
													Prompt exceeds {profile.displayName} limit
												</AlertTitle>
												<AlertDescription className="text-xs leading-relaxed text-destructive/90">
													This prompt is{" "}
													<strong>
														{promptOverBy.toLocaleString()} characters
													</strong>{" "}
													over the {promptLimit.toLocaleString()}-character hard
													limit for{" "}
													<code className="rounded bg-destructive/10 px-1 py-0.5 font-mono text-[11px]">
														{selectedModel}
													</code>
													. Model Studio sends prompts <em>directly</em> to the
													provider (unlike Shloka Studio&apos;s automatic LLM
													summarizer). On generate the prompt will be{" "}
													<strong>auto-truncated</strong> at a word boundary and
													a warning will be saved with the clip — tail content
													will be lost. Shorten the prompt, or switch to a
													higher-limit model (e.g.{" "}
													<code className="font-mono text-[11px]">
														alibaba/wan-2.7
													</code>{" "}
													5,000 chars,{" "}
													<code className="font-mono text-[11px]">
														bytedance/seedance-2.x
													</code>{" "}
													4,000 chars).
												</AlertDescription>
											</Alert>
										</motion.div>
									) : null}
								</AnimatePresence>
							</motion.div>
						) : null}
					</AnimatePresence>
					{promptLength !== promptTrimmedLength && prompt.trim().length > 0 ? (
						<p className="text-[11px] leading-none text-muted-foreground">
							Trimmed length {promptTrimmedLength.toLocaleString()} chars is
							what the provider receives (leading/trailing whitespace stripped).
						</p>
					) : null}
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
					<AnimatePresence initial={false}>
						{isPromptOverLimit ? (
							<motion.div
								key="generate-truncate-warning"
								initial={{ opacity: 0, y: -6, height: 0 }}
								animate={{ opacity: 1, y: 0, height: "auto" }}
								exit={{ opacity: 0, y: -6, height: 0 }}
								transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
								className="overflow-hidden"
							>
								<Alert
									variant="destructive"
									className="border-amber-500/40 bg-amber-500/10 py-2.5 text-amber-800 dark:text-amber-200 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400"
								>
									<AlertTriangle className="size-4" />
									<AlertTitle className="text-xs font-semibold">
										Generate will truncate
									</AlertTitle>
									<AlertDescription className="text-xs leading-relaxed text-amber-700 dark:text-amber-300/90">
										Prompt is {promptOverBy.toLocaleString()} chars over the{" "}
										{promptLimit.toLocaleString()}-char limit for{" "}
										{profile.displayName}. The request will be sent truncated —
										last {promptOverBy.toLocaleString()} chars will be dropped
										at a word boundary.
									</AlertDescription>
								</Alert>
							</motion.div>
						) : null}
					</AnimatePresence>
					<VideoGenerateConfirm
						config={videoConfig}
						className="min-h-11"
						disabled={anyBusy || !prompt.trim()}
						generating={busyStage === "video"}
						triggerLabel={
							isPromptOverLimit ? "Generate (will truncate)" : "Generate video"
						}
						warning={
							isPromptOverLimit
								? `Prompt is ${promptOverBy.toLocaleString()} chars over the ${promptLimit.toLocaleString()}-char hard limit for ${profile.displayName} (${selectedModel}). It will be auto-truncated at a word boundary — tail content will be lost. Shorten the prompt or switch models to avoid truncation.`
								: undefined
						}
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

			{/* Step 1: confirm summarization (alert dialog with spinner concept gated here) */}
			<AlertDialog
				open={confirmSummarizeOpen}
				onOpenChange={setConfirmSummarizeOpen}
			>
				<AlertDialogContent size="default">
					<AlertDialogHeader>
						<AlertDialogMedia>
							<Sparkles className="size-8" />
						</AlertDialogMedia>
						<AlertDialogTitle>
							Summarise Under {promptLimit.toLocaleString()} chars?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Your prompt is {promptTrimmedLength.toLocaleString()} chars for{" "}
							{profile.displayName} ({promptLimit.toLocaleString()} max
							{isPromptOverLimit
								? `, ${promptOverBy.toLocaleString()} over`
								: `, ${Math.round(promptPercent)}% used`}
							). This will compress it with the same Luna summarizer used in
							Shloka Studio to fit the limit without losing key shots.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={() => void handleConfirmSummarize()}>
							Summarise
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Step 2: loading spinner → markdown preview with radio (default No) */}
			<Dialog open={summarizerOpen} onOpenChange={setSummarizerOpen}>
				<DialogContent className="flex max-h-[85vh] max-w-xl flex-col gap-4 overflow-hidden sm:max-w-xl [&>button]:shrink-0">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Sparkles className="size-4" />
							Summarized prompt
						</DialogTitle>
						<DialogDescription>
							{summarizerPhase === "loading"
								? `Compressing ${promptTrimmedLength.toLocaleString()} → ${promptLimit.toLocaleString()} chars for ${profile.displayName}…`
								: summarizerMeta
									? `${summarizerMeta.originalLength.toLocaleString()} → ${summarizerMeta.summarizedLength.toLocaleString()} chars · saved ${(summarizerMeta.originalLength - summarizerMeta.summarizedLength).toLocaleString()} chars`
									: `${promptLimit.toLocaleString()} char limit`}
						</DialogDescription>
					</DialogHeader>

					{summarizerPhase === "loading" ? (
						<div className="flex flex-col items-center justify-center gap-3 py-14">
							<Spinner className="size-8" />
							<p className="text-sm text-muted-foreground">Summarising…</p>
						</div>
					) : summarizerPhase === "error" ? (
						<Alert variant="destructive">
							<AlertTriangle className="size-4" />
							<AlertTitle>Summarization failed</AlertTitle>
							<AlertDescription className="text-xs">
								{summarizerError ?? "Could not compress the prompt."}
							</AlertDescription>
						</Alert>
					) : (
						<>
							<ScrollArea className="max-h-[50vh] min-h-[120px] shrink-0 overflow-auto rounded-lg border bg-muted/20 overscroll-contain">
								<div className="min-h-0 p-4">
									<MessageResponse className="prose prose-sm max-w-none text-sm leading-relaxed break-words prose-strong:font-semibold prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-xs dark:prose-invert">
										{summarizedText ?? ""}
									</MessageResponse>
								</div>
							</ScrollArea>

							<RadioGroup
								value={applyChoice}
								onValueChange={(value) => setApplyChoice(value as "yes" | "no")}
								className="gap-2"
							>
								<label
									htmlFor="summarizer-no"
									className={cn(
										"flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
										applyChoice === "no"
											? "border-primary bg-primary/5"
											: "border-border/70 hover:bg-muted/40",
									)}
								>
									<RadioGroupItem value="no" id="summarizer-no" />
									<span className="flex flex-col gap-0.5">
										<span className="text-sm font-medium">
											No, keep original
										</span>
										<span className="text-xs text-muted-foreground">
											Keep your current prompt unchanged.
										</span>
									</span>
								</label>
								<label
									htmlFor="summarizer-yes"
									className={cn(
										"flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
										applyChoice === "yes"
											? "border-primary bg-primary/5"
											: "border-border/70 hover:bg-muted/40",
									)}
								>
									<RadioGroupItem value="yes" id="summarizer-yes" />
									<span className="flex flex-col gap-0.5">
										<span className="text-sm font-medium">
											Yes, replace my prompt
										</span>
										<span className="text-xs text-muted-foreground">
											Replace the editor with the summarized version (
											{summarizerMeta?.summarizedLength.toLocaleString()}{" "}
											chars).
										</span>
									</span>
								</label>
							</RadioGroup>
						</>
					)}

					<DialogFooter>
						<Button variant="outline" onClick={() => setSummarizerOpen(false)}>
							Cancel
						</Button>
						{summarizerPhase === "preview" ? (
							<Button
								onClick={handleApplySummarized}
								disabled={applyChoice !== "yes" || !summarizedText}
							>
								Replace prompt
							</Button>
						) : summarizerPhase === "error" ? (
							<Button
								variant="outline"
								onClick={() => {
									setSummarizerOpen(false);
									setConfirmSummarizeOpen(true);
								}}
							>
								Try again
							</Button>
						) : null}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
