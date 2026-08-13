import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useEffect, useMemo, useState } from "react";

function uniqueObjectKeys(objectKeys: Array<string | undefined | null>) {
	return [
		...new Set(
			objectKeys.filter(
				(key): key is string => typeof key === "string" && key.length > 0,
			),
		),
	].sort();
}

/**
 * Resolve short-lived R2 read URLs for object keys belonging to a run.
 * URLs are kept in client state only — never persisted.
 */
export function useSignedMediaUrls(
	runId: Id<"generationRuns"> | null | undefined,
	objectKeys: Array<string | undefined | null>,
) {
	const getReadUrls = useAction(api.studioR2.getReadUrls);
	const [urlsByKey, setUrlsByKey] = useState<Record<string, string | null>>({});
	const keysSignature = uniqueObjectKeys(objectKeys).join("\0");
	const keys = useMemo(
		() => (keysSignature ? keysSignature.split("\0") : []),
		[keysSignature],
	);

	useEffect(() => {
		if (!runId || keys.length === 0) {
			setUrlsByKey({});
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const next = await getReadUrls({ runId, objectKeys: keys });
				if (!cancelled) {
					setUrlsByKey(next);
				}
			} catch {
				if (!cancelled) {
					setUrlsByKey({});
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [getReadUrls, keys, runId]);

	return urlsByKey;
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
