import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
	getJwtSession,
	getJwtSessionServerSnapshot,
	getJwtSessionSnapshot,
	subscribeJwtSession,
} from "#/lib/jwt-session";

export {
	clearJwtSession,
	getJwtSession,
	type JwtSession,
	type JwtSessionUser,
} from "#/lib/jwt-session";

/** Better Auth JWT session: token + decoded user claims. */
export function useJwtSession() {
	const state = useSyncExternalStore(
		subscribeJwtSession,
		getJwtSessionSnapshot,
		getJwtSessionServerSnapshot,
	);

	const fetchAccessToken = useCallback(
		async (args: { forceRefreshToken: boolean }) => {
			const session = await getJwtSession({
				forceRefresh: args.forceRefreshToken,
			});
			return session?.token ?? null;
		},
		[],
	);

	return useMemo(
		() => ({
			data: state.data,
			error: state.error,
			isPending: state.isPending,
			fetchAccessToken,
		}),
		[state.data, state.error, state.isPending, fetchAccessToken],
	);
}
