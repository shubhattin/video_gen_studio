import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { type ViewUrlRecord, viewUrlQueryOptions } from "#/lib/view-url-query";

/**
 * Resolve short-lived R2 read URLs for gallery object keys.
 *
 * Backed by TanStack Query with per-key cache entries
 * (["view_url", objectKey]) and a TTL-matched staleTime, so URLs are
 * reused across navigation/tabs instead of being refetched on every mount.
 * Per-key requests made in the same tick are coalesced into a single
 * getReadUrls action call. URLs are kept in client cache only — never
 * persisted.
 */
export function useSignedMediaUrls(
	objectKeys: Array<string | undefined | null>,
): ViewUrlRecord {
	// Callers typically rebuild the array inline; memoize off its joined
	// signature so the per-key query list stays stable across renders.
	const signature = objectKeys.join("\0");
	const keys = useMemo(
		() =>
			[
				...new Set(signature.split("\0").filter((key) => key.length > 0)),
			].sort(),
		[signature],
	);

	return useQueries({
		queries: keys.map((objectKey) => viewUrlQueryOptions(objectKey)),
		combine: (results) => {
			const record: ViewUrlRecord = {};
			for (const [index, objectKey] of keys.entries()) {
				record[objectKey] = results[index]?.data ?? null;
			}
			return record;
		},
	});
}

export function withSignedUrl<T extends { objectKey?: string }>(
	item: T,
	urlsByKey: Record<string, string | null>,
): T & { url?: string | null } {
	if (!item.objectKey) {
		return { ...item, url: null };
	}
	return {
		...item,
		url: urlsByKey[item.objectKey] ?? null,
	};
}
