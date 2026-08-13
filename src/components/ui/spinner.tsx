import { SpinnerIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
	return (
		<span className={cn("inline-flex size-4 animate-spin", className)}>
			<SpinnerIcon
				aria-label="Loading"
				className="size-full"
				data-slot="spinner"
				role="status"
				{...props}
			/>
		</span>
	);
}

export { Spinner };
