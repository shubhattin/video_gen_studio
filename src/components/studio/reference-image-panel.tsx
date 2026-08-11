import { useRef, useState } from "react";
import { Upload } from "lucide-react";
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
	source?: "generated" | "uploaded";
	revisedImagePrompt?: string;
	createdAt: number;
};

type ReferenceImagePanelProps = {
	imageSize: string;
	imageQuality: string;
	onSizeChange: (value: string) => void;
	onQualityChange: (value: string) => void;
	onGenerate: () => void;
	onUpload: (file: File) => Promise<void> | void;
	generating?: boolean;
	uploading?: boolean;
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
	onUpload,
	generating,
	uploading,
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
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [dragActive, setDragActive] = useState(false);
	const estimate =
		GPT_IMAGE_ESTIMATES_USD["1024x1536"][
			imageQuality as "low" | "medium" | "high"
		] ?? GPT_IMAGE_ESTIMATES_USD["1024x1536"].medium;
	const busy = Boolean(disabled || generating || uploading);

	const handleFiles = async (files: FileList | null) => {
		const file = files?.[0];
		if (!file || busy) {
			return;
		}
		await onUpload(file);
		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	};

	return (
		<section className="flex flex-col gap-4 border-t border-border/80 pt-6">
			<div>
				<h2 className="font-heading text-xl font-semibold">Reference images</h2>
				<p className="text-sm text-muted-foreground">
					Generate with GPT Image 2 or upload your own. Images stay in the
					gallery until you assign them — first frame, last frame, or style
					reference. Unassigned images are kept but not sent to video gen.
					Generate estimate ~${estimate.toFixed(3)} per {imageQuality}.
				</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="flex flex-col gap-2">
					<Label>Size (generate)</Label>
					<Select
						value={imageSize}
						onValueChange={(value) => value && onSizeChange(value)}
						disabled={busy}
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
				<div className="flex flex-col gap-2">
					<Label>Quality (generate)</Label>
					<Select
						value={imageQuality}
						onValueChange={(value) => value && onQualityChange(value)}
						disabled={busy}
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
				<Button className="min-h-11" onClick={onGenerate} disabled={busy}>
					{generating ? "Generating image…" : "Generate with GPT Image 2"}
				</Button>
				<Button
					className="min-h-11"
					variant="outline"
					disabled={busy}
					onClick={() => fileInputRef.current?.click()}
				>
					<Upload data-icon="inline-start" />
					{uploading ? "Uploading…" : "Upload image"}
				</Button>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif"
					className="sr-only"
					disabled={busy}
					onChange={(event) => {
						void handleFiles(event.target.files);
					}}
				/>
			</div>

			<div
				className={cn(
					"rounded-xl border border-dashed px-4 py-6 text-center text-sm transition-colors",
					dragActive
						? "border-primary bg-primary/5 text-foreground"
						: "border-border/80 text-muted-foreground",
					busy ? "opacity-60" : "cursor-pointer",
				)}
				onDragEnter={(event) => {
					event.preventDefault();
					event.stopPropagation();
					if (!busy) setDragActive(true);
				}}
				onDragOver={(event) => {
					event.preventDefault();
					event.stopPropagation();
					if (!busy) setDragActive(true);
				}}
				onDragLeave={(event) => {
					event.preventDefault();
					event.stopPropagation();
					setDragActive(false);
				}}
				onDrop={(event) => {
					event.preventDefault();
					event.stopPropagation();
					setDragActive(false);
					void handleFiles(event.dataTransfer.files);
				}}
				onClick={() => {
					if (!busy) fileInputRef.current?.click();
				}}
				onKeyDown={(event) => {
					if (busy) return;
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						fileInputRef.current?.click();
					}
				}}
				role="button"
				tabIndex={busy ? -1 : 0}
			>
				Drop a PNG, JPEG, WebP, or GIF here — or click to browse (max 20MB).
			</div>

			{images.length > 0 ? (
				<div className="grid gap-4 sm:grid-cols-2">
					{images.map((image) => {
						const isFirst = firstFrameImageId === image.id;
						const isLast = lastFrameImageId === image.id;
						const isExtra = extraReferenceImageIds.includes(image.id);
						const isUnassigned = !isFirst && !isLast && !isExtra;
						const sourceLabel =
							image.source === "uploaded"
								? "Uploaded"
								: image.source === "generated"
									? "Generated"
									: null;
						return (
							<div
								key={image.id}
								className={cn(
									"flex flex-col gap-3 rounded-xl border p-3",
									isFirst || isLast || isExtra
										? "border-primary/60"
										: "border-border/80",
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
									{sourceLabel ? (
										<Badge variant="outline">{sourceLabel}</Badge>
									) : null}
									{isUnassigned ? (
										<Badge variant="secondary">In gallery</Badge>
									) : null}
									{isFirst ? <Badge>First frame</Badge> : null}
									{isLast ? (
										<Badge variant="secondary">Last frame</Badge>
									) : null}
									{isExtra ? <Badge variant="outline">Style ref</Badge> : null}
								</div>
								<p className="text-xs text-muted-foreground">
									Optional roles — leave unassigned, or pick first / last /
									style ref.
								</p>
								<div className="flex flex-wrap gap-2">
									<Button
										size="sm"
										variant={isFirst ? "default" : "outline"}
										className="min-h-11"
										disabled={busy}
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
											disabled={busy}
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
												busy ||
												(!isExtra &&
													extraReferenceImageIds.length >= maxInputReferences)
											}
											onClick={() => onToggleExtraReference(image.id)}
										>
											{isExtra ? "Remove style ref" : "Add as style ref"}
										</Button>
									) : (
										<p className="w-full text-xs text-muted-foreground">
											Current video model has no style-ref slot — use first/last
											if needed, or keep this in the gallery.
										</p>
									)}
									<Button
										size="sm"
										variant="destructive"
										className="min-h-11"
										disabled={busy}
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
