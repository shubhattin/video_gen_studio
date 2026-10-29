import { Check, Copy, Pencil } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { useCopyText } from "#/hooks/use-copy-text";
import type { AudioScript } from "#/lib/audio-catalog";

type AudioScriptPanelProps = {
	script: AudioScript;
	/** Flattened prompt that will be sent to the audio model. */
	providerPrompt: string;
	disabled?: boolean;
	/** Regenerate control rendered in the header. */
	actions?: ReactNode;
	onSave: (script: AudioScript) => Promise<void>;
};

function Field({
	label,
	children,
	className,
}: {
	label: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={className}>
			<p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
				{label}
			</p>
			{children}
		</div>
	);
}

/** Read / edit view of a guided run's song (or recitation) script. */
export function AudioScriptPanel({
	script,
	providerPrompt,
	disabled,
	actions,
	onSave,
}: AudioScriptPanelProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<AudioScript>(script);
	const [saving, setSaving] = useState(false);
	const { copied, copy } = useCopyText();
	const directionLabel = "Music direction";
	const lyricsLabel = "Lyrics";

	useEffect(() => {
		if (!editing) setDraft(script);
	}, [script, editing]);

	const save = async () => {
		setSaving(true);
		try {
			await onSave({
				...draft,
				pronunciationNotes: draft.pronunciationNotes?.trim() || undefined,
			});
			setEditing(false);
		} finally {
			setSaving(false);
		}
	};

	return (
		<section className="space-y-4 rounded-2xl border border-border/80 bg-muted/10 p-4 sm:p-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
						Song script
					</p>
					<h3 className="truncate font-heading text-xl font-semibold">
						{script.title}
					</h3>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{editing ? (
						<>
							<Button
								variant="outline"
								className="min-h-11"
								disabled={saving}
								onClick={() => {
									setDraft(script);
									setEditing(false);
								}}
							>
								Cancel
							</Button>
							<Button
								className="min-h-11"
								disabled={
									saving || !draft.title.trim() || !draft.styleDirection.trim()
								}
								onClick={() => void save()}
							>
								{saving ? "Saving…" : "Save script"}
							</Button>
						</>
					) : (
						<>
							{actions}
							<Button
								variant="outline"
								className="min-h-11"
								disabled={disabled}
								onClick={() => setEditing(true)}
							>
								<Pencil data-icon="inline-start" />
								Edit
							</Button>
						</>
					)}
				</div>
			</div>

			{editing ? (
				<div className="grid gap-4">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="audio-script-title" className="text-xs">
							Title
						</Label>
						<Input
							id="audio-script-title"
							value={draft.title}
							onChange={(event) =>
								setDraft({ ...draft, title: event.target.value })
							}
							maxLength={200}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="audio-script-direction" className="text-xs">
							{directionLabel}
						</Label>
						<Textarea
							id="audio-script-direction"
							value={draft.styleDirection}
							onChange={(event) =>
								setDraft({ ...draft, styleDirection: event.target.value })
							}
							className="min-h-32 resize-y"
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="audio-script-lyrics" className="text-xs">
							{lyricsLabel}
						</Label>
						<Textarea
							id="audio-script-lyrics"
							value={draft.lyrics}
							spellCheck={false}
							onChange={(event) =>
								setDraft({ ...draft, lyrics: event.target.value })
							}
							placeholder="Empty = instrumental"
							className="min-h-48 resize-y text-base leading-relaxed"
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="audio-script-notes" className="text-xs">
							Pronunciation notes
						</Label>
						<Textarea
							id="audio-script-notes"
							value={draft.pronunciationNotes ?? ""}
							onChange={(event) =>
								setDraft({ ...draft, pronunciationNotes: event.target.value })
							}
							className="min-h-20 resize-y"
						/>
					</div>
				</div>
			) : (
				<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
					<div className="flex flex-col gap-5">
						<Field label={directionLabel}>
							<p className="text-sm leading-relaxed whitespace-pre-wrap">
								{script.styleDirection}
							</p>
						</Field>
						{script.pronunciationNotes ? (
							<Field label="Pronunciation notes">
								<p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
									{script.pronunciationNotes}
								</p>
							</Field>
						) : null}
					</div>
					<Field label={lyricsLabel}>
						{script.lyrics.trim() ? (
							<pre className="max-h-96 overflow-y-auto rounded-xl border border-border/70 bg-background/60 p-4 font-sans text-base leading-loose whitespace-pre-wrap">
								{script.lyrics}
							</pre>
						) : (
							<Badge variant="outline" className="font-normal">
								Instrumental — no lyrics
							</Badge>
						)}
					</Field>
				</div>
			)}

			<details className="group rounded-xl border border-border/70 bg-background/40">
				<summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium">
					<span>
						Final prompt sent to the model
						<span className="ml-2 text-xs font-normal text-muted-foreground">
							{providerPrompt.length.toLocaleString()} chars
						</span>
					</span>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={(event) => {
							event.preventDefault();
							void copy(providerPrompt);
						}}
					>
						{copied ? (
							<Check className="size-3.5" />
						) : (
							<Copy className="size-3.5" />
						)}
						{copied ? "Copied" : "Copy"}
					</Button>
				</summary>
				<pre className="max-h-80 overflow-y-auto border-t border-border/70 px-3 py-3 font-sans text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
					{providerPrompt}
				</pre>
			</details>
		</section>
	);
}
