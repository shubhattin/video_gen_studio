import { WarningCircleIcon } from "@phosphor-icons/react";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";

type StudioErrorAlertProps = {
	error?: string | null;
	title?: string;
};

export function StudioErrorAlert({
	error,
	title = "Generation failed",
}: StudioErrorAlertProps) {
	if (!error?.trim()) {
		return null;
	}

	return (
		<Alert variant="destructive" className="border-Wdestructive/40">
			<WarningCircleIcon />
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription className="wrap-break-word whitespace-pre-wrap">
				{error}
			</AlertDescription>
		</Alert>
	);
}
