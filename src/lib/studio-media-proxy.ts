import { getJwtSession } from "#/lib/jwt-session";

function getConvexSiteUrl() {
	const cloudUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
	if (!cloudUrl) {
		throw new Error("VITE_CONVEX_URL is not set.");
	}
	return cloudUrl.replace(/\.cloud$/, ".site");
}

/** Same-origin-safe proxy URL for browser fetch/ffmpeg (avoids R2 CORS). */
export function studioMediaProxyUrl(args: {
	runId: string;
	objectKey: string;
}) {
	const url = new URL("/studio/media", getConvexSiteUrl());
	url.searchParams.set("runId", args.runId);
	url.searchParams.set("objectKey", args.objectKey);
	return url.toString();
}

/** Fetch studio media through the Convex HTTP fallback with a bearer JWT. */
export async function fetchStudioMedia(
	args: { runId: string; objectKey: string },
	init: RequestInit = {},
): Promise<Response> {
	const session = await getJwtSession();
	if (!session?.token) {
		throw new Error("Not authenticated.");
	}
	const token = session.token;
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${token}`);
	return await fetch(studioMediaProxyUrl(args), {
		...init,
		headers,
		cache: init.cache ?? "no-store",
	});
}
