import { useMemo } from "react";
import { useJwtSession } from "#/hooks/use-jwt-session";

export function useConvexBetterAuth() {
	const { data, isPending, fetchAccessToken } = useJwtSession();

	return useMemo(
		() => ({
			isLoading: isPending,
			isAuthenticated: Boolean(data?.token),
			fetchAccessToken,
		}),
		[data?.token, fetchAccessToken, isPending],
	);
}
