import { Copy, Pencil, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { MessageResponse } from "#/components/ai-elements/message";
import { Button } from "#/components/ui/button";
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
	plannerModel?: string;
	plannerReasoning?: string;
	onRegenerate?: () => void;
	regenerating?: boolean;
	disabled?: boolean;
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
}: {
	title: string;
	description: string;
	value: string;
	disabled?: boolean;
	saving?: boolean;
	ariaLabel: string;
	/** Returns an optional non-blocking warning string. Throw to hard-block. */
	onSave: (next: string) => Promise<string | void> | void;
}) {
	const [tab, setTab] = useState<"view" | "edit">("view");
	const [draft, setDraft] = useState(value);
	const [error, setError] = useState<string | null>(null);
	const [warning, setWarning] = useState<string | null>(null);

	useEffect(() => {
		if (tab === "view") {
			setDraft(value);
			setError(null);
		} else {
			// Entering edit mode: clear stale notices from a previous save.
			setError(null);
			setWarning(null);
		}
	}, [tab, value]);

	const dirty = draft !== value;

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<p className="text-sm font-medium">{title}</p>
					<p className="text-sm text-muted-foreground">{description}</p>
				</div>
				<Tabs
					value={tab}
					onValueChange={(next) => {
						if (next === "view" || next === "edit") {
							setTab(next);
						}
					}}
				>
					<TabsList>
						<TabsTrigger value="view">View</TabsTrigger>
						<TabsTrigger value="edit" disabled={disabled}>
							<Pencil className="size-3.5" />
							Edit
						</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			{warning ? (
				<p className="text-sm text-amber-600 dark:text-amber-400">{warning}</p>
			) : null}

			{tab === "view" ? (
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
						className="min-h-64 max-h-[50vh] resize-y"
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
										setTab("view");
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
	plannerModel,
	plannerReasoning,
	onRegenerate,
	regenerating,
	disabled,
	onSaveImagePrompt,
	onSaveVideoScenes,
}: ShlokaPlanPreviewProps) {
	const [copied, setCopied] = useState<string | null>(null);
	const [savingImage, setSavingImage] = useState(false);
	const [savingScenes, setSavingScenes] = useState(false);
	const hasCompositionClips = Boolean(compositionClips?.length);
	const hasScenes = Boolean(videoScenes?.length) || hasCompositionClips;
	const scenesMarkdown = videoScenes?.length
		? videoScenesToMarkdown(videoScenes)
		: "";

	if (!imagePrompt && !hasScenes) {
		return null;
	}

	const copyText = async (label: string, text: string) => {
		await navigator.clipboard.writeText(text);
		setCopied(label);
		setTimeout(() => setCopied(null), 1500);
	};

	return (
		<section className="space-y-4 border-t border-border/80 pt-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="font-heading text-lg font-semibold">Creative plan</h2>
					<p className="text-sm text-muted-foreground">
						{plannerModel ?? "Planner"} · reasoning{" "}
						{plannerReasoning ?? "medium"}
					</p>
				</div>
				{onRegenerate ? (
					<Button
						variant="outline"
						size="sm"
						className="min-h-11"
						onClick={onRegenerate}
						disabled={regenerating || disabled}
					>
						<RefreshCw className={regenerating ? "animate-spin" : ""} />
						Regenerate plan
					</Button>
				) : null}
			</div>

			<Tabs defaultValue="image-prompt">
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
							onSave={async (next) => {
								setSavingImage(true);
								try {
									await onSaveImagePrompt(next.trim());
								} finally {
									setSavingImage(false);
								}
							}}
						/>
					) : (
						<p className="rounded-lg border border-border/80 bg-muted/30 p-4 text-sm leading-relaxed">
							{imagePrompt}
						</p>
					)}
					<Button
						variant="ghost"
						size="sm"
						className="min-h-11"
						onClick={() => copyText("image", imagePrompt ?? "")}
					>
						<Copy className="size-4" />
						{copied === "image" ? "Copied" : "Copy prompt"}
					</Button>
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
						<>
							<PlanEditor
								title="Video plan"
								description="Edit as markdown. Saving updates the structured scenes on this run and the provider video prompt."
								value={scenesMarkdown}
								disabled={disabled}
								saving={savingScenes}
								ariaLabel="Edit video plan markdown"
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
						</>
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
		</section>
	);
}
