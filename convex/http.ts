import { httpRouter } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";

const http = httpRouter();

function corsHeaders(): HeadersInit {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	};
}

function safeFilename(raw: string): string {
	const cleaned = raw.replace(/[^\w.\-]+/g, "_").slice(0, 180);
	return cleaned || "studio-video.mp4";
}

http.route({
	path: "/downloadVideo",
	method: "OPTIONS",
	handler: httpAction(async () => {
		return new Response(null, {
			status: 204,
			headers: corsHeaders(),
		});
	}),
});

http.route({
	path: "/downloadVideo",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const url = new URL(request.url);
		const storageId = url.searchParams.get("storageId");
		const filename = safeFilename(
			url.searchParams.get("filename") ?? "studio-video.mp4",
		);

		if (!storageId) {
			return new Response("Missing storageId", {
				status: 400,
				headers: corsHeaders(),
			});
		}

		const blob = await ctx.storage.get(storageId as Id<"_storage">);
		if (!blob) {
			return new Response("Not found", {
				status: 404,
				headers: corsHeaders(),
			});
		}

		const contentType = blob.type || "video/mp4";
		return new Response(blob, {
			status: 200,
			headers: {
				...corsHeaders(),
				"Content-Type": contentType,
				"Content-Disposition": `attachment; filename="${filename}"`,
				"Cache-Control": "private, max-age=3600",
			},
		});
	}),
});

export default http;
