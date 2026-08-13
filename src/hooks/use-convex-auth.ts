import { useCallback, useMemo } from "react";
import { fetchBetterAuthJwt, useSession } from "#/lib/auth-client";

export function useConvexBetterAuth() {
	const { data: session, isPending } = useSession();

	const fetchAccessToken = useCallback(
		async (_args: { forceRefreshToken: boolean }) => {
			if (!session) {
				return null;
			}
			return await fetchBetterAuthJwt();
		},
		[session],
	);

	return useMemo(
		() => ({
			isLoading: isPending,
			isAuthenticated: Boolean(session),
			fetchAccessToken,
		}),
		[isPending, session, fetchAccessToken],
	);
}
