import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { Download, Images, Info, Loader2, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
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
import {
	useSignedMediaUrls,
	withSignedUrl,
} from "#/hooks/use-signed-media-urls";
import { GPT_IMAGE_ESTIMATES_USD } from "#/lib/model-catalog";
import { notifyStudioError } from "#/lib/studio-toast";
import { cn } from "#/lib/utils";

export type ReferenceImageItem = {
	id: string;
	url?: string | null;
	source?: "generated" | "uploaded" | "terminal_frame";
	revisedImagePrompt?: string;
	createdAt: number;
	meta?: {
		width?: number;
		height?: number;
	};
};

type ReferenceImagePanelProps = {
	imageSize: string;
	imageQuality: string;
	onSizeChange: (value: string) => void;
	onQualityChange: (value: string) => void;
	onGenerate: () => void;
	onUpload: (file: File) => Promise<void> | void;
	onReuseImage?: (imageId: string) => Promise<void> | void;
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
	supportsFirstFrame?: boolean;
	supportsLastFrame?: boolean;
	supportsInputReferences?: boolean;
	maxInputReferences?: number;
	disabled?: boolean;
	globalBusy?: boolean;
};

function referenceCapabilityWarnings(args: {
	supportsFirstFrame?: boolean;
	supportsLastFrame?: boolean;
	supportsInputReferences?: boolean;
	maxInputReferences: number;
	firstFrameImageId?: string;
	lastFrameImageId?: string;
	extraReferenceImageIds: string[];
}) {
	const warnings: string[] = [];
	if (args.firstFrameImageId && args.supportsFirstFrame === false) {
		warnings.push(
			"First-frame tag will be ignored — this model does not support first frames.",
		);
	}
	if (args.lastFrameImageId && args.supportsLastFrame === false) {
		warnings.push(
			"Last-frame tag will be ignored — this model does not support last frames.",
		);
	}
	if (
		args.extraReferenceImageIds.length > 0 &&
		args.supportsInputReferences === false
	) {
		warnings.push(
			"Style refs will be ignored — this model does not support input_references.",
		);
	} else if (
		args.extraReferenceImageIds.length > args.maxInputReferences &&
		args.maxInputReferences >= 0
	) {
		warnings.push(
			`Only the first ${args.maxInputReferences} style refs will be sent.`,
		);
	}
	if (
		(args.firstFrameImageId || args.lastFrameImageId) &&
		args.extraReferenceImageIds.length > 0
	) {
		warnings.push(
			"Style refs will be skipped because first/last frames take precedence on OpenRouter.",
		);
	}
	return warnings;
}

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

async function downloadImageFile(
	sourceUrl: string,
	filename: string,
): Promise<void> {
	const response = await fetch(sourceUrl, { cache: "no-store" });
	if (!response.ok) {
		throw new Error(`Download failed (${response.status})`);
	}
	const blob = await response.blob();
	const objectUrl = URL.createObjectURL(blob);
	try {
		const link = document.createElement("a");
		link.href = objectUrl;
		link.download = filename;
		link.rel = "noopener";
		link.style.display = "none";
		document.body.append(link);
		link.click();
		link.remove();
	} finally {
		window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
	}
}

function sourceLabelFor(source?: ReferenceImageItem["source"]): string | null {
	if (source === "uploaded") return "Uploaded";
	if (source === "generated") return "Generated";
	if (source === "terminal_frame") return "Continuity frame";
	return null;
}

function ReferenceImageCard({
	image,
	isFirst,
	isLast,
	isExtra,
	busy,
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
	onSelectFirstFrame: (id: string | null) => void;
	onSelectLastFrame: (id: string | null) => void;
	onToggleExtraReference: (id: string) => void;
	onRemoveImage: (id: string) => void;
}) {
	const [downloading, setDownloading] = useState(false);
	const imageWidth = image.meta?.width;
	const imageHeight = image.meta?.height;
	const ratio =
		imageWidth &&
		imageHeight &&
		Number.isFinite(imageWidth) &&
		Number.isFinite(imageHeight)
			? `${imageWidth} / ${imageHeight}`
			: undefined;
	const isUnassigned = !isFirst && !isLast && !isExtra;
	const sourceLabel = sourceLabelFor(image.source);
	const assigned =
		[
			isFirst ? "First frame" : null,
			isLast ? "Last frame" : null,
			isExtra ? "Style ref" : null,
		]
			.filter(Boolean)
			.join(" · ") || "On this run";

	const onDownload = async () => {
		if (!image.url || downloading) {
			return;
		}
		setDownloading(true);
		try {
			const filename = `reference-image-${image.id.slice(0, 8)}.png`;
			await downloadImageFile(image.url, filename);
		} catch (error) {
			notifyStudioError("Could not download image", error);
		} finally {
			setDownloading(false);
		}
	};

	return (
		<article
			className={cn(
				"overflow-hidden rounded-xl border bg-card",
				isFirst || isLast || isExtra ? "border-primary/50" : "border-border/70",
			)}
		>
			<div className="flex justify-center overflow-hidden bg-muted/30">
				{image.url ? (
					<img
						src={image.url}
						alt="Reference still"
						className={
							ratio
								? "block max-h-72 w-auto max-w-full object-contain"
								: "block max-h-72 h-auto w-full object-contain"
						}
						style={ratio ? { aspectRatio: ratio } : undefined}
						loading="lazy"
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
								On this run
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
										<span className="text-muted-foreground">id</span>
										<span className="break-all font-mono">{image.id}</span>
									</div>
									<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
										<span className="text-muted-foreground">Added</span>
										<span>{new Date(image.createdAt).toLocaleString()}</span>
									</div>
									<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
										<span className="text-muted-foreground">Source</span>
										<span>{sourceLabel ?? "Unknown"}</span>
									</div>
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
						disabled={busy || downloading || !image.url}
						aria-label="Download image"
						onClick={() => void onDownload()}
					>
						{downloading ? <Loader2 className="animate-spin" /> : <Download />}
					</Button>

					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={busy}
						aria-label="Remove from this run"
						onClick={() => onRemoveImage(image.id)}
					>
						<X />
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
					<RoleChip
						active={isLast}
						label={isLast ? "Last ✓" : "Last"}
						variant="secondary"
						disabled={busy}
						onClick={() => onSelectLastFrame(isLast ? null : image.id)}
					/>
					<RoleChip
						active={isExtra}
						label={isExtra ? "Style ✓" : "Style"}
						variant="secondary"
						disabled={busy}
						onClick={() => onToggleExtraReference(image.id)}
					/>
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
	onReuseImage,
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
	supportsFirstFrame,
	supportsLastFrame,
	supportsInputReferences,
	maxInputReferences = 0,
	disabled,
	globalBusy,
}: ReferenceImagePanelProps) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [dragActive, setDragActive] = useState(false);
	const [reuseOpen, setReuseOpen] = useState(false);
	const [reusingId, setReusingId] = useState<string | null>(null);
	const gallery = useQuery(
		api.studio.queries.listGalleryImages,
		reuseOpen ? { limit: 80 } : "skip",
	);
	const galleryKeys = useMemo(
		() => (gallery ?? []).map((item: { objectKey?: string }) => item.objectKey),
		[gallery],
	);
	const galleryUrls = useSignedMediaUrls(galleryKeys);
	const estimate =
		GPT_IMAGE_ESTIMATES_USD[
			(imageSize as keyof typeof GPT_IMAGE_ESTIMATES_USD) ?? "1024x1536"
		]?.[imageQuality as "low" | "medium" | "high"] ??
		GPT_IMAGE_ESTIMATES_USD["1024x1536"].medium;
	const uploadBusy = Boolean(disabled || uploading || globalBusy);
	const generateBusy = Boolean(
		disabled || generating || uploading || globalBusy,
	);
	const configBusy = Boolean(disabled || generating || globalBusy);
	const attachedIds = new Set(images.map((image) => image.id));
	const warnings = referenceCapabilityWarnings({
		supportsFirstFrame,
		supportsLastFrame,
		supportsInputReferences,
		maxInputReferences,
		firstFrameImageId,
		lastFrameImageId,
		extraReferenceImageIds,
	});

	const handleFiles = async (files: FileList | null) => {
		const file = files?.[0];
		if (!file || uploadBusy) {
			return;
		}
		await onUpload(file);
		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	};

	return (
		<section className="space-y-4 border-t border-border/80 pt-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="font-heading text-lg font-semibold">
						Reference images
					</h2>
					<p className="text-sm text-muted-foreground">
						Generate, upload, or reuse stills, then optionally assign first /
						last / style roles.
					</p>
				</div>
				{images.length > 0 ? (
					<p className="text-xs text-muted-foreground">
						{images.length} on this run
						{firstFrameImageId ||
						lastFrameImageId ||
						extraReferenceImageIds.length
							? ` · ${[firstFrameImageId ? "first" : null, lastFrameImageId ? "last" : null, extraReferenceImageIds.length ? `${extraReferenceImageIds.length} style` : null].filter(Boolean).join(" · ")}`
							: ""}
					</p>
				) : null}
			</div>

			{warnings.length > 0 ? (
				<div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
					<ul className="list-disc space-y-1 pl-4">
						{warnings.map((warning) => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
				</div>
			) : null}

			<div className="rounded-2xl border border-border/70 bg-muted/15 p-3 sm:p-4">
				<div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto_auto] sm:items-end">
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs">Aspect ratio</Label>
						<Select
							value={imageSize}
							onValueChange={(value) => value && onSizeChange(value)}
							disabled={configBusy}
						>
							<SelectTrigger className="h-9">
								<SelectValue>
									{imageSize === "1024x1024"
										? "Square 1:1"
										: imageSize === "1536x1024"
											? "Landscape 3:2"
											: "Portrait 2:3"}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="1024x1536">Portrait 2:3</SelectItem>
								<SelectItem value="1024x1024">Square 1:1</SelectItem>
								<SelectItem value="1536x1024">Landscape 3:2</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs">Quality</Label>
						<Select
							value={imageQuality}
							onValueChange={(value) => value && onQualityChange(value)}
							disabled={configBusy}
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
					<Button className="h-9" onClick={onGenerate} disabled={generateBusy}>
						{generating ? "Generating…" : "Generate"}
					</Button>
					<Button
						className="h-9"
						variant="outline"
						disabled={uploadBusy}
						onClick={() => fileInputRef.current?.click()}
					>
						<Upload data-icon="inline-start" />
						{uploading ? "Uploading…" : "Upload"}
					</Button>
					<Button
						className="h-9"
						variant="outline"
						disabled={Boolean(disabled || globalBusy) || !onReuseImage}
						onClick={() => setReuseOpen(true)}
					>
						<Images data-icon="inline-start" />
						Reuse Image
					</Button>
				</div>
				<div className="mt-2 flex items-center">
					<Popover>
						<PopoverTrigger
							render={
								<button
									type="button"
									className="inline-flex h-6 items-center gap-1 rounded px-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								>
									<Info data-icon="inline-start" className="size-3.5" />
									Pricing
								</button>
							}
						/>
						<PopoverContent align="end" className="w-72 gap-3 p-4">
							<PopoverHeader>
								<PopoverTitle>Image pricing</PopoverTitle>
								<PopoverDescription>
									Rough estimate for a {imageQuality} image: ~$
									{estimate.toFixed(3)}. Actual cost depends on the provider and
									appears in each image’s details.
								</PopoverDescription>
							</PopoverHeader>
						</PopoverContent>
					</Popover>
				</div>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif"
					className="sr-only"
					disabled={uploadBusy}
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
					uploadBusy ? "opacity-60" : "cursor-pointer",
				)}
				onDragEnter={(event) => {
					event.preventDefault();
					event.stopPropagation();
					if (!uploadBusy) setDragActive(true);
				}}
				onDragOver={(event) => {
					event.preventDefault();
					event.stopPropagation();
					if (!uploadBusy) setDragActive(true);
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
					if (!uploadBusy) fileInputRef.current?.click();
				}}
				onKeyDown={(event) => {
					if (uploadBusy) return;
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						fileInputRef.current?.click();
					}
				}}
				role="button"
				tabIndex={uploadBusy ? -1 : 0}
			>
				Drop an image here, or click to browse · PNG / JPEG / WebP / GIF · max
				20MB
			</div>

			{images.length > 0 ? (
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
					{images.map((image) => (
						<ReferenceImageCard
							key={image.id}
							image={image}
							isFirst={firstFrameImageId === image.id}
							isLast={lastFrameImageId === image.id}
							isExtra={extraReferenceImageIds.includes(image.id)}
							busy={Boolean(disabled || globalBusy)}
							onSelectFirstFrame={onSelectFirstFrame}
							onSelectLastFrame={onSelectLastFrame}
							onToggleExtraReference={onToggleExtraReference}
							onRemoveImage={onRemoveImage}
						/>
					))}
				</div>
			) : null}

			<Dialog open={reuseOpen} onOpenChange={setReuseOpen}>
				<DialogContent className="max-h-[min(40rem,90vh)] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>Reuse an image</DialogTitle>
						<DialogDescription>
							Attach a still from the shared gallery to this run. Removing it
							later only unlinks it.
						</DialogDescription>
					</DialogHeader>
					{gallery === undefined ? (
						<p className="text-sm text-muted-foreground">Loading gallery…</p>
					) : gallery.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							The gallery is empty. Generate or upload an image first.
						</p>
					) : (
						<div className="grid gap-3 sm:grid-cols-2">
							{gallery.map(
								(item: {
									id: string;
									objectKey: string;
									source?: ReferenceImageItem["source"];
									createdAt: number;
									meta?: {
										width?: number;
										height?: number;
									};
								}) => {
									const withUrl = withSignedUrl(item, galleryUrls);
									const attached = attachedIds.has(item.id);
									const itemWidth = item.meta?.width;
									const itemHeight = item.meta?.height;
									const itemRatio =
										itemWidth &&
										itemHeight &&
										Number.isFinite(itemWidth) &&
										Number.isFinite(itemHeight)
											? `${itemWidth} / ${itemHeight}`
											: undefined;
									return (
										<button
											key={item.id}
											type="button"
											disabled={attached || reusingId !== null}
											className={cn(
												"overflow-hidden rounded-xl border text-left",
												attached
													? "border-border/50 opacity-60"
													: "border-border/80 hover:border-primary/50",
											)}
											onClick={() => {
												if (!onReuseImage || attached) return;
												setReusingId(item.id);
												void Promise.resolve(onReuseImage(item.id))
													.then(() => setReuseOpen(false))
													.catch((error) =>
														notifyStudioError("Could not reuse image", error),
													)
													.finally(() => setReusingId(null));
											}}
										>
											{withUrl.url ? (
												<div className="flex justify-center overflow-hidden bg-muted/40">
													<img
														src={withUrl.url}
														alt=""
														className={
															itemRatio
																? "block max-h-60 w-auto max-w-full object-contain"
																: "block max-h-60 h-auto w-full object-contain"
														}
														style={
															itemRatio ? { aspectRatio: itemRatio } : undefined
														}
														loading="lazy"
													/>
												</div>
											) : (
												<div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
													Preview unavailable
												</div>
											)}
											<div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
												<span>{sourceLabelFor(item.source) ?? "Gallery"}</span>
												<span className="text-muted-foreground">
													{attached
														? "On this run"
														: reusingId === item.id
															? "Attaching…"
															: "Attach"}
												</span>
											</div>
										</button>
									);
								},
							)}
						</div>
					)}
				</DialogContent>
			</Dialog>
		</section>
	);
}
