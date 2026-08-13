import { ConvexReactClient } from "convex/react";
import "#/lib/jwt-session";

const convexUrl = import.meta.env.VITE_CONVEX_URL;

if (!convexUrl) {
	throw new Error("VITE_CONVEX_URL is not set.");
}

export const convex = new ConvexReactClient(convexUrl, {
	// Our /api/auth/token response is already cache: "no-store". Convex's
	// default is to immediately refetch after confirming that first token
	// (Clerk/Auth0 often serve a stale cached JWT on the first call). That
	// second Authenticate also re-runs every subscribed query.
	initialAuthTokenReuse: true,
});
