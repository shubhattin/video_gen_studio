import { Check, Copy, Lock } from "lucide-react";
import { MessageResponse } from "#/components/ai-elements/message";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { useCopyText } from "#/hooks/use-copy-text";
import { builtInPromptFor } from "#/lib/built-in-prompts";
import type { PromptTemplateKind } from "#/lib/planner-prompt";
import { cn } from "#/lib/utils";

type DefaultSystemPromptItemProps = {
	/** Flash a focus ring after deep-linking to the default item. */
	highlighted?: boolean;
	kind?: PromptTemplateKind;
};

/** The built-in default planner prompt — view and copy only, not editable. */
export function DefaultSystemPromptItem({
	highlighted = false,
	kind = "video",
}: DefaultSystemPromptItemProps) {
	const { copied, copy } = useCopyText();
	const builtIn = builtInPromptFor(kind);

	return (
		<div
			className={cn(
				"rounded-lg transition-shadow",
				highlighted && "ring-2 ring-ring/60",
			)}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-medium">{builtIn.title}</span>
					<Badge
						variant="outline"
						className="h-5 px-1.5 text-[10px] font-normal capitalize"
					>
						Built-in
					</Badge>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<span className="flex items-center gap-1 text-xs text-muted-foreground">
						<Lock className="size-3" />
						Read-only
					</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void copy(builtIn.content)}
					>
						{copied ? (
							<Check className="size-3.5" />
						) : (
							<Copy className="size-3.5" />
						)}
						{copied ? "Copied" : "Copy"}
					</Button>
				</div>
			</div>
			<div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-border/80 bg-muted/20 p-4">
				<MessageResponse className="text-sm leading-relaxed [&_strong]:font-semibold [&_em]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-1 [&_p]:my-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
					{builtIn.content}
				</MessageResponse>
			</div>
		</div>
	);
}
