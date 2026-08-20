import { Info, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { GPT_IMAGE_ESTIMATES_USD } from "#/lib/model-catalog";
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

function RoleChip({
	active,
	label,
	onClick,
	disabled,
	variant = "outline",
}: {
	active: boolean;
	label: string;
	onClick: () => void;
	disabled?: boolean;
	variant?: "outline" | "default" | "secondary";
}) {
	return (
		<Button
			type="button"
			size="sm"
			variant={active ? variant : "outline"}
			disabled={disabled}
			onClick={onClick}
			className="h-8"
		>
			{label}
		</Button>
	);
}

function ReferenceImageCard({
	image,
	isFirst,
	isLast,
	isExtra,
	busy,
	supportsLastFrame,
	supportsInputReferences,
	styleRefFull,
	onSelectFirstFrame,
	onSelectLastFrame,
	onToggleExtraReference,
	onRemoveImage,
}: {
	image: ReferenceImageItem;
	isFirst: boolean;
	isLast: boolean;
	isExtra: boolean;
	busy: boolean;
	supportsLastFrame?: boolean;
	supportsInputReferences?: boolean;
	styleRefFull: boolean;
	onSelectFirstFrame: (id: string | null) => void;
	onSelectLastFrame: (id: string | null) => void;
	onToggleExtraReference: (id: string) => void;
	onRemoveImage: (id: string) => void;
}) {
	const isUnassigned = !isFirst && !isLast && !isExtra;
	const sourceLabel =
		image.source === "uploaded"
			? "Uploaded"
			: image.source === "generated"
				? "Generated"
				: null;
	const assigned =
		[
			isFirst ? "First frame" : null,
			isLast ? "Last frame" : null,
			isExtra ? "Style ref" : null,
		]
			.filter(Boolean)
			.join(" · ") || "In gallery";

	return (
		<article
			className={cn(
				"overflow-hidden rounded-2xl border bg-card",
				isFirst || isLast || isExtra ? "border-primary/50" : "border-border/70",
			)}
		>
			<div className="relative bg-muted/30">
				{image.url ? (
					<img
						src={image.url}
						alt="Reference still"
						className="mx-auto max-h-72 w-full object-contain"
					/>
				) : (
					<div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
						Image unavailable
					</div>
				)}
			</div>

			<div className="flex flex-col gap-2.5 p-3">
				<div className="flex items-start gap-2">
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
						{sourceLabel ? (
							<Badge variant="outline" className="font-normal">
								{sourceLabel}
							</Badge>
						) : null}
						{isUnassigned ? (
							<Badge variant="secondary" className="font-normal">
								In gallery
							</Badge>
						) : null}
						{isFirst ? <Badge className="font-normal">First</Badge> : null}
						{isLast ? (
							<Badge variant="secondary" className="font-normal">
								Last
							</Badge>
						) : null}
						{isExtra ? (
							<Badge variant="outline" className="font-normal">
								Style
							</Badge>
						) : null}
					</div>

					{(image.revisedImagePrompt || image.createdAt) && (
						<Popover>
							<PopoverTrigger
								render={
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										aria-label="Image details"
									/>
								}
							>
								<Info />
							</PopoverTrigger>
							<PopoverContent align="end" className="w-80 gap-3 p-4">
								<PopoverHeader>
									<PopoverTitle>Image details</PopoverTitle>
									<PopoverDescription>
										{assigned}. Roles are optional until you generate video.
									</PopoverDescription>
								</PopoverHeader>
								<div className="flex flex-col gap-2 text-xs">
									<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
										<span className="text-muted-foreground">Added</span>
										<span>{new Date(image.createdAt).toLocaleString()}</span>
									</div>
									<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
										<span className="text-muted-foreground">Source</span>
										<span>{sourceLabel ?? "Unknown"}</span>
									</div>
									{!supportsInputReferences ? (
										<p className="text-muted-foreground">
											Current video model has no style-ref slots — use
											first/last if needed, or keep this in the gallery.
										</p>
									) : null}
								</div>
								{image.revisedImagePrompt ? (
									<div className="flex flex-col gap-1.5 border-t border-border/70 pt-3">
										<span className="text-xs text-muted-foreground">
											Revised prompt
										</span>
										<p className="max-h-28 overflow-y-auto text-xs leading-relaxed">
											{image.revisedImagePrompt}
										</p>
									</div>
								) : null}
							</PopoverContent>
						</Popover>
					)}

					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={busy}
						aria-label="Delete image"
						onClick={() => onRemoveImage(image.id)}
					>
						<Trash2 />
					</Button>
				</div>

				<div className="flex flex-wrap gap-1.5">
					<RoleChip
						active={isFirst}
						label={isFirst ? "First ✓" : "First"}
						variant="default"
						disabled={busy}
						onClick={() => onSelectFirstFrame(isFirst ? null : image.id)}
					/>
					{supportsLastFrame ? (
						<RoleChip
							active={isLast}
							label={isLast ? "Last ✓" : "Last"}
							variant="secondary"
							disabled={busy}
							onClick={() => onSelectLastFrame(isLast ? null : image.id)}
						/>
					) : null}
					{supportsInputReferences ? (
						<RoleChip
							active={isExtra}
							label={isExtra ? "Style ✓" : "Style"}
							variant="secondary"
							disabled={busy || (!isExtra && styleRefFull)}
							onClick={() => onToggleExtraReference(image.id)}
						/>
					) : null}
				</div>
			</div>
		</article>
	);
}

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
		GPT_IMAGE_ESTIMATES_USD[
			(imageSize as keyof typeof GPT_IMAGE_ESTIMATES_USD) ?? "1024x1536"
		]?.[imageQuality as "low" | "medium" | "high"] ??
		GPT_IMAGE_ESTIMATES_USD["1024x1536"].medium;
	const busy = Boolean(disabled || generating || uploading);
	const styleRefFull = extraReferenceImageIds.length >= maxInputReferences;

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
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 className="font-heading text-xl font-semibold">
						Reference images
					</h2>
					<p className="text-sm text-muted-foreground">
						Generate or upload stills, then optionally assign first / last /
						style roles.
					</p>
				</div>
				{images.length > 0 ? (
					<p className="text-xs text-muted-foreground">
						{images.length} in gallery
						{firstFrameImageId ||
						lastFrameImageId ||
						extraReferenceImageIds.length
							? ` · ${[firstFrameImageId ? "first" : null, lastFrameImageId ? "last" : null, extraReferenceImageIds.length ? `${extraReferenceImageIds.length} style` : null].filter(Boolean).join(" · ")}`
							: ""}
					</p>
				) : null}
			</div>

			<div className="rounded-2xl border border-border/70 bg-muted/15 p-3 sm:p-4">
				<div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs">Size</Label>
						<Select
							value={imageSize}
							onValueChange={(value) => value && onSizeChange(value)}
							disabled={busy}
						>
							<SelectTrigger className="h-9">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="1024x1536">Portrait 1024×1536</SelectItem>
								<SelectItem value="1024x1024">Square 1024×1024</SelectItem>
								<SelectItem value="1536x1024">Landscape 1536×1024</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs">Quality</Label>
						<Select
							value={imageQuality}
							onValueChange={(value) => value && onQualityChange(value)}
							disabled={busy}
						>
							<SelectTrigger className="h-9">
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
					<Button className="h-9" onClick={onGenerate} disabled={busy}>
						{generating ? "Generating…" : "Generate"}
					</Button>
					<Button
						className="h-9"
						variant="outline"
						disabled={busy}
						onClick={() => fileInputRef.current?.click()}
					>
						<Upload data-icon="inline-start" />
						{uploading ? "Uploading…" : "Upload"}
					</Button>
				</div>
				<p className="mt-2 text-xs text-muted-foreground">
					GPT Image 2 · ~${estimate.toFixed(3)} per {imageQuality} generate
				</p>
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
					"rounded-2xl border border-dashed px-4 py-5 text-center text-sm transition-colors",
					dragActive
						? "border-primary bg-primary/5 text-foreground"
						: "border-border/70 text-muted-foreground",
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
				Drop an image here, or click to browse · PNG / JPEG / WebP / GIF · max
				20MB
			</div>

			{images.length > 0 ? (
				<div className="grid gap-4 sm:grid-cols-2">
					{images.map((image) => (
						<ReferenceImageCard
							key={image.id}
							image={image}
							isFirst={firstFrameImageId === image.id}
							isLast={lastFrameImageId === image.id}
							isExtra={extraReferenceImageIds.includes(image.id)}
							busy={busy}
							supportsLastFrame={supportsLastFrame}
							supportsInputReferences={supportsInputReferences}
							styleRefFull={styleRefFull}
							onSelectFirstFrame={onSelectFirstFrame}
							onSelectLastFrame={onSelectLastFrame}
							onToggleExtraReference={onToggleExtraReference}
							onRemoveImage={onRemoveImage}
						/>
					))}
				</div>
			) : null}
		</section>
	);
}
