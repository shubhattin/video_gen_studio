/**
 * Upper bound on revisions per plan / audio script. Keeps the revisions
 * array (stored inline on the parent doc) far below the 1 MiB doc limit.
 */
export const MAX_REVISIONS = 20;

/** Longest instruction accepted from the Revise popover. */
export const MAX_REVISION_PROMPT_CHARS = 4000;

type RevisionLink = { parentIndex?: number };

/**
 * Index the UI shows and generation uses: the stored active index when valid,
 * otherwise the latest revision. Null when there are no revisions.
 */
export function resolveRevisionIndex(
	revisions: readonly unknown[] | undefined,
	activeIndex: number | undefined,
): number | null {
	if (!revisions?.length) return null;
	if (
		activeIndex !== undefined &&
		Number.isInteger(activeIndex) &&
		activeIndex >= 0 &&
		activeIndex < revisions.length
	) {
		return activeIndex;
	}
	return revisions.length - 1;
}

/** Revision at `index`, or throws a user-facing error when it doesn't exist. */
export function requireRevision<T>(
	revisions: readonly T[] | undefined,
	index: number,
): T {
	const revision = Number.isInteger(index) ? revisions?.[index] : undefined;
	if (!revision) {
		throw new Error("That revision no longer exists. Refresh and try again.");
	}
	return revision;
}

/**
 * Indexes from the root revision down to `index`, following parentIndex.
 * This is the conversation history a revise of `index` continues from.
 */
export function revisionChain(
	revisions: readonly RevisionLink[],
	index: number,
): number[] {
	const chain: number[] = [];
	const seen = new Set<number>();
	let cursor: number | undefined = index;
	while (cursor !== undefined) {
		if (!revisions[cursor] || seen.has(cursor)) {
			throw new Error("Revision history is corrupt.");
		}
		seen.add(cursor);
		chain.push(cursor);
		cursor = revisions[cursor].parentIndex;
	}
	return chain.reverse();
}

export function assertCanAddRevision(revisions: readonly unknown[]) {
	if (revisions.length >= MAX_REVISIONS) {
		throw new Error(
			`This has reached the ${MAX_REVISIONS}-revision limit. Regenerate or start a new one.`,
		);
	}
}

/** Trimmed, bounded revise instruction, or throws when empty. */
export function cleanRevisionPrompt(prompt: string): string {
	const trimmed = prompt.trim();
	if (!trimmed) {
		throw new Error("Describe what to change.");
	}
	if (trimmed.length > MAX_REVISION_PROMPT_CHARS) {
		throw new Error(
			`Keep revision requests under ${MAX_REVISION_PROMPT_CHARS} characters.`,
		);
	}
	return trimmed;
}

/**
 * User turn for a revise. The constraints block restates the current
 * settings so a revise also honours config changed since the last turn.
 */
export function buildRevisionUserMessage(args: {
	request: string;
	/** Thing being revised, e.g. "plan" or "song script". */
	subject: string;
	constraints: string[];
}): string {
	const constraints = args.constraints.filter(Boolean);
	return [
		`Revise your previous ${args.subject} according to this request:`,
		'"""',
		args.request,
		'"""',
		"",
		`Return the COMPLETE revised ${args.subject} in the same JSON format — every field, not a diff. Keep everything the request does not ask to change.`,
		...(constraints.length > 0
			? ["", "## Current constraints", ...constraints.map((line) => `- ${line}`)]
			: []),
	].join("\n");
}

/** Copy of `revisions` with the entry at `index` swapped for `next`. */
export function replaceRevision<T>(
	revisions: readonly T[],
	index: number,
	next: T,
): T[] {
	return revisions.map((revision, i) => (i === index ? next : revision));
}
