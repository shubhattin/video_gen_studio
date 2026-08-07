import { GPT_IMAGE_ESTIMATES_USD } from "#/lib/model-catalog";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";

type ReferenceImagePanelProps = {
	imageSize: string;
	imageQuality: string;
	onSizeChange: (value: string) => void;
	onQualityChange: (value: string) => void;
	onGenerate: () => void;
	onRegenerate?: () => void;
	generating?: boolean;
	referenceImageUrl?: string | null;
	revisedPrompt?: string;
	disabled?: boolean;
};

export function ReferenceImagePanel({
	imageSize,
	imageQuality,
	onSizeChange,
	onQualityChange,
	onGenerate,
	onRegenerate,
	generating,
	referenceImageUrl,
	revisedPrompt,
	disabled,
}: ReferenceImagePanelProps) {
	const estimate =
		GPT_IMAGE_ESTIMATES_USD["1024x1536"][
			imageQuality as "low" | "medium" | "high"
		] ??
		GPT_IMAGE_ESTIMATES_USD["1024x1536"].medium;

	return (
		<section className="space-y-4 border-t border-border/80 pt-6">
			<div>
				<h2 className="font-heading text-xl font-semibold">Reference image</h2>
				<p className="text-sm text-muted-foreground">
					GPT Image 2 portrait still for image-to-video models. Estimate ~
					${estimate.toFixed(3)} for {imageQuality} quality.
				</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-2">
					<Label>Size</Label>
					<Select value={imageSize} onValueChange={(value) => value && onSizeChange(value)} disabled={disabled}>
						<SelectTrigger className="min-h-11">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="1024x1536">Portrait 1024×1536</SelectItem>
							<SelectItem value="1024x1024">Square 1024×1024</SelectItem>
							<SelectItem value="1536x1024">Landscape 1536×1024</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-2">
					<Label>Quality</Label>
					<Select
						value={imageQuality}
						onValueChange={(value) => value && onQualityChange(value)}
						disabled={disabled}
					>
						<SelectTrigger className="min-h-11">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="low">Low</SelectItem>
							<SelectItem value="medium">Medium</SelectItem>
							<SelectItem value="high">High</SelectItem>
							<SelectItem value="auto">Auto</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="flex flex-wrap gap-3">
				<Button
					className="min-h-11"
					onClick={onGenerate}
					disabled={disabled || generating}
				>
					{generating ? "Generating image…" : "Generate reference image"}
				</Button>
				{referenceImageUrl && onRegenerate ? (
					<Button
						variant="outline"
						className="min-h-11"
						onClick={onRegenerate}
						disabled={disabled || generating}
					>
						New revision
					</Button>
				) : null}
			</div>

			{referenceImageUrl ? (
				<div className="space-y-2">
					<img
						src={referenceImageUrl}
						alt="Generated reference still"
						className="mx-auto max-h-[min(70vh,720px)] w-auto rounded-lg border border-border/80"
					/>
					{revisedPrompt ? (
						<p className="text-xs text-muted-foreground">
							Provider revised prompt: {revisedPrompt}
						</p>
					) : null}
				</div>
			) : null}
		</section>
	);
}
