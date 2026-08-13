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
});

export const { useSession, signIn, signOut } = authClient;
