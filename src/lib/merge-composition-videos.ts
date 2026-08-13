import wasmUrl from "@ffmpeg/core/wasm?url";
import coreUrl from "@ffmpeg/core?url";
import { fetchStudioMedia } from "#/lib/studio-media-proxy";

export type MergeVideoSource = {
	url?: string | null;
	objectKey?: string | null;
	runId?: string | null;
};

type MergeOptions = {
	onProgress?: (progress: number) => void;
	/** When set, reuse a previously merged blob for the same clip set. */
	cacheKey?: string;
};

type CachedMerge = {
	blob: Blob;
	objectUrl: string;
};

const mergeCache = new Map<string, CachedMerge>();

export function compositionMergeCacheKey(sources: MergeVideoSource[]) {
	const parts = sources
		.map((source) => source.objectKey ?? source.url ?? "")
		.filter(Boolean);
	return parts.join("|");
}

export function getCachedMergedComposition(
	cacheKey: string,
): CachedMerge | null {
	return mergeCache.get(cacheKey) ?? null;
}

export function clearMergedCompositionCache(cacheKey?: string) {
	if (cacheKey) {
		const cached = mergeCache.get(cacheKey);
		if (cached) {
			URL.revokeObjectURL(cached.objectUrl);
			mergeCache.delete(cacheKey);
		}
		return;
	}
	for (const cached of mergeCache.values()) {
		URL.revokeObjectURL(cached.objectUrl);
	}
	mergeCache.clear();
}

function rememberMerge(cacheKey: string | undefined, blob: Blob): CachedMerge {
	if (!cacheKey) {
		return { blob, objectUrl: URL.createObjectURL(blob) };
	}
	const existing = mergeCache.get(cacheKey);
	if (existing) {
		URL.revokeObjectURL(existing.objectUrl);
	}
	const entry = { blob, objectUrl: URL.createObjectURL(blob) };
	mergeCache.set(cacheKey, entry);
	return entry;
}

async function fetchMediaBytes(source: MergeVideoSource): Promise<ArrayBuffer> {
	const directUrl = source.url ?? null;
	const canProxy = Boolean(source.runId && source.objectKey);

	const readOk = async (response: Response) => {
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		return await response.arrayBuffer();
	};

	const tryDirect = async (url: string) => {
		const response = await fetch(url, { cache: "no-store" });
		return await readOk(response);
	};

	const tryProxy = async () => {
		if (!source.runId || !source.objectKey) {
			throw new Error("No clip URL available.");
		}
		return await readOk(
			await fetchStudioMedia({
				runId: source.runId,
				objectKey: source.objectKey,
			}),
		);
	};

	if (directUrl) {
		try {
			return await tryDirect(directUrl);
		} catch (error) {
			if (!canProxy) {
				throw error instanceof Error
					? error
					: new Error("Could not download clip from storage.");
			}
			return await tryProxy();
		}
	}

	if (canProxy) {
		return await tryProxy();
	}

	throw new Error("No clip URL available.");
}

export function triggerMergedDownload(blob: Blob, filename?: string) {
	const objectUrl = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = objectUrl;
	link.download = filename ?? `composed-video-${Date.now()}.mp4`;
	link.style.display = "none";
	document.body.append(link);
	link.click();
	link.remove();
	window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/** Merge clips into a single MP4 blob. Reuses cache when `cacheKey` matches. */
export async function mergeCompositionVideos(
	videos: MergeVideoSource[],
	options: MergeOptions = {},
): Promise<CachedMerge> {
	const sources = videos.filter(
		(video) => Boolean(video.url) || (video.runId && video.objectKey),
	);
	if (sources.length === 0) {
		throw new Error("No completed clips are available to merge.");
	}

	const cacheKey = options.cacheKey ?? compositionMergeCacheKey(sources);
	const cached = mergeCache.get(cacheKey);
	if (cached) {
		options.onProgress?.(100);
		return cached;
	}

	if (sources.length === 1) {
		const blob = new Blob([await fetchMediaBytes(sources[0])], {
			type: "video/mp4",
		});
		options.onProgress?.(100);
		return rememberMerge(cacheKey, blob);
	}

	const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
		import("@ffmpeg/ffmpeg"),
		import("@ffmpeg/util"),
	]);
	const ffmpeg = new FFmpeg();
	ffmpeg.on("progress", ({ progress }) => {
		options.onProgress?.(Math.round(Math.min(Math.max(progress, 0), 1) * 100));
	});

	const inputNames = sources.map((_, index) => `clip-${index}.mp4`);
	try {
		await ffmpeg.load({
			coreURL: await toBlobURL(coreUrl, "text/javascript"),
			wasmURL: await toBlobURL(wasmUrl, "application/wasm"),
		});
		await Promise.all(
			sources.map(async (source, index) => {
				try {
					await ffmpeg.writeFile(
						inputNames[index],
						new Uint8Array(await fetchMediaBytes(source)),
					);
				} catch (error) {
					throw new Error(
						`Could not download clip ${index + 1}${
							error instanceof Error ? ` (${error.message})` : ""
						}.`,
					);
				}
			}),
		);
		await ffmpeg.writeFile(
			"concat.txt",
			inputNames.map((name) => `file '${name}'`).join("\n"),
		);

		let merged = false;
		try {
			const code = await ffmpeg.exec([
				"-f",
				"concat",
				"-safe",
				"0",
				"-i",
				"concat.txt",
				"-c",
				"copy",
				"-movflags",
				"+faststart",
				"merged.mp4",
			]);
			merged = code === 0;
		} catch {
			merged = false;
		}
		if (!merged) {
			const code = await ffmpeg.exec([
				"-f",
				"concat",
				"-safe",
				"0",
				"-i",
				"concat.txt",
				"-c:v",
				"libx264",
				"-preset",
				"veryfast",
				"-crf",
				"22",
				"-c:a",
				"aac",
				"-movflags",
				"+faststart",
				"merged.mp4",
			]);
			if (code !== 0) {
				throw new Error("Local MP4 merge failed.");
			}
		}
		const output = await ffmpeg.readFile("merged.mp4");
		const bytes =
			output instanceof Uint8Array ? output : new TextEncoder().encode(output);
		const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "video/mp4" });
		options.onProgress?.(100);
		return rememberMerge(cacheKey, blob);
	} finally {
		ffmpeg.terminate();
	}
}

export async function downloadMergedComposition(
	videos: MergeVideoSource[],
	options: MergeOptions = {},
) {
	const merged = await mergeCompositionVideos(videos, options);
	triggerMergedDownload(merged.blob);
}
