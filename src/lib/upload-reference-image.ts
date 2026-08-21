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

type UploadReferenceImageArgs<RunId extends string> = {
	runId: RunId;
	file: File;
	prepareUpload: (args: {
		runId: RunId;
		mimeType: string;
		bytes?: number;
	}) => Promise<{
		uploadUrl: string;
		objectKey: string;
		contentType: string;
	}>;
	finalizeUpload: (args: {
		runId: RunId;
		objectKey: string;
		mimeType: string;
		width?: number;
		height?: number;
		bytes?: number;
		setAsFirstFrame?: boolean;
	}) => Promise<{ imageId: string }>;
};

export async function uploadReferenceImage<RunId extends string>({
	runId,
	file,
	prepareUpload,
	finalizeUpload,
}: UploadReferenceImageArgs<RunId>) {
	assertReferenceImageFile(file);
	const dimensions = await readImageDimensions(file);
	const mimeType = file.type || "image/png";
	const prepared = await prepareUpload({
		runId,
		mimeType,
		bytes: file.size,
	});
	const result = await fetch(prepared.uploadUrl, {
		method: "PUT",
		headers: { "Content-Type": prepared.contentType },
		body: file,
	});
	if (!result.ok) {
		throw new Error("Failed to upload image to storage.");
	}
	return await finalizeUpload({
		runId,
		objectKey: prepared.objectKey,
		mimeType,
		width: dimensions?.width,
		height: dimensions?.height,
		bytes: file.size,
	});
}
