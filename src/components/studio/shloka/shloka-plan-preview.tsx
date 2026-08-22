import { Copy, Pencil } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { MessageResponse } from "#/components/ai-elements/message";
import { Button } from "#/components/ui/button";
import { MarkdownTextarea } from "#/components/ui/markdown-textarea";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import {
	type EditableVideoScene,
	markdownToVideoScenes,
	normalizeVideoScenes,
	videoScenesToMarkdown,
} from "#/lib/video-plan-markdown";

type VideoScene = EditableVideoScene;

type ShlokaPlanPreviewProps = {
	imagePrompt?: string;
	videoScenes?: VideoScene[];
	/** Provider prompt built from scenes (may exceed model limit). */
	videoPrompt?: string;
	/** Cached compressed prompt when over the model character limit. */
	summarizedVideoPrompt?: string;
	disabled?: boolean;
	/** Extra actions (e.g. "Regenerate plan") rendered first in the header row. */
	actions?: ReactNode;
	onSaveImagePrompt?: (imagePrompt: string) => Promise<void> | void;
	onSaveVideoScenes?: (videoScenes: VideoScene[]) => Promise<void> | void;
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
	editorClassName,
	viewClassName,
}: {
	title: string;
	description: string;
	value: string;
	disabled?: boolean;
	saving?: boolean;
	ariaLabel: string;
	/** Returns an optional non-blocking warning string. Throw to hard-block. */
	onSave: (next: string) => Promise<string | undefined> | undefined;
	editMode: "view" | "edit";
	onEditModeChange: (mode: "view" | "edit") => void;
	editorClassName?: string;
	/** Optional classes for the read-only view (e.g. a capped scroll area). */
	viewClassName?: string;
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
				<p className="font-heading text-sm font-semibold">{title}</p>
				<p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
			</div>
			{editMode === "edit" ? (
				<MarkdownTextarea
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					className={editorClassName}
					aria-label={ariaLabel}
					disabled={disabled || saving}
				/>
			) : (
				<div className={viewClassName}>
					<MessageResponse className={markdownViewClassName}>
						{value}
					</MessageResponse>
				</div>
			)}
			{error ? <p className="text-xs text-destructive">{error}</p> : null}
			{warning ? (
				<p className="text-xs text-amber-700 dark:text-amber-300">{warning}</p>
			) : null}
			{editMode === "edit" ? (
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						className="min-h-11"
						disabled={disabled || saving || !dirty}
						onClick={() => {
							void (async () => {
								try {
									const result = await onSave(draft);
									if (typeof result === "string") {
										setWarning(result);
									}
									onEditModeChange("view");
								} catch (caught) {
									setError(
										caught instanceof Error
											? caught.message
											: "Could not save.",
									);
								}
							})();
						}}
					>
						{saving ? "Saving…" : "Save"}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="min-h-11"
						disabled={saving}
						onClick={() => onEditModeChange("view")}
					>
						Cancel
					</Button>
				</div>
			) : null}
		</div>
	);
}

export function ShlokaPlanPreview({
	imagePrompt,
	videoScenes,
	videoPrompt,
	summarizedVideoPrompt,
	disabled,
	actions,
	onSaveImagePrompt,
	onSaveVideoScenes,
}: ShlokaPlanPreviewProps) {
	const [copied, setCopied] = useState<string | null>(null);
	const [savingImage, setSavingImage] = useState(false);
	const [savingScenes, setSavingScenes] = useState(false);
	const [activeTab, setActiveTab] = useState<"image-prompt" | "video-scenes">(
		"image-prompt",
	);
	const [editing, setEditing] = useState(false);
	const hasScenes = Boolean(videoScenes?.length);
	const normalizedScenes = videoScenes?.length
		? normalizeVideoScenes(videoScenes)
		: [];
	const scenesMarkdown = normalizedScenes.length
		? videoScenesToMarkdown(normalizedScenes)
		: "";
	const showSummarizedPrompt = Boolean(summarizedVideoPrompt?.trim());
	const videoPlanMarkdown = normalizedScenes.length ? scenesMarkdown : "";

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
			: Boolean(onSaveVideoScenes && videoScenes?.length);

	const editMode = editing ? "edit" : "view";
	const setEditMode = (mode: "view" | "edit") => setEditing(mode === "edit");

	return (
		<section className="space-y-4 border-t border-border/80 pt-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					{actions}
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
					{showSummarizedPrompt && activeTab === "video-scenes" ? (
						<Popover>
							<PopoverTrigger
								render={
									<Button variant="outline" size="sm" className="min-h-11" />
								}
							>
								Summarized prompt
							</PopoverTrigger>
							<PopoverContent
								align="start"
								className="w-[min(28rem,90vw)] gap-3 p-4"
							>
								<PopoverHeader>
									<PopoverTitle>Summarized provider prompt</PopoverTitle>
									<PopoverDescription>
										Compressed to fit the video model character limit
										{videoPrompt
											? ` (${videoPrompt.length} → ${summarizedVideoPrompt?.length} chars)`
											: ""}
										.
									</PopoverDescription>
								</PopoverHeader>
								<pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-break-word rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed">
									{summarizedVideoPrompt}
								</pre>
								<Button
									variant="ghost"
									size="sm"
									className="self-start"
									onClick={() =>
										summarizedVideoPrompt &&
										void copyText("summarized", summarizedVideoPrompt)
									}
								>
									<Copy className="size-3.5" />
									{copied === "summarized" ? "Copied" : "Copy"}
								</Button>
							</PopoverContent>
						</Popover>
					) : null}
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
					<TabsTrigger value="video-scenes">Video scenes</TabsTrigger>
				</TabsList>
				<TabsContent value="image-prompt" className="space-y-3">
					{onSaveImagePrompt && imagePrompt ? (
						<PlanEditor
							title="Reference image prompt"
							description="Saved on this plan and used for reference image generation."
							value={imagePrompt}
							disabled={disabled}
							saving={savingImage}
							ariaLabel="Edit reference image prompt"
							editorClassName="min-h-48"
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
					{onSaveVideoScenes && videoScenes?.length ? (
						<PlanEditor
							title="Video plan"
							description="Edit as markdown. Saving updates the structured scenes on this plan and the provider video prompt."
							value={scenesMarkdown}
							disabled={disabled}
							saving={savingScenes}
							ariaLabel="Edit video plan markdown"
							editorClassName="min-h-64 border-border shadow-sm"
							viewClassName="max-h-[min(28rem,55vh)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-background/40 p-4"
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
							{normalizedScenes.map((scene) => (
								<div
									key={scene.sceneNumber}
									className="rounded-lg border border-border/80 p-4"
								>
									<p className="text-sm font-medium">
										Scene {scene.sceneNumber}: {scene.intent}
									</p>
									<dl className="mt-2 grid gap-1 text-sm text-muted-foreground">
										<div>
											<dt className="font-medium text-foreground">Subject</dt>
											<dd>{scene.subject}</dd>
										</div>
										<div>
											<dt className="font-medium text-foreground">Action</dt>
											<dd>{scene.action}</dd>
										</div>
										{scene.scene.trim() ? (
											<div>
												<dt className="font-medium text-foreground">Scene</dt>
												<dd>{scene.scene}</dd>
											</div>
										) : null}
										{scene.style.trim() ? (
											<div>
												<dt className="font-medium text-foreground">Style</dt>
												<dd>{scene.style}</dd>
											</div>
										) : null}
										{scene.camera.trim() ? (
											<div>
												<dt className="font-medium text-foreground">Camera</dt>
												<dd>{scene.camera}</dd>
											</div>
										) : null}
										{scene.audio.trim() ? (
											<div>
												<dt className="font-medium text-foreground">Audio</dt>
												<dd>{scene.audio}</dd>
											</div>
										) : null}
									</dl>
								</div>
							))}
						</div>
					)}
				</TabsContent>
			</Tabs>
		</section>
	);
}
