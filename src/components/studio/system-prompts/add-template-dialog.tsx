import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { notifyStudioError, notifyStudioSuccess } from "#/lib/studio-toast";

type AddTemplateDialogProps = {
	onCreated: (templateId: string) => void;
};

/** "+ Add New Template" — asks for a title and creates an empty-template row. */
export function AddTemplateDialog({ onCreated }: AddTemplateDialogProps) {
	const createTemplate = useMutation(
		api.studio.mutations.createSystemPromptTemplate,
	);
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState("");
	const [creating, setCreating] = useState(false);

	const handleCreate = async () => {
		const trimmed = title.trim();
		if (!trimmed || creating) {
			return;
		}
		setCreating(true);
		try {
			const id = await createTemplate({ title: trimmed });
			notifyStudioSuccess("Template added", trimmed);
			setTitle("");
			setOpen(false);
			onCreated(id);
		} catch (error) {
			notifyStudioError("Could not add template", error);
		} finally {
			setCreating(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={<Button />}>
				<Plus className="size-4" />
				<span>Add New Template</span>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add New Template</DialogTitle>
					<DialogDescription>
						Name the template — you can write its prompt content right after it
						appears below.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					<Label htmlFor="new-template-title">Title</Label>
					<Input
						id="new-template-title"
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								void handleCreate();
							}
						}}
						placeholder="e.g. Concise devotional plan"
						autoFocus
					/>
				</div>
				<DialogFooter>
					<DialogClose render={<Button variant="outline" />}>
						Cancel
					</DialogClose>
					<Button
						disabled={!title.trim() || creating}
						onClick={() => void handleCreate()}
					>
						{creating ? "Adding…" : "Add template"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
