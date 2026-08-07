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
import { Badge } from "#/components/ui/badge";
import { cn } from "#/lib/utils";

export type ReferenceImageItem = {
	id: string;
	url?: string | null;
	revisedImagePrompt?: string;
	createdAt: number;
};

type ReferenceImagePanelProps = {
	imageSize: string;
	imageQuality: string;
	onSizeChange: (value: string) => void;
	onQualityChange: (value: string) => void;
	onGenerate: () => void;
	generating?: boolean;
	images: ReferenceImageItem[];
	firstFrameImageId?: string;
	lastFrameImageId?: string;
	extraReferenceImageIds: string[];
	onSelectFirstFrame: (id: string | null) => void;
	onSelectLastFrame: (id: string | null) => void;
	onToggleExtraReference: (id: string) => void;
	onRemoveImage: (id: string) => void;
	supportsLastFrame?: boolean;
	supportsInputReferences?: boolean;
	maxInputReferences?: number;
	disabled?: boolean;
};

export function ReferenceImagePanel({
	imageSize,
	imageQuality,
	onSizeChange,
	onQualityChange,
	onGenerate,
	generating,
	images,
	firstFrameImageId,
	lastFrameImageId,
	extraReferenceImageIds,
	onSelectFirstFrame,
	onSelectLastFrame,
	onToggleExtraReference,
	onRemoveImage,
	supportsLastFrame,
	supportsInputReferences,
	maxInputReferences = 0,
	disabled,
}: ReferenceImagePanelProps) {
	const estimate =
		GPT_IMAGE_ESTIMATES_USD["1024x1536"][
			imageQuality as "low" | "medium" | "high"
		] ?? GPT_IMAGE_ESTIMATES_USD["1024x1536"].medium;

	return (
		<section className="space-y-4 border-t border-border/80 pt-6">
			<div>
				<h2 className="font-heading text-xl font-semibold">Reference images</h2>
				<p className="text-sm text-muted-foreground">
					GPT Image 2 stills. Pick first/last frames and optional style refs.
					Estimate ~${estimate.toFixed(3)} per {imageQuality} generate.
				</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-2">
					<Label>Size</Label>
					<Select
						value={imageSize}
						onValueChange={(value) => value && onSizeChange(value)}
						disabled={disabled}
					>
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

			<Button
				className="min-h-11"
				onClick={onGenerate}
				disabled={disabled || generating}
			>
				{generating ? "Generating image…" : "Generate reference image"}
			</Button>

			{images.length > 0 ? (
				<div className="grid gap-4 sm:grid-cols-2">
					{images.map((image) => {
						const isFirst = firstFrameImageId === image.id;
						const isLast = lastFrameImageId === image.id;
						const isExtra = extraReferenceImageIds.includes(image.id);
						return (
							<div
								key={image.id}
								className={cn(
									"rounded-xl border p-3 space-y-3",
									isFirst ? "border-primary" : "border-border/80",
								)}
							>
								{image.url ? (
									<img
										src={image.url}
										alt="Reference still"
										className="mx-auto max-h-64 w-auto rounded-lg"
									/>
								) : null}
								<div className="flex flex-wrap gap-2">
									{isFirst ? <Badge>First frame</Badge> : null}
									{isLast ? (
										<Badge variant="secondary">Last frame</Badge>
									) : null}
									{isExtra ? <Badge variant="outline">Style ref</Badge> : null}
								</div>
								<div className="flex flex-wrap gap-2">
									<Button
										size="sm"
										variant={isFirst ? "default" : "outline"}
										className="min-h-11"
										disabled={disabled}
										onClick={() =>
											onSelectFirstFrame(isFirst ? null : image.id)
										}
									>
										{isFirst ? "Unset first" : "Use as first"}
									</Button>
									{supportsLastFrame ? (
										<Button
											size="sm"
											variant={isLast ? "secondary" : "outline"}
											className="min-h-11"
											disabled={disabled}
											onClick={() =>
												onSelectLastFrame(isLast ? null : image.id)
											}
										>
											{isLast ? "Unset last" : "Use as last"}
										</Button>
									) : null}
									{supportsInputReferences ? (
										<Button
											size="sm"
											variant={isExtra ? "secondary" : "outline"}
											className="min-h-11"
											disabled={
												disabled ||
												(!isExtra &&
													extraReferenceImageIds.length >= maxInputReferences)
											}
											onClick={() => onToggleExtraReference(image.id)}
										>
											{isExtra ? "Remove ref" : "Add as ref"}
										</Button>
									) : null}
									<Button
										size="sm"
										variant="destructive"
										className="min-h-11"
										disabled={disabled}
										onClick={() => onRemoveImage(image.id)}
									>
										Delete
									</Button>
								</div>
								{image.revisedImagePrompt ? (
									<p className="text-xs text-muted-foreground">
										Revised: {image.revisedImagePrompt}
									</p>
								) : null}
							</div>
						);
					})}
				</div>
			) : null}
		</section>
	);
}
