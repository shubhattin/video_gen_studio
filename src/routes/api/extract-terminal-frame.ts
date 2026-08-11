import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileRoute } from "@tanstack/react-router";

const MAX_SOURCE_BYTES = 80 * 1024 * 1024;

/**
 * Prefer the binary copied into the Nitro server output. Never import
 * `ffmpeg-static` in this ESM bundle — its package uses `__dirname` and
 * crashes Vercel/Nitro SSR entry loading.
 */
function resolveFfmpegBinary(): string {
	const candidates = [
		join(process.cwd(), "_libs", "ffmpeg"),
		join(process.cwd(), ".output", "server", "_libs", "ffmpeg"),
		join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
	];
	for (const candidate of candidates) {
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			try {
				accessSync(candidate, constants.R_OK);
				return candidate;
			} catch {
				// try next candidate
			}
		}
	}
	throw new Error("FFmpeg binary is unavailable in this server runtime.");
}

function hasMatchingSecret(request: Request) {
	const expected = process.env.VIDEO_PROCESSOR_SHARED_SECRET;
	const received = request.headers.get("x-video-processor-secret");
	if (!expected || !received) {
		return false;
	}
	const expectedBytes = Buffer.from(expected);
	const receivedBytes = Buffer.from(received);
	return (
		expectedBytes.length === receivedBytes.length &&
		timingSafeEqual(expectedBytes, receivedBytes)
	);
}

function allowedSourceUrl(value: unknown): URL | null {
	if (typeof value !== "string") {
		return null;
	}
	try {
		const url = new URL(value);
		const allowedOrigin = process.env.VIDEO_PROCESSOR_ALLOWED_SOURCE_ORIGIN;
		if (
			url.protocol !== "https:" ||
			!allowedOrigin ||
			url.origin !== allowedOrigin
		) {
			return null;
		}
		return url;
	} catch {
		return null;
	}
}

async function runFfmpeg(args: string[]) {
	const binaryPath = resolveFfmpegBinary();
	await new Promise<void>((resolve, reject) => {
		const process = spawn(binaryPath, args, {
			stdio: "ignore",
		}) as ChildProcess;
		process.once("error", reject);
		process.once("close", (code: number | null) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`FFmpeg exited with code ${code ?? "unknown"}.`));
		});
	});
}

export const Route = createFileRoute("/api/extract-terminal-frame")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				if (!hasMatchingSecret(request)) {
					return new Response("Unauthorized", { status: 401 });
				}
				const body: unknown = await request.json().catch(() => null);
				const sourceUrl = allowedSourceUrl(
					body && typeof body === "object"
						? (body as { sourceUrl?: unknown }).sourceUrl
						: null,
				);
				if (!sourceUrl) {
					return new Response("Invalid or untrusted source URL.", {
						status: 400,
					});
				}

				const sourceResponse = await fetch(sourceUrl, {
					signal: AbortSignal.timeout(45_000),
				});
				if (!sourceResponse.ok || !sourceResponse.body) {
					return new Response("Could not fetch source video.", { status: 502 });
				}
				const contentLength = Number(
					sourceResponse.headers.get("content-length"),
				);
				if (
					Number.isFinite(contentLength) &&
					contentLength > MAX_SOURCE_BYTES
				) {
					return new Response("Source video exceeds the 80MB limit.", {
						status: 413,
					});
				}
				const sourceBytes = new Uint8Array(await sourceResponse.arrayBuffer());
				if (sourceBytes.byteLength > MAX_SOURCE_BYTES) {
					return new Response("Source video exceeds the 80MB limit.", {
						status: 413,
					});
				}

				const workDir = await mkdtemp(join(tmpdir(), "lipi-terminal-frame-"));
				const sourcePath = join(workDir, `${randomUUID()}.mp4`);
				const framePath = join(workDir, `${randomUUID()}.jpg`);
				try {
					await writeFile(sourcePath, sourceBytes);
					await runFfmpeg([
						"-sseof",
						"-0.1",
						"-i",
						sourcePath,
						"-frames:v",
						"1",
						"-q:v",
						"2",
						"-y",
						framePath,
					]);
					const frame = await readFile(framePath);
					return new Response(frame, {
						headers: {
							"Content-Type": "image/jpeg",
							"Cache-Control": "no-store",
						},
					});
				} catch (error) {
					console.error("Terminal-frame extraction failed", error);
					return new Response("Could not extract the terminal frame.", {
						status: 500,
					});
				} finally {
					await rm(workDir, { recursive: true, force: true });
				}
			},
		},
	},
});
