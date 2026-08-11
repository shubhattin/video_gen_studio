import wasmUrl from "@ffmpeg/core/wasm?url";
import coreUrl from "@ffmpeg/core?url";

async function extractWithVideoElement(videoUrl: string): Promise<Blob> {
	const video = document.createElement("video");
	video.crossOrigin = "anonymous";
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	video.src = videoUrl;

	await new Promise<void>((resolve, reject) => {
		video.onloadedmetadata = () => resolve();
		video.onerror = () =>
			reject(new Error("Could not load clip for continuity-frame extraction."));
	});

	const duration = Number.isFinite(video.duration) ? video.duration : 0;
	const target = Math.max(0, duration - 0.08);
	await new Promise<void>((resolve, reject) => {
		video.onseeked = () => resolve();
		video.onerror = () =>
			reject(new Error("Could not seek to the clip terminal frame."));
		video.currentTime = target;
	});

	const canvas = document.createElement("canvas");
	canvas.width = video.videoWidth || 720;
	canvas.height = video.videoHeight || 1280;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Canvas is unavailable for continuity-frame extraction.");
	}
	context.drawImage(video, 0, 0, canvas.width, canvas.height);
	video.removeAttribute("src");
	video.load();

	const blob = await new Promise<Blob | null>((resolve) => {
		canvas.toBlob((value) => resolve(value), "image/jpeg", 0.92);
	});
	if (!blob) {
		throw new Error("Could not encode the continuity frame.");
	}
	return blob;
}

async function extractWithFfmpeg(videoUrl: string): Promise<Blob> {
	const response = await fetch(videoUrl);
	if (!response.ok) {
		throw new Error(
			`Could not download clip for continuity frame (${response.status}).`,
		);
	}
	const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
		import("@ffmpeg/ffmpeg"),
		import("@ffmpeg/util"),
	]);
	const ffmpeg = new FFmpeg();
	try {
		await ffmpeg.load({
			coreURL: await toBlobURL(coreUrl, "text/javascript"),
			wasmURL: await toBlobURL(wasmUrl, "application/wasm"),
		});
		await ffmpeg.writeFile(
			"clip.mp4",
			new Uint8Array(await response.arrayBuffer()),
		);
		const code = await ffmpeg.exec([
			"-sseof",
			"-0.1",
			"-i",
			"clip.mp4",
			"-frames:v",
			"1",
			"-q:v",
			"2",
			"frame.jpg",
		]);
		if (code !== 0) {
			throw new Error("FFmpeg could not extract the continuity frame.");
		}
		const frame = await ffmpeg.readFile("frame.jpg");
		if (typeof frame === "string") {
			throw new Error("Unexpected continuity-frame payload.");
		}
		return new Blob([new Uint8Array(frame)], { type: "image/jpeg" });
	} finally {
		ffmpeg.terminate();
	}
}

/** Grab a near-end JPEG frame from a completed composition clip. */
export async function extractCompositionTerminalFrame(
	videoUrl: string,
): Promise<Blob> {
	try {
		return await extractWithVideoElement(videoUrl);
	} catch {
		return await extractWithFfmpeg(videoUrl);
	}
}
