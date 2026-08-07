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
	actionMotion: string;
	soundDirection: string;
	transition: string;
	negativeConstraints: string;
};

type ShlokaPlanPreviewProps = {
	imagePrompt?: string;
	videoScenes?: VideoScene[];
	plannerModel?: string;
	plannerReasoning?: string;
	onRegenerate?: () => void;
	regenerating?: boolean;
};

export function ShlokaPlanPreview({
	imagePrompt,
	videoScenes,
	plannerModel,
	plannerReasoning,
	onRegenerate,
	regenerating,
}: ShlokaPlanPreviewProps) {
	const [copied, setCopied] = useState<string | null>(null);

	if (!imagePrompt && !videoScenes?.length) {
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
					<TabsTrigger value="video-scenes">Video scenes</TabsTrigger>
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
									<dt className="font-medium text-foreground">Composition</dt>
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
				</TabsContent>
			</Tabs>
		</section>
	);
}
