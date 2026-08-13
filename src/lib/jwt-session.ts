import { z } from "zod";

const betterAuthUrl = import.meta.env.VITE_BETTER_AUTH_URL;

if (!betterAuthUrl) {
	throw new Error("VITE_BETTER_AUTH_URL is not set.");
}

/** Claims we actually read from the Better Auth JWT payload. */
export const jwtSessionClaimsSchema = z.object({
	sub: z.string().min(1),
	exp: z.number(),
	name: z.string().optional(),
	email: z.string().optional(),
	image: z.string().nullable().optional(),
	role: z.string().nullable().optional(),
});

export type JwtSessionUser = {
	id: string;
	name: string;
	email: string;
	image: string | null;
	role: string | null;
};

export type JwtSession = {
	token: string;
	user: JwtSessionUser;
	exp: number;
};

export type JwtSessionState = {
	data: JwtSession | null;
	isPending: boolean;
	error: Error | null;
};

const REFRESH_LEEWAY_SECONDS = 30;
const SERVER_SNAPSHOT: JwtSessionState = {
	data: null,
	isPending: true,
	error: null,
};

let snapshot: JwtSessionState = {
	data: null,
	isPending: true,
	error: null,
};
let inFlight: Promise<JwtSession | null> | null = null;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) {
		listener();
	}
}

function setSnapshot(next: JwtSessionState) {
	snapshot = next;
	emit();
}

function tokenFromResponseBody(data: unknown): string | null {
	if (typeof data === "string" && data.length > 0) {
		return data;
	}
	if (
		data &&
		typeof data === "object" &&
		"token" in data &&
		typeof data.token === "string" &&
		data.token.length > 0
	) {
		return data.token;
	}
	return null;
}

function decodeJwtPayloadJson(token: string): unknown {
	const payload = token.split(".")[1];
	if (!payload) {
		throw new Error("Invalid JWT.");
	}
	const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
	const pad = "=".repeat((4 - (padded.length % 4)) % 4);
	const bytes = Uint8Array.from(atob(padded + pad), (char) =>
		char.charCodeAt(0),
	);
	return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export function parseJwtSession(token: string): JwtSession {
	const claims = jwtSessionClaimsSchema.parse(decodeJwtPayloadJson(token));
	return {
		token,
		exp: claims.exp,
		user: {
			id: claims.sub,
			name: claims.name?.trim() || "Account",
			email: claims.email?.trim() ?? "",
			image: claims.image ?? null,
			role: claims.role ?? null,
		},
	};
}

function cachedSessionStillValid(session: JwtSession): boolean {
	const nowSeconds = Math.floor(Date.now() / 1000);
	return session.exp - REFRESH_LEEWAY_SECONDS > nowSeconds;
}

async function fetchJwtSession(): Promise<JwtSession | null> {
	const response = await fetch(`${betterAuthUrl}/api/auth/token`, {
		credentials: "include",
		cache: "no-store",
	});
	if (!response.ok) {
		return null;
	}
	const token = tokenFromResponseBody(await response.json());
	if (!token) {
		return null;
	}
	return parseJwtSession(token);
}

/** Direct fetch, like Better Auth `getSession`. Shares the in-memory cache. */
export async function getJwtSession(options?: {
	forceRefresh?: boolean;
}): Promise<JwtSession | null> {
	if (typeof window === "undefined") {
		return null;
	}

	const forceRefresh = options?.forceRefresh === true;
	if (
		!forceRefresh &&
		snapshot.data &&
		cachedSessionStillValid(snapshot.data)
	) {
		return snapshot.data;
	}
	// Join an in-flight request even on forceRefresh. Convex (and React
	// Strict Mode) can ask for a "fresh" token while the first GET is still
	// running; Better Auth does not require two round trips.
	if (inFlight) {
		return await inFlight;
	}

	if (!snapshot.data) {
		setSnapshot({ data: null, isPending: true, error: null });
	}

	const request = fetchJwtSession()
		.then((data) => {
			setSnapshot({ data, isPending: false, error: null });
			return data;
		})
		.catch((error: unknown) => {
			const err =
				error instanceof Error ? error : new Error("JWT fetch failed.");
			setSnapshot({ data: null, isPending: false, error: err });
			return null;
		})
		.finally(() => {
			inFlight = null;
		});

	inFlight = request;
	return await request;
}

export function clearJwtSession() {
	inFlight = null;
	setSnapshot({ data: null, isPending: false, error: null });
}

export function subscribeJwtSession(onStoreChange: () => void) {
	listeners.add(onStoreChange);
	if (typeof window !== "undefined" && snapshot.isPending && !inFlight) {
		void getJwtSession();
	}
	return () => {
		listeners.delete(onStoreChange);
	};
}

export function getJwtSessionSnapshot(): JwtSessionState {
	return snapshot;
}

export function getJwtSessionServerSnapshot(): JwtSessionState {
	return SERVER_SNAPSHOT;
}

// Start the cookie→JWT fetch as soon as this module loads in the browser,
// not after React hydrates and useSyncExternalStore subscribes.
if (typeof window !== "undefined") {
	void getJwtSession();
}
