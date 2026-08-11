import wasmUrl from "@ffmpeg/core/wasm?url";
import coreUrl from "@ffmpeg/core?url";

type MergeVideoSource = {
	url?: string | null;
};

type MergeOptions = {
	onProgress?: (progress: number) => void;
};

function triggerDownload(blob: Blob) {
	const objectUrl = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = objectUrl;
	link.download = `composed-video-${Date.now()}.mp4`;
	link.style.display = "none";
	document.body.append(link);
	link.click();
	link.remove();
	window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export async function downloadMergedComposition(
	videos: MergeVideoSource[],
	options: MergeOptions = {},
) {
	const sources = videos
		.map((video) => video.url)
		.filter((url): url is string => Boolean(url));
	if (sources.length === 0) {
		throw new Error("No completed clips are available to merge.");
	}
	if (sources.length === 1) {
		const response = await fetch(sources[0]);
		if (!response.ok) {
			throw new Error(`Could not download the clip (${response.status}).`);
		}
		triggerDownload(await response.blob());
		return;
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
				const response = await fetch(source);
				if (!response.ok) {
					throw new Error(
						`Could not download clip ${index + 1} (${response.status}).`,
					);
				}
				await ffmpeg.writeFile(
					inputNames[index],
					new Uint8Array(await response.arrayBuffer()),
				);
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
		triggerDownload(
			new Blob([bytes.buffer as ArrayBuffer], { type: "video/mp4" }),
		);
		options.onProgress?.(100);
	} finally {
		ffmpeg.terminate();
	}
}
