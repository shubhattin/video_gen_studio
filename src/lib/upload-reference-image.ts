import type { Id } from "@convex/_generated/dataModel";

const ALLOWED_MIME_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/jpg",
	"image/webp",
	"image/gif",
]);

const MAX_BYTES = 20 * 1024 * 1024;

export async function readImageDimensions(
	file: File,
): Promise<{ width: number; height: number } | null> {
	if (typeof createImageBitmap === "function") {
		try {
			const bitmap = await createImageBitmap(file);
			const size = { width: bitmap.width, height: bitmap.height };
			bitmap.close();
			return size;
		} catch {
			// Fall through to HTMLImageElement path.
		}
	}

	return await new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			resolve({ width: img.naturalWidth, height: img.naturalHeight });
			URL.revokeObjectURL(url);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			resolve(null);
		};
		img.src = url;
	});
}

export function assertReferenceImageFile(file: File) {
	const mimeType = file.type.toLowerCase();
	if (!ALLOWED_MIME_TYPES.has(mimeType)) {
		throw new Error("Unsupported image type. Use PNG, JPEG, WebP, or GIF.");
	}
	if (file.size > MAX_BYTES) {
		throw new Error("Image is too large. Max size is 20MB.");
	}
}

type UploadReferenceImageArgs = {
	runId: Id<"generationRuns">;
	file: File;
	generateUploadUrl: () => Promise<string>;
	attachUploadedReferenceImage: (args: {
		runId: Id<"generationRuns">;
		storageId: Id<"_storage">;
		mimeType: string;
		width?: number;
		height?: number;
		bytes?: number;
	}) => Promise<{ imageId: string }>;
};

export async function uploadReferenceImage({
	runId,
	file,
	generateUploadUrl,
	attachUploadedReferenceImage,
}: UploadReferenceImageArgs) {
	assertReferenceImageFile(file);
	const dimensions = await readImageDimensions(file);
	const postUrl = await generateUploadUrl();
	const result = await fetch(postUrl, {
		method: "POST",
		headers: { "Content-Type": file.type || "application/octet-stream" },
		body: file,
	});
	if (!result.ok) {
		throw new Error("Failed to upload image to storage.");
	}
	const json = (await result.json()) as { storageId?: string };
	if (!json.storageId) {
		throw new Error("Upload succeeded but no storage id was returned.");
	}
	return await attachUploadedReferenceImage({
		runId,
		storageId: json.storageId as Id<"_storage">,
		mimeType: file.type || "image/png",
		width: dimensions?.width,
		height: dimensions?.height,
		bytes: file.size,
	});
}
