/**
 * OpenRouter async video API client.
 * Method: POST /api/v1/videos → poll GET /api/v1/videos/{jobId} → download unsigned_urls.
 * Kept explicit (not AI SDK video wrapper) for reliable job IDs, timeouts, and Convex Node actions.
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export type OpenRouterVideoStatus =
	| "pending"
	| "in_progress"
	| "completed"
	| "failed"
	| "cancelled"
	| "expired";

export type OpenRouterFrameImage = {
	type: "image_url";
	image_url: { url: string };
	frame_type: "first_frame" | "last_frame";
};

export type OpenRouterInputReference = {
	type: "image_url";
	image_url: { url: string };
};

export type OpenRouterVideoSubmitBody = {
	model: string;
	prompt: string;
	duration?: number;
	resolution?: string;
	aspect_ratio?: string;
	generate_audio?: boolean;
	seed?: number;
	frame_images?: OpenRouterFrameImage[];
	input_references?: OpenRouterInputReference[];
	provider?: {
		options?: Record<string, { parameters?: Record<string, unknown> }>;
	};
};

export type OpenRouterVideoJob = {
	id: string;
	polling_url: string;
	status: OpenRouterVideoStatus;
	generation_id?: string;
	unsigned_urls?: string[];
	error?: string;
	usage?: { cost?: number | null; is_byok?: boolean };
};

function authHeaders(apiKey: string): HeadersInit {
	return {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
		"HTTP-Referer": "https://shloka-video-studio.local",
		"X-Title": "Shloka Video Studio",
	};
}

async function parseError(response: Response): Promise<string> {
	const text = await response.text();
	try {
		const json = JSON.parse(text) as {
			error?: { message?: string } | string;
		};
		if (typeof json.error === "string") {
			return json.error;
		}
		if (json.error?.message) {
			return json.error.message;
		}
	} catch {
		/* fall through */
	}
	return text || `OpenRouter HTTP ${response.status}`;
}

export async function submitOpenRouterVideoJob(
	apiKey: string,
	body: OpenRouterVideoSubmitBody,
): Promise<OpenRouterVideoJob> {
	const response = await fetch(`${OPENROUTER_BASE}/videos`, {
		method: "POST",
		headers: authHeaders(apiKey),
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		throw new Error(await parseError(response));
	}
	return (await response.json()) as OpenRouterVideoJob;
}

export async function pollOpenRouterVideoJob(
	apiKey: string,
	job: OpenRouterVideoJob,
): Promise<OpenRouterVideoJob> {
	const pollingUrl = job.polling_url.startsWith("http")
		? job.polling_url
		: new URL(job.polling_url, OPENROUTER_BASE).toString();
	const response = await fetch(pollingUrl, {
		headers: authHeaders(apiKey),
	});
	if (!response.ok) {
		throw new Error(await parseError(response));
	}
	return (await response.json()) as OpenRouterVideoJob;
}

export async function waitForOpenRouterVideoJob(
	apiKey: string,
	initial: OpenRouterVideoJob,
	options?: {
		intervalMs?: number;
		timeoutMs?: number;
		onStatus?: (job: OpenRouterVideoJob) => void | Promise<void>;
	},
): Promise<OpenRouterVideoJob> {
	const intervalMs = options?.intervalMs ?? 8000;
	const timeoutMs = options?.timeoutMs ?? 540_000;
	const started = Date.now();
	let job = initial;

	while (true) {
		if (job.status === "completed") {
			return job;
		}
		if (
			job.status === "failed" ||
			job.status === "cancelled" ||
			job.status === "expired"
		) {
			throw new Error(
				job.error ?? `Video generation ${job.status} (job ${job.id}).`,
			);
		}
		if (Date.now() - started >= timeoutMs) {
			throw new Error(
				`Video generation timed out after ${timeoutMs}ms (job ${job.id}).`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
		job = await pollOpenRouterVideoJob(apiKey, job);
		await options?.onStatus?.(job);
	}
}

export async function downloadOpenRouterVideo(
	apiKey: string,
	job: OpenRouterVideoJob,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
	const url =
		job.unsigned_urls?.[0] ??
		`${OPENROUTER_BASE}/videos/${job.id}/content?index=0`;
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});
	if (!response.ok) {
		throw new Error(await parseError(response));
	}
	const buffer = new Uint8Array(await response.arrayBuffer());
	const mimeType = response.headers.get("content-type") ?? "video/mp4";
	return { bytes: buffer, mimeType };
}

export async function fetchOpenRouterVideoModels(apiKey: string) {
	const response = await fetch(`${OPENROUTER_BASE}/videos/models`, {
		headers: authHeaders(apiKey),
	});
	if (!response.ok) {
		throw new Error(await parseError(response));
	}
	const json = (await response.json()) as { data?: unknown[] };
	return json.data ?? [];
}
