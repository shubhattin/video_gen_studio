import type { AuthConfig } from "convex/server";

export default {
	providers: [
		{
			type: "customJwt",
			algorithm: "RS256",
			issuer: process.env.BETTER_AUTH_ISSUER!,
			applicationID: process.env.BETTER_AUTH_ISSUER!,
			jwks: process.env.JWKS_ENDPOINT!,
		},
	],
} satisfies AuthConfig;
