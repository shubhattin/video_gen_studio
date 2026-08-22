import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { queryOptions } from "@tanstack/react-query";
import { convex } from "#/lib/convex";

/**
 * R2 presigned GET URLs are short-lived. The server signs them for 1 hour,
 * but we treat the cache as stale well before that so a refreshed URL is
 * always used before the old one could plausibly expire.
 */
export const VIEW_URL_STALE_TIME_MS = 15 * 60 * 1000 - 4_000;

/** Query key for one object's signed read URL: ["view_url", runId, objectKey]. */
export function viewUrlQueryKey(
	runId: Id<"generationRuns"> | null | undefined,
	objectKey: string,
) {
	return ["view_url", runId ?? null, objectKey] as const;
}

// ── Request coalescing ──────────────────────────────────────────────────

type PendingBatch = {
	/** Original (possibly null) runId for the getReadUrls call. */
	runId: Id<"generationRuns"> | null | undefined;
	/** Object keys queued in this tick → resolvers waiting for their URL. */
	keys: Map<string, Array<(url: string | null) => void>>;
};

/**
 * getReadUrls takes an array of keys and returns a record, but every query
 * caches a single object ("view_url", runId, key). To avoid firing one action
 * call per key, all keys requested within the same tick are coalesced into a
 * single getReadUrls call, then fanned back out to their per-key promises.
 */
const pendingBatches = new Map<string, PendingBatch>();

function batchCacheKey(runId: Id<"generationRuns"> | null | undefined) {
	return runId ?? "";
}

function flushBatch(runIdKey: string): void {
	const batch = pendingBatches.get(runIdKey);
	pendingBatches.delete(runIdKey);
	if (!batch || batch.keys.size === 0) {
		return;
	}
	void convex
		.action(api.studio.r2.getReadUrls, {
			runId: batch.runId ?? undefined,
			objectKeys: [...batch.keys.keys()],
		})
		.then((urlsByKey) => {
			for (const [objectKey, resolvers] of batch.keys) {
				const url = urlsByKey[objectKey] ?? null;
				for (const resolve of resolvers) {
					resolve(url);
				}
			}
		})
		.catch(() => {
			for (const resolvers of batch.keys.values()) {
				for (const resolve of resolvers) {
					resolve(null);
				}
			}
		});
}

async function fetchViewUrl(
	runId: Id<"generationRuns"> | null | undefined,
	objectKey: string,
): Promise<string | null> {
	if (!objectKey) {
		return null;
	}
	const runIdKey = batchCacheKey(runId);
	let batch = pendingBatches.get(runIdKey);
	if (!batch) {
		batch = { runId, keys: new Map() };
		pendingBatches.set(runIdKey, batch);
		setTimeout(() => flushBatch(runIdKey), 0);
	}
	return new Promise<string | null>((resolve) => {
		const resolvers = batch.keys.get(objectKey);
		if (resolvers) {
			resolvers.push(resolve);
		} else {
			batch.keys.set(objectKey, [resolve]);
		}
	});
}

// ── Reusable query options ──────────────────────────────────────────────

/**
 * Shared TanStack Query options for one object's signed read URL. Cached per
 * key with a TTL-matched staleTime, so navigating between tabs/pages never
 * refetches URLs that are still fresh.
 */
export function viewUrlQueryOptions(
	runId: Id<"generationRuns"> | null | undefined,
	objectKey: string,
) {
	return queryOptions({
		queryKey: viewUrlQueryKey(runId, objectKey),
		queryFn: () => fetchViewUrl(runId, objectKey),
		staleTime: VIEW_URL_STALE_TIME_MS,
		retry: false,
	});
}

export type ViewUrlRecord = Record<string, string | null>;
