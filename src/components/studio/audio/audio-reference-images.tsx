import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { ImagePlus, Images, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Skeleton } from "#/components/ui/skeleton";
import {
	useSignedMediaUrls,
	withSignedUrl,
} from "#/hooks/use-signed-media-urls";
import { notifyStudioError } from "#/lib/studio-toast";
import { cn } from "#/lib/utils";

/** Highest image count any audio model accepts (Lyria). */
export const MAX_AUDIO_REFERENCE_IMAGES = 10;

export type AudioReferenceImage = {
	id: string;
	objectKey?: string;
	url?: string | null;
	meta?: { width?: number; height?: number };
};

type AudioReferenceImagesProps = {
	images: AudioReferenceImage[];
	pendingKeys?: ReadonlySet<string>;
	/** Images the selected model accepts (0 = ignored by this model). */
	modelMaxImages: number;
	modelName: string;
	uploading?: boolean;
	disabled?: boolean;
	onUpload: (file: File) => Promise<void> | void;
	onReuse: (imageId: string) => Promise<void> | void;
	onRemove: (imageId: string) => Promise<void> | void;
};

/**
 * Reference stills sent alongside the prompt to image-capable audio models
 * (Lyria composes music "inspired by" them). Every attached image is sent.
 */
export function AudioReferenceImages({
	images,
	pendingKeys,
	modelMaxImages,
	modelName,
	uploading,
	disabled,
	onUpload,
	onReuse,
	onRemove,
}: AudioReferenceImagesProps) {
	const fileInputRef = useRef<HTMLInputElement>(null);
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
	const { urls: galleryUrls, pendingKeys: galleryPendingKeys } =
		useSignedMediaUrls(galleryKeys);
	const attachedIds = new Set(images.map((image) => image.id));
	const full = images.length >= MAX_AUDIO_REFERENCE_IMAGES;
	const busy = Boolean(disabled || uploading);
	const ignored = modelMaxImages === 0 && images.length > 0;

	return (
		<section className="space-y-3 border-t border-border/80 pt-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="font-heading text-lg font-semibold">
						Reference images
					</h2>
					<p className="text-sm text-muted-foreground">
						Optional stills the music should feel inspired by — e.g. the verse’s
						reference image.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						className="h-9"
						disabled={busy || full}
						onClick={() => fileInputRef.current?.click()}
					>
						<Upload data-icon="inline-start" />
						{uploading ? "Uploading…" : "Upload"}
					</Button>
					<Button
						variant="outline"
						className="h-9"
						disabled={busy || full}
						onClick={() => setReuseOpen(true)}
					>
						<Images data-icon="inline-start" />
						Reuse Image
					</Button>
				</div>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif"
					className="sr-only"
					disabled={busy}
					onChange={(event) => {
						const file = event.target.files?.[0];
						if (file) {
							void Promise.resolve(onUpload(file)).finally(() => {
								if (fileInputRef.current) fileInputRef.current.value = "";
							});
						}
					}}
				/>
			</div>

			{ignored ? (
				<p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
					{modelName} doesn’t accept images — these stay attached and are sent
					when you switch to a Lyria model.
				</p>
			) : null}

			{images.length === 0 ? (
				<button
					type="button"
					disabled={busy}
					onClick={() => fileInputRef.current?.click()}
					className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground transition-colors hover:bg-muted/30 disabled:opacity-60"
				>
					<ImagePlus className="size-4" />
					No images attached · up to {MAX_AUDIO_REFERENCE_IMAGES}
				</button>
			) : (
				<div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
					{images.map((image) => {
						const pending = Boolean(
							image.objectKey && pendingKeys?.has(image.objectKey),
						);
						return (
							<div
								key={image.id}
								className="group relative aspect-square overflow-hidden rounded-xl border border-border/70 bg-muted/30"
							>
								{image.url ? (
									<img
										src={image.url}
										alt=""
										className="size-full object-cover"
										loading="lazy"
									/>
								) : pending ? (
									<Skeleton className="size-full rounded-none" />
								) : (
									<div className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
										Unavailable
									</div>
								)}
								<Button
									type="button"
									size="icon-xs"
									variant="secondary"
									aria-label="Remove image from run"
									disabled={disabled}
									onClick={() => void onRemove(image.id)}
									className="absolute top-1.5 right-1.5 opacity-90 shadow-sm"
								>
									<X />
								</Button>
							</div>
						);
					})}
				</div>
			)}
			{images.length > 0 ? (
				<p className="text-xs text-muted-foreground">
					{images.length} / {MAX_AUDIO_REFERENCE_IMAGES} attached · removing
					only unlinks the image from this run.
				</p>
			) : null}

			<Dialog open={reuseOpen} onOpenChange={setReuseOpen}>
				<DialogContent className="max-h-[min(40rem,90vh)] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>Reuse an image</DialogTitle>
						<DialogDescription>
							Attach a still from the shared gallery to this audio run.
						</DialogDescription>
					</DialogHeader>
					{gallery === undefined ? (
						<p className="text-sm text-muted-foreground">Loading gallery…</p>
					) : gallery.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							The gallery is empty. Upload an image first.
						</p>
					) : (
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
							{gallery.map((item: { id: string; objectKey: string }) => {
								const withUrl = withSignedUrl(item, galleryUrls);
								const attached = attachedIds.has(item.id);
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
											setReusingId(item.id);
											void Promise.resolve(onReuse(item.id))
												.then(() => setReuseOpen(false))
												.catch((error) =>
													notifyStudioError("Could not reuse image", error),
												)
												.finally(() => setReusingId(null));
										}}
									>
										{withUrl.url ? (
											<img
												src={withUrl.url}
												alt=""
												className="aspect-square w-full object-cover"
												loading="lazy"
											/>
										) : galleryPendingKeys.has(item.objectKey) ? (
											<Skeleton className="aspect-square w-full rounded-none" />
										) : (
											<div className="flex aspect-square items-center justify-center text-xs text-muted-foreground">
												Preview unavailable
											</div>
										)}
										<div className="px-2 py-1.5 text-xs text-muted-foreground">
											{attached
												? "On this run"
												: reusingId === item.id
													? "Attaching…"
													: "Attach"}
										</div>
									</button>
								);
							})}
						</div>
					)}
				</DialogContent>
			</Dialog>
		</section>
	);
}
