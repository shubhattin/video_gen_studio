export type StudioBusyStage = "planning" | "image" | "upload" | "video" | null;

export type StudioRunStatus =
	| "draft"
	| "planning"
	| "plan_ready"
	| "image_generating"
	| "image_ready"
	| "video_generating"
	| "completed"
	| "failed"
	| string;

const ACTIVE_STATUSES = new Set([
	"planning",
	"image_generating",
	"video_generating",
]);

export function isActiveRunStatus(status: string | null | undefined) {
	return Boolean(status && ACTIVE_STATUSES.has(status));
}

export function isStudioBusy(busyStage: StudioBusyStage | undefined) {
	return Boolean(busyStage);
}

/** Human-readable label for persisted run status. */
export function runStatusLabel(status: string | null | undefined) {
	switch (status) {
		case "draft":
			return "Draft";
		case "planning":
			return "Planning";
		case "plan_ready":
			return "Plan ready";
		case "image_generating":
			return "Image…";
		case "image_ready":
			return "Image ready";
		case "video_generating":
			return "Video…";
		case "completed":
			return "Done";
		case "failed":
			return "Failed";
		default:
			return status?.replaceAll("_", " ") || "Idle";
	}
}

/** Short pill label for sidebar history. */
export function runStatusPillLabel(status: string | null | undefined) {
	switch (status) {
		case "draft":
			return "Draft";
		case "planning":
			return "Plan";
		case "plan_ready":
			return "Ready";
		case "image_generating":
			return "Image";
		case "image_ready":
			return "Still";
		case "video_generating":
			return "Video";
		case "completed":
			return "Done";
		case "failed":
			return "Failed";
		default:
			return "Idle";
	}
}

export function runStatusTone(
	status: string | null | undefined,
): "idle" | "active" | "ready" | "done" | "failed" {
	if (status === "failed") return "failed";
	if (status === "completed") return "done";
	if (isActiveRunStatus(status)) return "active";
	if (
		status === "plan_ready" ||
		status === "image_ready" ||
		status === "draft"
	) {
		return "ready";
	}
	return "idle";
}

/** Tailwind classes for history status pills. */
export function runStatusPillClass(status: string | null | undefined) {
	const tone = runStatusTone(status);
	switch (tone) {
		case "active":
			return "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300";
		case "done":
			return "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
		case "failed":
			return "border-destructive/40 bg-destructive/10 text-destructive";
		case "ready":
			return "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300";
		default:
			return "border-border/80 bg-muted/40 text-muted-foreground";
	}
}

export function busyStageCopy(busyStage: Exclude<StudioBusyStage, null>) {
	switch (busyStage) {
		case "planning":
			return {
				title: "Planning",
				detail: "Writing image prompt and video scenes…",
			};
		case "image":
			return {
				title: "Generating image",
				detail: "Creating a reference still…",
			};
		case "upload":
			return {
				title: "Uploading",
				detail: "Saving your reference image…",
			};
		case "video":
			return {
				title: "Generating video",
				detail: "Rendering your clip…",
			};
	}
}

export function runStatusCopy(status: string) {
	switch (status) {
		case "planning":
			return {
				title: "Planning",
				detail: "Creative plan in progress…",
			};
		case "image_generating":
			return {
				title: "Generating image",
				detail: "Reference still in progress…",
			};
		case "video_generating":
			return {
				title: "Generating video",
				detail: "Rendering your clip…",
			};
		default:
			return {
				title: runStatusLabel(status),
				detail: "Working…",
			};
	}
}

const PIPELINE_STEPS = [
	{ id: "plan", label: "Plan", statuses: ["planning", "plan_ready"] },
	{
		id: "image",
		label: "Image",
		statuses: ["image_generating", "image_ready"],
	},
	{
		id: "video",
		label: "Video",
		statuses: ["video_generating", "completed"],
	},
] as const;

export function pipelineProgress(args: {
	status?: string | null;
	busyStage?: StudioBusyStage;
}): { value: number; stepIndex: number } {
	const { status, busyStage } = args;
	if (busyStage === "planning" || status === "planning") {
		return { value: 18, stepIndex: 0 };
	}
	if (status === "plan_ready") {
		return { value: 34, stepIndex: 0 };
	}
	if (
		busyStage === "image" ||
		busyStage === "upload" ||
		status === "image_generating"
	) {
		return { value: 52, stepIndex: 1 };
	}
	if (status === "image_ready") {
		return { value: 68, stepIndex: 1 };
	}
	if (busyStage === "video" || status === "video_generating") {
		return { value: 86, stepIndex: 2 };
	}
	if (status === "completed") {
		return { value: 100, stepIndex: 2 };
	}
	return { value: 8, stepIndex: -1 };
}

export { PIPELINE_STEPS };
