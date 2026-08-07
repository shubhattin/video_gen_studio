import { toast } from "#/components/ui/toast";

/** Fire a Base UI toast for studio action failures. */
export function notifyStudioError(title: string, error: unknown) {
	const description =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "Something went wrong.";

	toast.add({
		type: "error",
		title,
		description,
		timeout: 12_000,
	});
}

export function notifyStudioSuccess(title: string, description?: string) {
	toast.add({
		type: "success",
		title,
		description,
		timeout: 4_000,
	});
}
