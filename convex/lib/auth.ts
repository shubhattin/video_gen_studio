import type { UserIdentity } from "convex/server";

type AuthCtx = {
	auth: {
		getUserIdentity: () => Promise<UserIdentity | null>;
	};
};

async function readIdentity(ctx: AuthCtx): Promise<UserIdentity | null> {
	try {
		return await ctx.auth.getUserIdentity();
	} catch {
		// HTTP actions throw when no bearer JWT is present.
		return null;
	}
}

export async function requireAdmin(ctx: AuthCtx): Promise<UserIdentity> {
	const identity = await readIdentity(ctx);
	if (!identity) {
		throw new Error("Not authenticated.");
	}
	if (identity.role !== "admin") {
		throw new Error("Admin access required.");
	}
	return identity;
}
