import { Download } from "lucide-react";
import { Button } from "#/components/ui/button";

type VideoResultProps = {
	videoUrl?: string | null;
	mimeType?: string;
	durationSeconds?: number;
	gatewayGenerationId?: string;
	actualCostUsd?: number;
	warnings?: string[];
};

export function VideoResult({
	videoUrl,
	mimeType,
	durationSeconds,
	gatewayGenerationId,
	actualCostUsd,
	warnings,
}: VideoResultProps) {
	if (!videoUrl) {
		return null;
	}

	return (
		<section className="space-y-4 border-t border-border/80 pt-6">
			<div>
				<h2 className="font-heading text-xl font-semibold">Result</h2>
				<p className="text-sm text-muted-foreground">
					Stored in this app&apos;s Convex file storage until you delete the run.
				</p>
			</div>
			<video
				src={videoUrl}
				controls
				className="w-full rounded-lg border border-border/80 bg-black"
				playsInline
			/>
			<div className="flex flex-wrap gap-3">
				<Button
					variant="outline"
					className="min-h-11"
					nativeButton={false}
					render={
						<a href={videoUrl} download={`studio-video.${mimeType?.includes("webm") ? "webm" : "mp4"}`} />
					}
				>
					<Download className="size-4" />
					Download
				</Button>
			</div>
			<dl className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
				<div>
					<dt className="font-medium text-foreground">Format</dt>
					<dd>{mimeType ?? "video/mp4"}</dd>
				</div>
				<div>
					<dt className="font-medium text-foreground">Duration</dt>
					<dd>{durationSeconds ? `${durationSeconds}s` : "—"}</dd>
				</div>
				<div>
					<dt className="font-medium text-foreground">Gateway ID</dt>
					<dd>{gatewayGenerationId ?? "—"}</dd>
				</div>
				<div>
					<dt className="font-medium text-foreground">Recorded cost</dt>
					<dd>
						{actualCostUsd != null ? `$${actualCostUsd.toFixed(4)}` : "—"}
					</dd>
				</div>
			</dl>
			{warnings?.length ? (
				<ul className="text-xs text-muted-foreground">
					{warnings.map((warning) => (
						<li key={warning}>{warning}</li>
					))}
				</ul>
			) : null}
		</section>
	);
}
