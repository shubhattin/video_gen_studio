import { useCallback, useEffect, useRef, useState } from "react";

/** Copy text to the clipboard and flash a "copied" state for a short window. */
export function useCopyText(resetMs = 1500) {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}
		};
	}, []);

	const copy = useCallback(
		async (text: string) => {
			if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
				return;
			}
			await navigator.clipboard.writeText(text);
			setCopied(true);
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}
			timerRef.current = setTimeout(() => setCopied(false), resetMs);
		},
		[resetMs],
	);

	return { copied, copy };
}
