"use node";

import { OPENROUTER_APP_HEADERS } from "./appInfo";
import { AUDIO_MODEL_PROFILES, type AudioModelId } from "./audioCatalog";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Stay under the 10-minute Convex Node action limit with headroom for the
 * R2 upload and DB writes. Lyria Pro songs typically land in 1–3 minutes.
 */
const AUDIO_REQUEST_TIMEOUT_MS = 8 * 60 * 1000;

export type OpenRouterAudioResult = {
	bytes: Uint8Array;
	mimeType: "audio/mpeg";
	/** Lyria's timed lyrics / structure text (or `<instrumental>`). */
	outputText?: string;
	durationSeconds?: number;
	generationId?: string;
	costUsd?: number;
};

type ContentPart =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string } };

type StreamChunk = {
	id?: string;
	error?: { message?: string; code?: number | string };
	choices?: Array<{
		delta?: {
			content?: string | null;
			audio?: { data?: string };
		};
		finish_reason?: string | null;
	}>;
	usage?: { cost?: number };
};

const MPEG1_LAYER3_KBPS = [
	0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];

/**
 * Approximate MP3 length from the first frame's bitrate (Lyria emits CBR).
 * Good enough for gallery metadata; players read the exact length.
 */
export function estimateMp3DurationSeconds(bytes: Uint8Array): number | undefined {
	let offset = 0;
	if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
		const size =
			((bytes[6] & 0x7f) << 21) |
			((bytes[7] & 0x7f) << 14) |
			((bytes[8] & 0x7f) << 7) |
			(bytes[9] & 0x7f);
		offset = 10 + size;
	}
	for (let i = offset; i < Math.min(bytes.length - 4, offset + 8192); i++) {
		if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
		const versionBits = (bytes[i + 1] >> 3) & 0x03;
		const layerBits = (bytes[i + 1] >> 1) & 0x03;
		if (versionBits !== 0x03 || layerBits !== 0x01) continue;
		const kbps = MPEG1_LAYER3_KBPS[(bytes[i + 2] >> 4) & 0x0f];
		if (!kbps) continue;
		const seconds = ((bytes.length - i) * 8) / (kbps * 1000);
		return Math.round(seconds * 10) / 10;
	}
	return undefined;
}

/**
 * Generate audio through OpenRouter chat completions. Audio output requires
 * `stream: true`; the base64 audio, text, and final usage are accumulated
 * from the SSE stream.
 */
export async function generateOpenRouterAudio(args: {
	apiKey: string;
	modelId: AudioModelId;
	prompt: string;
	imageDataUrls?: string[];
}): Promise<OpenRouterAudioResult> {
	const profile = AUDIO_MODEL_PROFILES[args.modelId];
	const images = (args.imageDataUrls ?? []).slice(0, profile.maxInputImages);
	const userContent: string | ContentPart[] =
		images.length > 0
			? [
					{ type: "text", text: args.prompt },
					...images.map(
						(url): ContentPart => ({ type: "image_url", image_url: { url } }),
					),
				]
			: args.prompt;

	const body = {
		model: args.modelId,
		modalities: ["text", "audio"],
		audio: { format: "mp3" },
		stream: true,
		stream_options: { include_usage: true },
		messages: [{ role: "user", content: userContent }],
	};

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), AUDIO_REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(OPENROUTER_CHAT_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${args.apiKey}`,
				"Content-Type": "application/json",
				...OPENROUTER_APP_HEADERS,
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		if (!response.ok || !response.body) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`Audio generation failed (${response.status}): ${extractErrorMessage(text)}`,
			);
		}

		const audioParts: string[] = [];
		let contentText = "";
		let generationId: string | undefined;
		let costUsd: number | undefined;

		const handleChunk = (chunk: StreamChunk) => {
			if (chunk.error) {
				throw new Error(
					`Audio generation failed: ${chunk.error.message ?? "provider error"}`,
				);
			}
			generationId = chunk.id ?? generationId;
			for (const choice of chunk.choices ?? []) {
				const delta = choice.delta;
				if (delta?.audio?.data) audioParts.push(delta.audio.data);
				if (delta?.content) contentText += delta.content;
			}
			if (typeof chunk.usage?.cost === "number") {
				costUsd = chunk.usage.cost;
			}
		};

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		for (;;) {
			const { done, value } = await reader.read();
			if (value) buffer += decoder.decode(value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline !== -1) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				if (line.startsWith("data:")) {
					const data = line.slice(5).trim();
					if (data && data !== "[DONE]") {
						handleChunk(JSON.parse(data) as StreamChunk);
					}
				}
				newline = buffer.indexOf("\n");
			}
			if (done) break;
		}

		if (audioParts.length === 0) {
			const said = contentText.trim();
			throw new Error(
				said
					? `The model returned no audio. It said: ${said.slice(0, 300)}`
					: "The model returned no audio.",
			);
		}

		const raw = new Uint8Array(Buffer.from(audioParts.join(""), "base64"));
		const outputText = contentText.trim() || undefined;
		return {
			bytes: raw,
			mimeType: "audio/mpeg",
			outputText,
			durationSeconds:
				profile.fixedDurationSeconds ?? estimateMp3DurationSeconds(raw),
			generationId,
			costUsd,
		};
	} catch (error) {
		if (controller.signal.aborted) {
			throw new Error(
				`Audio generation timed out after ${Math.round(AUDIO_REQUEST_TIMEOUT_MS / 60_000)} minutes.`,
			);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

function extractErrorMessage(text: string): string {
	try {
		const parsed = JSON.parse(text) as {
			error?: { message?: string; metadata?: { raw?: string } };
		};
		const raw = parsed.error?.metadata?.raw;
		if (raw) {
			try {
				const inner = JSON.parse(raw) as { error?: { message?: string } };
				if (inner.error?.message) return inner.error.message;
			} catch {
				// raw was not JSON — fall through.
			}
		}
		return parsed.error?.message ?? (text.slice(0, 300) || "unknown error");
	} catch {
		return text.slice(0, 300) || "unknown error";
	}
}
