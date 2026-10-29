import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioBriefComposer } from "#/components/studio/audio/audio-brief-composer";
import { AudioConfiguration } from "#/components/studio/audio/audio-configuration";
import { AudioGenerateConfirm } from "#/components/studio/audio/audio-generate-confirm";
import { AudioModelSelector } from "#/components/studio/audio/audio-model-selector";
import {
	type AudioReferenceImage,
	AudioReferenceImages,
} from "#/components/studio/audio/audio-reference-images";
import { AudioScriptPanel } from "#/components/studio/audio/audio-script-panel";
import {
	AudioTakeCard,
	type AudioTakeItem,
} from "#/components/studio/audio/audio-take-card";
import { RegenerateNotice } from "#/components/studio/revisions/regenerate-notice";
import { RevisePopover } from "#/components/studio/revisions/revise-popover";
import {
	RevisionNote,
	RevisionSwitcher,
	revisionSuffix,
} from "#/components/studio/revisions/revision-switcher";
import { AutosaveStatus } from "#/components/studio/shell/autosave-status";
import { GenerationProgressDock } from "#/components/studio/video/generation-progress-dock";
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
import { Label } from "#/components/ui/label";
import { MarkdownTextarea } from "#/components/ui/markdown-textarea";
import type { RunAutosaveStatus } from "#/hooks/use-run-autosave";
import {
	useSignedMediaUrls,
	withSignedUrl,
} from "#/hooks/use-signed-media-urls";
import {
	AUDIO_MODEL_PROFILES,
	type AudioModelId,
	type AudioParams,
	type AudioScript,
	buildAudioProviderPrompt,
	DEFAULT_AUDIO_MODEL_ID,
	defaultAudioParams,
	isAudioModelId,
	resolveAudioParams,
} from "#/lib/audio-catalog";
import type {
	PlannerPromptSelection,
	SystemPromptTemplate,
} from "#/lib/planner-prompt";
import { notifyStudioError, notifyStudioSuccess } from "#/lib/studio-toast";
import { uploadReferenceImage } from "#/lib/upload-reference-image";

type BusyStage = "script" | "revise" | "audio" | "upload" | null;

type TextPatch = {
	prompt?: string;
	customInstructions?: string;
};

const TEXT_SAVE_DEBOUNCE_MS = 900;

/** Fields in the script's params that change what the scripter writes. */
function scriptDivergence(
	used: AudioParams | undefined,
	current: AudioParams,
): string[] {
	if (!used) return [];
	const usedProfile = isAudioModelId(used.modelId)
		? AUDIO_MODEL_PROFILES[used.modelId]
		: undefined;
	const currentProfile = isAudioModelId(current.modelId)
		? AUDIO_MODEL_PROFILES[current.modelId]
		: undefined;
	const fields: string[] = [];
	if (used.modelId !== current.modelId) {
		fields.push(
			`model (written for ${usedProfile?.displayName ?? used.modelId})`,
		);
	}
	if (
		currentProfile?.supportsTargetDuration &&
		used.targetDurationSeconds !== current.targetDurationSeconds
	) {
		fields.push("target length");
	}
	if (Boolean(used.instrumental) !== Boolean(current.instrumental)) {
		fields.push("instrumental");
	}
	return fields;
}

type AudioStudioProps = {
	runId: Id<"audioRuns">;
};

/**
 * Audio run workspace. Guided runs: instructions → Opus song script → takes.
 * Direct runs: raw prompt → takes. Both share model settings, reference
 * images, and the take list.
 */
export function AudioStudio({ runId }: AudioStudioProps) {
	const run = useQuery(api.audio.queries.getAudioRun, { runId });
	const guided = run?.mode === "guided";
	const templates = useQuery(
		api.studio.queries.listSystemPromptTemplates,
		guided ? { kind: "audio" } : "skip",
	) as SystemPromptTemplate[] | undefined;

	const updateRun = useMutation(api.audio.mutations.updateAudioRun);
	const updateScript = useMutation(api.audio.mutations.updateAudioScript);
	const selectRevision = useMutation(
		api.audio.mutations.selectAudioScriptRevision,
	).withOptimisticUpdate((localStore, args) => {
		const current = localStore.getQuery(api.audio.queries.getAudioRun, {
			runId: args.runId,
		});
		const revision = current?.scriptRevisions[args.revisionIndex];
		if (!current || !revision) return;
		localStore.setQuery(
			api.audio.queries.getAudioRun,
			{ runId: args.runId },
			{
				...current,
				activeScriptRevisionIndex: args.revisionIndex,
				activeScriptRevision: revision,
			},
		);
	});
	const attachImage = useMutation(api.audio.mutations.attachImageToAudioRun);
	const removeImage = useMutation(
		api.audio.mutations.removeAudioRunReferenceImage,
	);
	const scriptAction = useAction(api.audio.actions.scriptAudioRun);
	const reviseAction = useAction(api.audio.actions.reviseAudioScript);
	const generateAction = useAction(api.audio.actions.generateAudioForRun);
	const prepareUpload = useAction(
		api.studio.r2.prepareAudioReferenceImageUpload,
	);
	const finalizeUpload = useAction(
		api.studio.r2.finalizeAudioReferenceImageUpload,
	);

	const [prompt, setPrompt] = useState("");
	const [customInstructions, setCustomInstructions] = useState("");
	const [promptSelection, setPromptSelection] =
		useState<PlannerPromptSelection | null>(null);
	const [params, setParams] = useState<AudioParams>(() =>
		defaultAudioParams(DEFAULT_AUDIO_MODEL_ID),
	);
	const [busyStage, setBusyStage] = useState<BusyStage>(null);
	const [saveStatus, setSaveStatus] = useState<RunAutosaveStatus>("idle");

	// ── Hydrate local state when the run changes ─────────────────────────
	// biome-ignore lint/correctness/useExhaustiveDependencies: hydrate only when the selected run changes.
	useEffect(() => {
		if (!run) return;
		setPrompt(run.prompt ?? "");
		setCustomInstructions(run.customInstructions ?? "");
		// Runs saved on a removed model (GPT Audio) fall back to the default.
		const resolved = resolveAudioParams(run.audioParams);
		setParams(resolved);
		if (resolved.modelId !== run.audioParams.modelId) {
			void updateRun({ runId, audioParams: resolved }).catch(() => undefined);
		}
		setBusyStage(null);
		setSaveStatus("idle");
	}, [run?._id]);

	// Keep the template selection in sync (drop dangling template ids).
	const serverSelection = (run?.promptSelection ??
		null) as PlannerPromptSelection | null;
	const serverSelectionKey = serverSelection
		? serverSelection.kind === "template"
			? serverSelection.templateId
			: "default"
		: null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the selection identity, not the object.
	useEffect(() => {
		const dangling =
			serverSelection?.kind === "template" &&
			templates !== undefined &&
			!templates.some(
				(template) => template._id === serverSelection.templateId,
			);
		setPromptSelection(dangling ? null : serverSelection);
	}, [runId, serverSelectionKey, templates]);

	// ── Debounced text autosave ──────────────────────────────────────────
	const pendingText = useRef<TextPatch>({});
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const flushText = useCallback(async () => {
		if (saveTimer.current) {
			clearTimeout(saveTimer.current);
			saveTimer.current = null;
		}
		const patch = pendingText.current;
		if (Object.keys(patch).length === 0) return;
		pendingText.current = {};
		setSaveStatus("saving");
		try {
			await updateRun({ runId, ...patch });
			setSaveStatus("saved");
		} catch (error) {
			pendingText.current = { ...patch, ...pendingText.current };
			setSaveStatus("error");
			notifyStudioError("Could not save draft", error);
		}
	}, [runId, updateRun]);

	useEffect(
		() => () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
		},
		[],
	);

	const queueText = (patch: TextPatch) => {
		pendingText.current = { ...pendingText.current, ...patch };
		if (saveTimer.current) clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => {
			void flushText();
		}, TEXT_SAVE_DEBOUNCE_MS);
	};

	const saveNow = async (patch: {
		promptSelection?: PlannerPromptSelection | null;
		audioParams?: AudioParams;
	}) => {
		setSaveStatus("saving");
		try {
			await updateRun({ runId, ...patch });
			setSaveStatus("saved");
		} catch (error) {
			setSaveStatus("error");
			notifyStudioError("Could not save settings", error);
		}
	};

	// ── Media ────────────────────────────────────────────────────────────
	const rawImages = (run?.images ?? []) as AudioReferenceImage[];
	const rawTakes = (run?.audios ?? []) as AudioTakeItem[];
	const { urls, pendingKeys } = useSignedMediaUrls([
		...rawImages.map((image) => image.objectKey),
		...rawTakes.map((take) => take.objectKey),
	]);
	const images = rawImages.map((image) => withSignedUrl(image, urls));
	const takes = rawTakes.map((take) => withSignedUrl(take, urls));

	const profile =
		AUDIO_MODEL_PROFILES[params.modelId as AudioModelId] ??
		AUDIO_MODEL_PROFILES[DEFAULT_AUDIO_MODEL_ID];
	const scriptRevisions = run?.scriptRevisions ?? [];
	const revisionIndex = run?.activeScriptRevisionIndex ?? null;
	const activeRevision = run?.activeScriptRevision ?? null;
	const script: AudioScript | undefined = activeRevision?.script;
	const providerPrompt = useMemo(
		() => (script ? buildAudioProviderPrompt(script, params) : ""),
		[script, params],
	);
	const divergence = useMemo(
		() =>
			script ? scriptDivergence(activeRevision?.scriptParamsUsed, params) : [],
		[script, activeRevision?.scriptParamsUsed, params],
	);

	const runBusy = run?.status === "scripting" || run?.status === "generating";
	const anyBusy = busyStage !== null || runBusy;

	// ── Handlers ─────────────────────────────────────────────────────────
	const onModelChange = (modelId: AudioModelId) => {
		// Fresh model defaults, but keep the user's length / vocals choices.
		const base = defaultAudioParams(modelId);
		const next: AudioParams = {
			...base,
			targetDurationSeconds:
				base.targetDurationSeconds === undefined
					? undefined
					: (params.targetDurationSeconds ?? base.targetDurationSeconds),
			instrumental:
				base.instrumental === undefined
					? undefined
					: params.instrumental === true,
		};
		setParams(next);
		void saveNow({ audioParams: next });
	};

	const onParamsChange = (next: AudioParams) => {
		setParams(next);
		void saveNow({ audioParams: next });
	};

	const onWriteScript = async () => {
		setBusyStage("script");
		try {
			await flushText();
			await scriptAction({ runId });
			notifyStudioSuccess(
				"Song script ready",
				"Review it, then generate audio.",
			);
		} catch (error) {
			notifyStudioError("Script generation failed", error);
		} finally {
			setBusyStage(null);
		}
	};

	const onRevise = async (request: string) => {
		if (revisionIndex === null) return false;
		setBusyStage("revise");
		try {
			await flushText();
			await reviseAction({
				runId,
				baseRevisionIndex: revisionIndex,
				prompt: request,
			});
			notifyStudioSuccess(
				"Script revised",
				`Revision ${scriptRevisions.length + 1} is ready.`,
			);
			return true;
		} catch (error) {
			notifyStudioError("Revision failed", error);
			return false;
		} finally {
			setBusyStage(null);
		}
	};

	const onSelectRevision = (index: number) => {
		selectRevision({ runId, revisionIndex: index }).catch((error) =>
			notifyStudioError("Could not switch revision", error),
		);
	};

	const onGenerate = async () => {
		setBusyStage("audio");
		try {
			await flushText();
			await generateAction({
				runId,
				scriptRevisionIndex: guided ? (revisionIndex ?? undefined) : undefined,
			});
			notifyStudioSuccess("Audio take saved", "Added to this run.");
		} catch (error) {
			notifyStudioError("Audio generation failed", error);
		} finally {
			setBusyStage(null);
		}
	};

	const onUpload = async (file: File) => {
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

	if (!run) {
		return null;
	}

	const canWriteScript = Boolean(customInstructions.trim() && promptSelection);
	const canGenerate = guided ? Boolean(script) : Boolean(prompt.trim());

	const regenerateControl = (
		<AlertDialog>
			<AlertDialogTrigger
				render={
					<Button
						variant="outline"
						className="min-h-11"
						disabled={anyBusy || !canWriteScript}
					/>
				}
			>
				Regenerate
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Regenerate the song script?</AlertDialogTitle>
					<AlertDialogDescription>
						This overwrites the current script (including your edits) using the
						instructions and settings above. Existing takes are kept.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<RegenerateNotice
					revisionCount={scriptRevisions.length}
					reviseLabel="Revise script"
					freshStart="For a fresh script that keeps this one, start a new Sanskrit Song Studio run."
				/>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={() => void onWriteScript()}>
						Regenerate
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);

	const revising = busyStage === "revise";
	const scripting =
		busyStage === "script" || revising || run.status === "scripting";
	const scriptSourceLabel =
		script && revisionIndex !== null
			? scriptRevisions.length > 1
				? `${script.title} · revision ${revisionIndex + 1} of ${scriptRevisions.length}`
				: script.title
			: undefined;
	const generating = busyStage === "audio" || run.status === "generating";

	return (
		<>
			<div className="space-y-6">
				<div className="flex items-start justify-end">
					<AutosaveStatus
						status={saveStatus}
						hasPending={Object.keys(pendingText.current).length > 0}
						onRetry={() => void flushText()}
						className="pt-1"
					/>
				</div>

				{guided ? (
					<AudioBriefComposer
						instructions={customInstructions}
						promptSelection={promptSelection}
						templates={templates}
						onInstructionsChange={(value) => {
							setCustomInstructions(value);
							queueText({ customInstructions: value });
						}}
						onPromptSelectionChange={(selection) => {
							setPromptSelection(selection);
							void saveNow({ promptSelection: selection });
						}}
						onPersist={() => void flushText()}
						disabled={anyBusy}
					/>
				) : (
					<section className="flex flex-col gap-2">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<Label
								htmlFor="audio-direct-prompt"
								className="text-sm font-medium"
							>
								Audio prompt
							</Label>
							<span className="text-xs text-muted-foreground">
								Sent directly to the provider
							</span>
						</div>
						<MarkdownTextarea
							id="audio-direct-prompt"
							value={prompt}
							onChange={(event) => {
								setPrompt(event.target.value);
								queueText({ prompt: event.target.value });
							}}
							onBlur={() => void flushText()}
							placeholder="Genre, rāga / mood, instruments, tempo, vocals, structure… Add lyrics with [Verse] / [Chorus] tags."
							className="min-h-60 max-h-[60vh] resize-y overflow-y-auto"
							disabled={anyBusy}
							maxLength={20_000}
						/>
					</section>
				)}

				<div className="flex flex-col gap-3 border-t border-border/80 pt-5">
					<div className="flex flex-col gap-1.5">
						<h2 className="font-heading text-lg font-semibold">
							Audio model &amp; settings
						</h2>
						<p className="text-sm text-muted-foreground">
							{guided
								? "Saved to this run. The script is written for these settings — generation always uses the current ones."
								: "Pick a model and tune its settings."}
						</p>
					</div>
					<AudioModelSelector
						value={params.modelId as AudioModelId}
						onValueChange={onModelChange}
						disabled={anyBusy}
					/>
					<AudioConfiguration
						value={params}
						onChange={onParamsChange}
						mode={guided ? "guided" : "direct"}
						disabled={anyBusy}
					/>
				</div>

				{run.lastError && !runBusy ? (
					<p className="text-xs text-destructive">{run.lastError}</p>
				) : null}

				{guided ? (
					<div className="flex flex-col gap-3 border-t border-border/80 pt-5">
						{script ? (
							<>
								{divergence.length > 0 ? (
									<p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
										Settings changed since this script was written (
										{divergence.join(", ")}). Revise or regenerate the script
										for the best fit, or generate as-is.
									</p>
								) : null}
								<AudioScriptPanel
									// Remount per revision so an open edit never saves onto
									// a different revision.
									key={revisionIndex}
									script={script}
									providerPrompt={providerPrompt}
									disabled={anyBusy}
									actions={
										<>
											{regenerateControl}
											{revisionIndex !== null ? (
												<RevisePopover
													label="Revise script"
													subject="script"
													placeholder="e.g. Make it slower and more meditative, and repeat the second pada as the refrain."
													baseIndex={revisionIndex}
													revisionCount={scriptRevisions.length}
													disabled={anyBusy}
													pending={revising}
													onSubmit={onRevise}
												/>
											) : null}
										</>
									}
									revisionSwitcher={
										revisionIndex !== null ? (
											<RevisionSwitcher
												index={revisionIndex}
												count={scriptRevisions.length}
												disabled={anyBusy}
												onSelect={onSelectRevision}
											/>
										) : null
									}
									revisionNote={
										activeRevision && revisionIndex !== null ? (
											<RevisionNote
												index={revisionIndex}
												parentIndex={activeRevision.parentIndex}
												revisionPrompt={activeRevision.revisionPrompt}
											/>
										) : null
									}
									onSave={async (next) => {
										if (revisionIndex === null) return;
										try {
											await updateScript({
												runId,
												revisionIndex,
												script: next,
											});
											notifyStudioSuccess(
												"Script saved",
												"New takes will use your edits.",
											);
										} catch (error) {
											notifyStudioError("Could not save script", error);
											throw error;
										}
									}}
								/>
							</>
						) : (
							<div className="flex flex-wrap items-center gap-3">
								<Button
									className="min-h-11"
									disabled={anyBusy || !canWriteScript}
									onClick={() => void onWriteScript()}
								>
									{scripting ? "Writing script…" : "Write song script"}
								</Button>
								<p className="text-xs text-muted-foreground">
									{!promptSelection
										? "Select a system prompt template above first."
										: !customInstructions.trim()
											? "Write instructions to compose from."
											: "Opus drafts music direction and Devanagari lyrics you can edit."}
								</p>
							</div>
						)}
					</div>
				) : null}

				<AudioReferenceImages
					images={images}
					pendingKeys={pendingKeys}
					modelMaxImages={profile.maxInputImages}
					modelName={profile.displayName}
					uploading={busyStage === "upload"}
					disabled={anyBusy}
					onUpload={onUpload}
					onReuse={async (imageId) => {
						await attachImage({
							runId,
							imageId: imageId as Id<"galleryImages">,
						});
						notifyStudioSuccess(
							"Image attached",
							"Reused from the shared gallery.",
						);
					}}
					onRemove={async (imageId) => {
						try {
							await removeImage({
								runId,
								imageId: imageId as Id<"galleryImages">,
							});
						} catch (error) {
							notifyStudioError("Could not remove image", error);
						}
					}}
				/>

				<div className="flex flex-col gap-3 border-t border-border/80 pt-5">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<h2 className="font-heading text-lg font-semibold">
							Generate audio
						</h2>
						{takes.length > 0 ? (
							<span className="text-xs text-muted-foreground">
								{takes.length} take{takes.length === 1 ? "" : "s"}
							</span>
						) : null}
					</div>
					<AudioGenerateConfirm
						params={params}
						mode={guided ? "guided" : "direct"}
						imageCount={images.length}
						className="min-h-11"
						disabled={anyBusy || !canGenerate}
						generating={generating}
						warning={
							divergence.length > 0
								? "Settings changed since the script was written — the take uses the current settings with the existing script."
								: undefined
						}
						sourceLabel={guided ? scriptSourceLabel : undefined}
						triggerLabel={
							guided && script
								? `Generate audio — ${script.title}${revisionSuffix(revisionIndex, scriptRevisions.length)}`
								: undefined
						}
						onConfirm={() => void onGenerate()}
					/>
					{!canGenerate ? (
						<p className="text-xs text-muted-foreground">
							{guided
								? "Write the song script first."
								: "Write a prompt to enable generation."}
						</p>
					) : null}
					{takes.length > 0 ? (
						<div className="grid gap-3 lg:grid-cols-2">
							{takes.map((take, index) => (
								<AudioTakeCard
									key={take.id}
									take={take}
									label={`Take ${takes.length - index}`}
									isLatest={index === 0}
									showRevision={scriptRevisions.length > 1}
									urlPending={Boolean(
										take.objectKey && pendingKeys.has(take.objectKey),
									)}
								/>
							))}
						</div>
					) : null}
				</div>
			</div>

			<GenerationProgressDock
				warnings={run.warnings}
				contextLabel={profile.displayName}
				pipeline={{
					visible: scripting || generating || busyStage === "upload",
					title: revising
						? "Revising song script"
						: scripting
							? "Writing song script"
							: busyStage === "upload"
								? "Uploading"
								: "Generating audio",
					detail: revising
						? "Applying your changes to the script…"
						: scripting
							? "Opus is composing direction and lyrics…"
							: busyStage === "upload"
								? "Saving your reference image…"
								: "Composing your track — this can take a minute or two…",
					value: scripting ? 35 : busyStage === "upload" ? 20 : 80,
					stepIndex: guided ? (scripting ? 0 : 1) : 0,
					steps: guided
						? [
								{ id: "script", label: "Script" },
								{ id: "audio", label: "Audio" },
							]
						: [{ id: "audio", label: "Audio" }],
				}}
			/>
		</>
	);
}
