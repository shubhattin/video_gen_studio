import { Copy, GitFork, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { MessageResponse } from "#/components/ai-elements/message";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { MarkdownTextarea } from "#/components/ui/markdown-textarea";
import {
	markdownToVideoScenes,
	videoScenesToMarkdown,
	type EditableVideoScene,
} from "#/lib/video-plan-markdown";

type VideoScene = EditableVideoScene;

type CompositionClipPlan = {
	clipIndex: number;
	durationSeconds: number;
	scenePrompt: string;
	globalDescription?: string;
	continuityInstructions?: string;
	transition?: string;
	usesPreviousTerminalFrame: boolean;
};

type ShlokaPlanPreviewProps = {
	imagePrompt?: string;
	videoScenes?: VideoScene[];
	compositionOverallDescription?: string;
	compositionClips?: CompositionClipPlan[];
	activePlanId?: string | null;
	attempts?: Array<{ attemptNumber: number }>;
	disabled?: boolean;
	onSaveImagePrompt?: (imagePrompt: string) => Promise<void> | void;
	onSaveVideoScenes?: (videoScenes: VideoScene[]) => Promise<void> | void;
	onFork?: (planId: string, title: string) => void;
	onDelete?: (planId: string) => void;
};

const markdownViewClassName =
	"text-sm leading-relaxed [&_strong]:font-semibold [&_em]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-2 [&_h3]:font-heading [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-1 [&_p]:my-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

function PlanEditor({
	title,
	description,
	value,
	disabled,
	saving,
	ariaLabel,
	onSave,
	editMode,
	onEditModeChange,
}: {
	title: string;
	description: string;
	value: string;
	disabled?: boolean;
	saving?: boolean;
	ariaLabel: string;
	/** Returns an optional non-blocking warning string. Throw to hard-block. */
	onSave: (next: string) => Promise<string | void> | void;
	editMode: "view" | "edit";
	onEditModeChange: (mode: "view" | "edit") => void;
}) {
	const [draft, setDraft] = useState(value);
	const [error, setError] = useState<string | null>(null);
	const [warning, setWarning] = useState<string | null>(null);

	useEffect(() => {
		if (editMode === "view") {
			setDraft(value);
			setError(null);
		} else {
			// Entering edit mode: clear stale notices from a previous save.
			setError(null);
			setWarning(null);
		}
	}, [editMode, value]);

	const dirty = draft !== value;

	return (
		<div className="space-y-3">
			<div>
				<p className="text-sm font-medium">{title}</p>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>

			{warning ? (
				<p className="text-sm text-amber-600 dark:text-amber-400">{warning}</p>
			) : null}

			{editMode === "view" ? (
				<div className="max-h-[min(28rem,55vh)] overflow-y-auto overscroll-contain rounded-lg border border-border/80 bg-muted/20 p-4">
					<MessageResponse className={markdownViewClassName}>
						{value || "_Empty_"}
					</MessageResponse>
				</div>
			) : (
				<div className="space-y-3">
					<MarkdownTextarea
						value={draft}
						onChange={(event) => {
							setDraft(event.target.value);
							setError(null);
							setWarning(null);
						}}
						className="min-h-96 max-h-[70vh] resize-y"
						disabled={disabled || saving}
						aria-label={ariaLabel}
					/>
					{error ? <p className="text-sm text-destructive">{error}</p> : null}
					<div className="flex flex-wrap justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="min-h-11"
							disabled={disabled || saving || !dirty}
							onClick={() => {
								setDraft(value);
								setError(null);
								setWarning(null);
							}}
						>
							Discard
						</Button>
						<Button
							type="button"
							size="sm"
							className="min-h-11"
							disabled={disabled || saving || !dirty}
							onClick={() => {
								void (async () => {
									try {
										const result = await onSave(draft);
										setWarning(
											typeof result === "string" && result ? result : null,
										);
										setError(null);
										onEditModeChange("view");
									} catch (saveError) {
										setError(
											saveError instanceof Error
												? saveError.message
												: "Could not save changes.",
										);
									}
								})();
							}}
						>
							{saving ? "Saving…" : "Save to run"}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

export function ShlokaPlanPreview({
	imagePrompt,
	videoScenes,
	compositionOverallDescription,
	compositionClips,
	activePlanId,
	attempts,
	disabled,
	onSaveImagePrompt,
	onSaveVideoScenes,
	onFork,
	onDelete,
}: ShlokaPlanPreviewProps) {
	const [copied, setCopied] = useState<string | null>(null);
	const [savingImage, setSavingImage] = useState(false);
	const [savingScenes, setSavingScenes] = useState(false);
	const [activeTab, setActiveTab] = useState<"image-prompt" | "video-scenes">(
		"image-prompt",
	);
	const [editing, setEditing] = useState(false);
	const [forkOpen, setForkOpen] = useState(false);
	const [forkTitle, setForkTitle] = useState("");
	const [forking, setForking] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const hasCompositionClips = Boolean(compositionClips?.length);
	const hasScenes = Boolean(videoScenes?.length) || hasCompositionClips;
	const scenesMarkdown = videoScenes?.length
		? videoScenesToMarkdown(videoScenes)
		: "";
	const videoPlanMarkdown = videoScenes?.length
		? scenesMarkdown
		: hasCompositionClips
			? (compositionClips ?? [])
					.map((clip, index) => {
						const parts = [`## Clip ${index + 1} (${clip.durationSeconds}s)`];
						if (clip.globalDescription) parts.push(clip.globalDescription);
						parts.push(clip.scenePrompt);
						if (clip.continuityInstructions)
							parts.push(`Continuity: ${clip.continuityInstructions}`);
						if (clip.transition) parts.push(`Transition: ${clip.transition}`);
						return parts.join("\n\n");
					})
					.join("\n\n---\n\n")
			: "";
	const nextAttemptNumber =
		((attempts ?? []).reduce(
			(acc, item) => Math.max(acc, item.attemptNumber),
			0,
		) || 0) + 1;

	if (!imagePrompt && !hasScenes) {
		return null;
	}

	const copyText = async (label: string, text: string) => {
		await navigator.clipboard.writeText(text);
		setCopied(label);
		setTimeout(() => setCopied(null), 1500);
	};

	const activeCopy = {
		"image-prompt": imagePrompt
			? { key: "image", text: imagePrompt, label: "Copy prompt" }
			: null,
		"video-scenes": videoPlanMarkdown
			? { key: "scenes", text: videoPlanMarkdown, label: "Copy plan" }
			: null,
	}[activeTab];

	const canEdit =
		activeTab === "image-prompt"
			? Boolean(onSaveImagePrompt && imagePrompt)
			: Boolean(
					!hasCompositionClips && onSaveVideoScenes && videoScenes?.length,
				);

	const editMode = editing ? "edit" : "view";
	const setEditMode = (mode: "view" | "edit") => setEditing(mode === "edit");

	const openFork = () => {
		setForkTitle("");
		setForkOpen(true);
	};

	const confirmFork = async () => {
		if (!activePlanId || !onFork) return;
		setForking(true);
		try {
			await onFork(activePlanId, forkTitle);
			setForkOpen(false);
		} finally {
			setForking(false);
		}
	};

	return (
		<section className="space-y-4 border-t border-border/80 pt-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					{activeCopy ? (
						<Button
							variant="outline"
							size="sm"
							className="min-h-11"
							onClick={() => copyText(activeCopy.key, activeCopy.text)}
						>
							<Copy className="size-4" />
							{copied === activeCopy.key ? "Copied" : activeCopy.label}
						</Button>
					) : null}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{canEdit ? (
						<Button
							variant={editing ? "default" : "ghost"}
							size="sm"
							className="min-h-11"
							disabled={disabled}
							onClick={() => setEditing((value) => !value)}
						>
							<Pencil className="size-4" />
							{editing ? "Editing" : "Edit"}
						</Button>
					) : null}
					{onFork && activePlanId ? (
						<Button
							variant="outline"
							size="sm"
							className="min-h-11"
							disabled={disabled}
							onClick={openFork}
						>
							<GitFork className="size-4" />
							Fork plan
						</Button>
					) : null}
					{onDelete && activePlanId ? (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="min-h-11 min-w-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
							disabled={disabled}
							aria-label="Delete plan"
							onClick={() => setDeleteOpen(true)}
						>
							<Trash2 className="size-4" />
						</Button>
					) : null}
				</div>
			</div>

			<Tabs
				value={activeTab}
				onValueChange={(value) => {
					if (value === "image-prompt" || value === "video-scenes") {
						setActiveTab(value);
					}
				}}
			>
				<TabsList>
					<TabsTrigger value="image-prompt">Reference image prompt</TabsTrigger>
					<TabsTrigger value="video-scenes">
						{hasCompositionClips ? "Video clips" : "Video scenes"}
					</TabsTrigger>
				</TabsList>
				<TabsContent value="image-prompt" className="space-y-3">
					{onSaveImagePrompt && imagePrompt ? (
						<PlanEditor
							title="Reference image prompt"
							description="Saved on this run and used for reference image generation."
							value={imagePrompt}
							disabled={disabled}
							saving={savingImage}
							ariaLabel="Edit reference image prompt"
							editMode={editMode}
							onEditModeChange={setEditMode}
							onSave={async (next) => {
								setSavingImage(true);
								try {
									await onSaveImagePrompt(next.trim());
								} finally {
									setSavingImage(false);
								}
							}}
						/>
					) : imagePrompt ? (
						<p className="rounded-lg border border-border/80 bg-muted/30 p-4 text-sm leading-relaxed">
							{imagePrompt}
						</p>
					) : null}
				</TabsContent>
				<TabsContent value="video-scenes" className="space-y-3">
					{hasCompositionClips ? (
						<div className="max-h-[min(28rem,55vh)] space-y-3 overflow-y-auto overscroll-contain pr-1">
							{compositionOverallDescription ? (
								<p className="rounded-lg border border-border/80 bg-muted/30 p-4 text-sm leading-relaxed">
									{compositionOverallDescription}
								</p>
							) : null}
							{compositionClips?.map((clip) => (
								<div
									key={clip.clipIndex}
									className="rounded-lg border border-border/80 p-4"
								>
									<p className="text-sm font-medium">
										Clip {clip.clipIndex + 1} · {clip.durationSeconds}s
										{clip.usesPreviousTerminalFrame
											? " · continues from previous clip"
											: ""}
									</p>
									{clip.globalDescription ? (
										<p className="mt-2 text-sm leading-relaxed">
											{clip.globalDescription}
										</p>
									) : null}
									<p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
										{clip.scenePrompt}
									</p>
									<dl className="mt-3 grid gap-2 text-sm text-muted-foreground">
										{clip.continuityInstructions ? (
											<div>
												<dt className="font-medium text-foreground">
													Continuity
												</dt>
												<dd>{clip.continuityInstructions}</dd>
											</div>
										) : null}
										{clip.transition ? (
											<div>
												<dt className="font-medium text-foreground">
													Transition
												</dt>
												<dd>{clip.transition}</dd>
											</div>
										) : null}
									</dl>
									<Button
										variant="ghost"
										size="sm"
										className="mt-2 min-h-11"
										onClick={() =>
											copyText(`clip-${clip.clipIndex}`, clip.scenePrompt)
										}
									>
										<Copy className="size-4" />
										{copied === `clip-${clip.clipIndex}`
											? "Copied"
											: "Copy clip prompt"}
									</Button>
								</div>
							))}
						</div>
					) : onSaveVideoScenes && videoScenes?.length ? (
						<PlanEditor
							title="Video plan"
							description="Edit as markdown. Saving updates the structured scenes on this run and the provider video prompt."
							value={scenesMarkdown}
							disabled={disabled}
							saving={savingScenes}
							ariaLabel="Edit video plan markdown"
							editMode={editMode}
							onEditModeChange={setEditMode}
							onSave={async (next) => {
								const { scenes, warning } = markdownToVideoScenes(next);
								if (scenes.length === 0) {
									throw new Error(
										warning ??
											'Could not parse scenes. Keep headings like "### Scene 1: …".',
									);
								}
								setSavingScenes(true);
								try {
									await onSaveVideoScenes(scenes);
								} finally {
									setSavingScenes(false);
								}
								return warning ?? undefined;
							}}
						/>
					) : (
						<div className="max-h-[min(28rem,55vh)] space-y-3 overflow-y-auto overscroll-contain pr-1">
							{videoScenes?.map((scene) => (
								<div
									key={scene.sceneNumber}
									className="rounded-lg border border-border/80 p-4"
								>
									<p className="text-sm font-medium">
										Scene {scene.sceneNumber}: {scene.intent}
									</p>
									<dl className="mt-2 grid gap-1 text-sm text-muted-foreground">
										<div>
											<dt className="font-medium text-foreground">Subjects</dt>
											<dd>{scene.subjects}</dd>
										</div>
										<div>
											<dt className="font-medium text-foreground">
												Composition
											</dt>
											<dd>{scene.composition}</dd>
										</div>
										<div>
											<dt className="font-medium text-foreground">Motion</dt>
											<dd>{scene.actionMotion}</dd>
										</div>
										<div>
											<dt className="font-medium text-foreground">Avoid</dt>
											<dd>{scene.negativeConstraints}</dd>
										</div>
									</dl>
								</div>
							))}
						</div>
					)}
				</TabsContent>
			</Tabs>

			<Dialog open={forkOpen} onOpenChange={setForkOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Fork plan</DialogTitle>
						<DialogDescription>
							Create a copy of this plan as a new attempt. You can edit the copy
							without affecting the original.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						<Label htmlFor="fork-plan-title" className="text-xs">
							Name (optional)
						</Label>
						<Input
							id="fork-plan-title"
							value={forkTitle}
							onChange={(event) => setForkTitle(event.target.value)}
							placeholder={`Plan ${nextAttemptNumber}`}
							maxLength={90}
							autoFocus
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									void confirmFork();
								}
							}}
						/>
						<p className="text-xs text-muted-foreground">
							Leave blank to use “Plan {nextAttemptNumber}”.
						</p>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							disabled={forking}
							onClick={() => setForkOpen(false)}
						>
							Cancel
						</Button>
						<Button disabled={forking} onClick={() => void confirmFork()}>
							{forking ? "Forking…" : "Fork plan"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this plan?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes this plan attempt and its content. This
							cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={disabled}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={disabled}
							onClick={() => {
								if (activePlanId) onDelete?.(activePlanId);
								setDeleteOpen(false);
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}
