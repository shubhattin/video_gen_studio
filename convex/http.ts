import { httpRouter } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { env, httpAction } from "./_generated/server";
import { requireAdmin } from "./lib/auth";

const http = httpRouter();

function mediaCorsHeaders() {
	const origin = env.VIDEO_APP_ORIGIN?.trim();
	const headers: Record<string, string> = {
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
		"Access-Control-Expose-Headers":
			"Content-Length, Content-Type, Content-Range",
		"Access-Control-Max-Age": "86400",
		Vary: "Origin",
	};
	if (origin) {
		headers["Access-Control-Allow-Origin"] = origin;
	}
	return headers;
}

function corsResponse(body: BodyInit | null, init: ResponseInit = {}) {
	const headers = new Headers(init.headers);
	for (const [key, value] of Object.entries(mediaCorsHeaders())) {
		headers.set(key, value);
	}
	return new Response(body, { ...init, headers });
}

function authorizationFailureResponse(error: unknown) {
	const message = error instanceof Error ? error.message : "Unauthorized";
	const status = message === "Not authenticated." ? 401 : 403;
	return corsResponse(message, { status });
}

http.route({
	path: "/studio/media",
	method: "OPTIONS",
	handler: httpAction(async () => {
		return corsResponse(null, { status: 204 });
	}),
});

http.route({
	path: "/studio/media",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		try {
			await requireAdmin(ctx);
		} catch (error) {
			return authorizationFailureResponse(error);
		}

		const url = new URL(request.url);
		const runId = url.searchParams.get("runId");
		const objectKey = url.searchParams.get("objectKey");
		if (!runId || !objectKey) {
			return corsResponse("Missing runId or objectKey", { status: 400 });
		}
		if (!objectKey.startsWith(`studio/runs/${runId}/`)) {
			return corsResponse("Invalid object key", { status: 400 });
		}

		const allowed = await ctx.runQuery(
			internal.studio.queries.objectKeyBelongsToRun,
			{
				runId: runId as Id<"generationRuns">,
				objectKey,
			},
		);
		if (!allowed) {
			return corsResponse("Not found", { status: 404 });
		}

		const signedUrl = await ctx.runAction(
			internal.studio.r2.createInternalReadUrl,
			{ objectKey },
		);
		const upstream = await fetch(signedUrl);
		if (!upstream.ok || !upstream.body) {
			return corsResponse(`Upstream fetch failed (${upstream.status})`, {
				status: upstream.status === 404 ? 404 : 502,
			});
		}

		const headers = new Headers(mediaCorsHeaders());
		headers.set(
			"Content-Type",
			upstream.headers.get("Content-Type") ?? "application/octet-stream",
		);
		const contentLength = upstream.headers.get("Content-Length");
		if (contentLength) {
			headers.set("Content-Length", contentLength);
		}
		const contentRange = upstream.headers.get("Content-Range");
		if (contentRange) {
			headers.set("Content-Range", contentRange);
		}
		headers.set("Cache-Control", "private, max-age=300");

		return new Response(upstream.body, {
			status: 200,
			headers,
		});
	}),
});

export default http;
