import { adminClient, jwtClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const betterAuthUrl = import.meta.env.VITE_BETTER_AUTH_URL;

if (!betterAuthUrl) {
	throw new Error("VITE_BETTER_AUTH_URL is not set.");
}

export const authClient = createAuthClient({
	baseURL: betterAuthUrl,
	fetchOptions: {
		credentials: "include",
	},
	plugins: [adminClient(), jwtClient()],
});

export const { useSession, signIn, signOut } = authClient;

function tokenFromPayload(data: unknown): string | null {
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

/** Fetch a short-lived Better Auth JWT using the existing session cookie. */
export async function fetchBetterAuthJwt(): Promise<string | null> {
	try {
		const response = await fetch(`${betterAuthUrl}/api/auth/token`, {
			credentials: "include",
			cache: "no-store",
		});
		if (!response.ok) {
			return null;
		}
		return tokenFromPayload(await response.json());
	} catch {
		return null;
	}
}
