import { Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";

type VideoScene = {
	sceneNumber: number;
	intent: string;
	subjects: string;
	locationTime: string;
	composition: string;
	lensCamera: string;
	lighting: string;
	paletteAesthetics: string;
	soundDirection: string;
	actionMotion: string;
	transition: string;
	negativeConstraints: string;
};

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
};

export function ShlokaPlanPreview({
	imagePrompt,
	videoScenes,
	compositionOverallDescription,
	compositionClips,
	plannerModel,
	plannerReasoning,
	onRegenerate,
	regenerating,
}: ShlokaPlanPreviewProps) {
	const [copied, setCopied] = useState<string | null>(null);
	const hasCompositionClips = Boolean(compositionClips?.length);
	const hasScenes = Boolean(videoScenes?.length) || hasCompositionClips;

	if (!imagePrompt && !hasScenes) {
		return null;
	}

	const copyText = async (label: string, text: string) => {
		await navigator.clipboard.writeText(text);
		setCopied(label);
		setTimeout(() => setCopied(null), 1500);
	};

	return (
		<section className="space-y-4 border-t border-border/80 pt-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="font-heading text-xl font-semibold">Creative plan</h2>
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
						disabled={regenerating}
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
					<p className="rounded-lg border border-border/80 bg-muted/30 p-4 text-sm leading-relaxed">
						{imagePrompt}
					</p>
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
											? " · continues from previous terminal frame"
											: ""}
									</p>
									{clip.globalDescription ? (
										<p className="mt-2 text-sm leading-relaxed">
											{clip.globalDescription}
										</p>
									) : null}
									<p className="mt-3 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
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
