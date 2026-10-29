import { WandSparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Kbd, KbdGroup } from "#/components/ui/kbd";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/ui/popover";
import { Spinner } from "#/components/ui/spinner";
import { Textarea } from "#/components/ui/textarea";
import { MAX_REVISION_PROMPT_CHARS, MAX_REVISIONS } from "#/lib/revisions";

type RevisePopoverProps = {
	/** Trigger label, e.g. "Revise plan". */
	label: string;
	/** What gets rewritten, used in copy: "plan" or "script". */
	subject: string;
	placeholder: string;
	/** 0-based revision the request builds on. */
	baseIndex: number;
	revisionCount: number;
	disabled?: boolean;
	/** A revise request is in flight. */
	pending?: boolean;
	/** Resolve true once the revision is committed; the draft is kept otherwise. */
	onSubmit: (prompt: string) => Promise<boolean>;
};

/**
 * Follow-up prompt for the planner / scripter: the request continues the
 * conversation behind the shown revision and lands as a new revision.
 */
export function RevisePopover({
	label,
	subject,
	placeholder,
	baseIndex,
	revisionCount,
	disabled,
	pending,
	onSubmit,
}: RevisePopoverProps) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState("");
	const atLimit = revisionCount >= MAX_REVISIONS;
	const trimmed = draft.trim();
	const branching = baseIndex < revisionCount - 1;

	const submit = () => {
		if (!trimmed || atLimit) return;
		setOpen(false);
		void onSubmit(trimmed).then((committed) => {
			if (committed) setDraft("");
		});
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<Button
						variant="outline"
						className="min-h-11"
						disabled={disabled || pending || atLimit}
						title={
							atLimit
								? `Reached the ${MAX_REVISIONS}-revision limit — regenerate to start over.`
								: undefined
						}
					/>
				}
			>
				{pending ? (
					<Spinner data-icon="inline-start" />
				) : (
					<WandSparkles data-icon="inline-start" />
				)}
				{pending ? "Revising…" : label}
			</PopoverTrigger>
			<PopoverContent align="start" className="w-[min(26rem,90vw)] gap-3">
				<PopoverHeader>
					<PopoverTitle>{label}</PopoverTitle>
					<PopoverDescription>
						Describe what to change. The whole {subject} is rewritten as a new
						revision — the current one stays available.
					</PopoverDescription>
				</PopoverHeader>
				{branching ? (
					<p className="rounded-md border border-border/70 bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
						Builds on revision {baseIndex + 1}. The result is added as revision{" "}
						{revisionCount + 1}.
					</p>
				) : null}
				<Textarea
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							submit();
						}
					}}
					placeholder={placeholder}
					maxLength={MAX_REVISION_PROMPT_CHARS}
					aria-label={`${label} instructions`}
					className="min-h-28 resize-y"
					autoFocus
				/>
				<div className="flex items-center justify-between gap-3">
					<KbdGroup className="text-xs text-muted-foreground">
						<Kbd>Ctrl</Kbd>
						<Kbd>Enter</Kbd>
						<span>to send</span>
					</KbdGroup>
					<Button size="sm" disabled={!trimmed} onClick={submit}>
						Revise
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
