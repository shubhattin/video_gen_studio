import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Download, Info, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import {
	saveDownloadResponse,
	formatBytes,
} from "#/components/studio/video/video-result";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
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
import { notifyStudioError } from "#/lib/studio-toast";

type SortOrder = "latest" | "oldest";

type GalleryImage = {
	id: string;
	objectKey?: string;
	url?: string | null;
	source?: "generated" | "uploaded" | "terminal_frame";
	revisedImagePrompt?: string;
	meta?: { mimeType?: string; width?: number; height?: number; bytes?: number };
	createdAt: number;
};

type RunReference = {
	runId: string;
	title?: string;
	provenance: "shloka" | "model-studio";
	status: string;
};

function runLabel(run: RunReference): string {
	const typeLabel = run.provenance === "shloka" ? "Shloka run" : "Model run";
	return run.title?.trim()
		? `${run.title} · ${typeLabel}`
		: `${typeLabel} (${run.runId.slice(0, 8)}…)`;
}

function sourceLabelFor(source?: GalleryImage["source"]): string | null {
	if (source === "uploaded") return "Uploaded";
	if (source === "generated") return "Generated";
	if (source === "terminal_frame") return "Continuity frame";
	return null;
}

function aspectRatioValue(image: GalleryImage): string | undefined {
	const width = image.meta?.width;
	const height = image.meta?.height;
	if (width && height && Number.isFinite(width) && Number.isFinite(height)) {
		return `${width} / ${height}`;
	}
	return undefined;
}

async function downloadImageFile(image: GalleryImage): Promise<void> {
	if (!image.url) {
		throw new Error("No download URL available");
	}
	const filename = `gallery-image-${image.id.slice(0, 8)}.png`;
	const response = await fetch(image.url, { cache: "no-store" });
	await saveDownloadResponse(response, filename);
}

function GalleryImageCard({
	image,
	onDelete,
	busy,
}: {
	image: GalleryImage;
	onDelete: () => void;
	busy: boolean;
}) {
	const [downloading, setDownloading] = useState(false);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const references = useQuery(
		api.studio.queries.listRunsReferencingImage,
		detailsOpen ? { imageId: image.id as Id<"galleryImages"> } : "skip",
	);
	const ratio = aspectRatioValue(image);
	const sourceLabel = sourceLabelFor(image.source);
	const sizeLabel = formatBytes(image.meta?.bytes);

	const onDownload = async () => {
		if (downloading || !image.url) return;
		setDownloading(true);
		try {
			await downloadImageFile(image);
		} catch (error) {
			notifyStudioError("Could not download image", error);
		} finally {
			setDownloading(false);
		}
	};

	return (
		<article className="mb-4 break-inside-avoid overflow-hidden rounded-2xl border border-border/70 bg-card">
			<div
				className="relative flex w-full items-center justify-center overflow-hidden bg-muted/30"
				style={
					ratio
						? { aspectRatio: ratio, maxHeight: "24rem" }
						: { height: "14rem" }
				}
			>
				{image.url ? (
					<img
						src={image.url}
						alt=""
						className="h-full w-full object-contain"
					/>
				) : (
					<div className="text-sm text-muted-foreground">Image unavailable</div>
				)}
			</div>

			<div className="flex items-center gap-2 px-3 py-2.5">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<div className="flex min-w-0 flex-wrap items-center gap-1.5">
						{sourceLabel ? (
							<Badge variant="outline" className="font-normal">
								{sourceLabel}
							</Badge>
						) : (
							<span className="text-sm font-medium">Gallery image</span>
						)}
					</div>
					<span className="text-xs text-muted-foreground">
						{new Date(image.createdAt).toLocaleString()}
					</span>
				</div>

				<Popover open={detailsOpen} onOpenChange={setDetailsOpen}>
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
								Metadata and runs referencing this image.
							</PopoverDescription>
						</PopoverHeader>
						<div className="flex flex-col gap-2 text-xs">
							<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
								<span className="text-muted-foreground">Source</span>
								<span>{sourceLabel ?? "Gallery image"}</span>
							</div>
							<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
								<span className="text-muted-foreground">Created</span>
								<span>{new Date(image.createdAt).toLocaleString()}</span>
							</div>
							{ratio ? (
								<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
									<span className="text-muted-foreground">Aspect</span>
									<span>{ratio}</span>
								</div>
							) : null}
							{sizeLabel ? (
								<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
									<span className="text-muted-foreground">Size</span>
									<span>{sizeLabel}</span>
								</div>
							) : null}
							{image.revisedImagePrompt?.trim() ? (
								<div className="flex flex-col gap-1.5">
									<span className="text-muted-foreground">Revised prompt</span>
									<p className="max-h-24 overflow-y-auto leading-relaxed text-foreground">
										{image.revisedImagePrompt.trim()}
									</p>
								</div>
							) : null}
						</div>
						<div className="flex flex-col gap-1.5 border-t border-border/70 pt-3">
							<span className="text-xs text-muted-foreground">
								Connected runs
							</span>
							{references === undefined ? (
								<p className="text-xs text-muted-foreground">
									Checking references…
								</p>
							) : references.length === 0 ? (
								<p className="text-xs text-muted-foreground">
									Not referenced by any run.
								</p>
							) : (
								<ul className="flex flex-col gap-1 text-xs">
									{references.map((reference: RunReference) => (
										<li key={reference.runId} className="truncate">
											{runLabel(reference)}
										</li>
									))}
								</ul>
							)}
						</div>
					</PopoverContent>
				</Popover>

				{image.url ? (
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						disabled={downloading}
						aria-label="Download image"
						onClick={() => void onDownload()}
					>
						{downloading ? <Loader2 className="animate-spin" /> : <Download />}
					</Button>
				) : null}

				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					disabled={busy}
					aria-label="Delete image"
					onClick={onDelete}
				>
					<Trash2 />
				</Button>
			</div>
		</article>
	);
}

export function ImageGallery() {
	const [sort, setSort] = useState<SortOrder>("latest");
	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);
	const deleteImage = useMutation(api.studio.mutations.deleteGalleryImage);

	const images = useQuery(api.studio.queries.listGalleryImages, { limit: 80 });
	const objectKeys = (images ?? []).map(
		(image: { objectKey?: string }) => image.objectKey,
	);
	const urlsByKey = useSignedMediaUrls(null, objectKeys);
	const withUrls = (images ?? []).map((image: GalleryImage) =>
		withSignedUrl(image, urlsByKey),
	);

	const deleteReferences = useQuery(
		api.studio.queries.listRunsReferencingImage,
		pendingDeleteId
			? { imageId: pendingDeleteId as Id<"galleryImages"> }
			: "skip",
	);

	const ordered =
		sort === "oldest"
			? [...withUrls].sort((a, b) => a.createdAt - b.createdAt)
			: [...withUrls].sort((a, b) => b.createdAt - a.createdAt);

	const confirmDelete = async () => {
		if (!pendingDeleteId) return;
		setDeleting(true);
		try {
			await deleteImage({ imageId: pendingDeleteId as Id<"galleryImages"> });
			setPendingDeleteId(null);
		} catch (error) {
			notifyStudioError("Could not delete image", error);
		} finally {
			setDeleting(false);
		}
	};

	const referencedBy = deleteReferences as RunReference[] | undefined;
	const deleteReferenceCount = referencedBy?.length ?? 0;

	return (
		<section className="space-y-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
						Image gallery
					</h1>
					<p className="text-sm text-muted-foreground">
						Shared library of generated, uploaded, and continuity images.
						Deleting a run does not remove these files.
					</p>
				</div>
				{images && images.length > 0 ? (
					<Select
						value={sort}
						onValueChange={(value) => value && setSort(value as SortOrder)}
					>
						<SelectTrigger size="sm" aria-label="Sort images">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="latest">Latest</SelectItem>
							<SelectItem value="oldest">Oldest</SelectItem>
						</SelectContent>
					</Select>
				) : null}
			</div>

			{images === undefined ? (
				<p className="text-sm text-muted-foreground">Loading image gallery…</p>
			) : images.length === 0 ? (
				<div className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
					No images yet. Generate, upload, or capture a continuity frame to see
					it here.
				</div>
			) : (
				<div className="columns-2 gap-4 sm:columns-3 lg:columns-4 xl:columns-5">
					{ordered.map((image) => (
						<GalleryImageCard
							key={image.id}
							image={image}
							busy={deleting}
							onDelete={() => setPendingDeleteId(image.id)}
						/>
					))}
				</div>
			)}

			<AlertDialog
				open={pendingDeleteId != null}
				onOpenChange={(open) => {
					if (!open) setPendingDeleteId(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this image?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently removes the image from the shared gallery and
							unlinks it from any runs that reference it. This cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{deleteReferenceCount > 0 && referencedBy ? (
						<div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
							<span className="font-medium text-amber-800 dark:text-amber-200">
								Be careful — this image is used by {deleteReferenceCount}{" "}
								{deleteReferenceCount === 1 ? "run" : "runs"}:
							</span>
							<ul className="flex flex-col gap-1 text-xs text-amber-800/90 dark:text-amber-200/90">
								{referencedBy.map((reference) => (
									<li key={reference.runId} className="truncate">
										{runLabel(reference)}
									</li>
								))}
							</ul>
							<p className="text-xs text-amber-800/90 dark:text-amber-200/90">
								Deleting it will remove the image from those runs. Regenerating
								their plans may be required.
							</p>
						</div>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleting}
							onClick={() => void confirmDelete()}
						>
							{deleting ? "Deleting…" : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}
