import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { Check, Copy, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { MessageResponse } from "#/components/ai-elements/message";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { MarkdownTextarea } from "#/components/ui/markdown-textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { useCopyText } from "#/hooks/use-copy-text";
import type { SystemPromptTemplate } from "#/lib/planner-prompt";
import { notifyStudioError, notifyStudioSuccess } from "#/lib/studio-toast";
import { cn } from "#/lib/utils";

type SystemPromptItemProps = {
	template: SystemPromptTemplate;
	/** Flash a focus ring after deep-linking to this item. */
	highlighted?: boolean;
	onDeleted: (templateId: string) => void;
};

export function SystemPromptItem({
	template,
	highlighted = false,
	onDeleted,
}: SystemPromptItemProps) {
	const updateTemplate = useMutation(
		api.studio.mutations.updateSystemPromptTemplate,
	);
	const deleteTemplate = useMutation(
		api.studio.mutations.deleteSystemPromptTemplate,
	);
	const { copied, copy } = useCopyText();

	const [tab, setTab] = useState<"view" | "edit">("view");
	const [draftTitle, setDraftTitle] = useState(template.title);
	const [draftContent, setDraftContent] = useState(template.content);
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);

	const dirty =
		draftTitle.trim() !== template.title || draftContent !== template.content;

	// Keep the draft in sync when the doc changes (e.g. after our own save).
	useEffect(() => {
		setDraftTitle(template.title);
		setDraftContent(template.content);
		setTab("view");
	}, [template.title, template.content]);

	const handleSave = async () => {
		const title = draftTitle.trim();
		if (!title) {
			notifyStudioError("Template not saved", new Error("Title is required."));
			return;
		}
		setSaving(true);
		try {
			await updateTemplate({
				templateId: template._id as Id<"systemPromptTemplates">,
				title,
				content: draftContent,
			});
			notifyStudioSuccess("Template saved", title);
			setConfirmSaveOpen(false);
			setTab("view");
		} catch (error) {
			notifyStudioError("Could not save template", error);
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async () => {
		setDeleting(true);
		try {
			await deleteTemplate({
				templateId: template._id as Id<"systemPromptTemplates">,
			});
			notifyStudioSuccess("Template deleted", template.title);
			onDeleted(template._id);
		} catch (error) {
			notifyStudioError("Could not delete template", error);
		} finally {
			setDeleting(false);
		}
	};

	return (
		<div
			className={cn(
				"rounded-lg transition-shadow",
				highlighted && "ring-2 ring-ring/60",
			)}
		>
			<Tabs
				value={tab}
				onValueChange={(value) => {
					if (value === "view" || value === "edit") {
						setTab(value);
					}
				}}
				className="gap-3"
			>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<Badge
						variant="outline"
						className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground capitalize"
					>
						{formatDistanceToNow(template.updatedAt, { addSuffix: true })}
					</Badge>
					<TabsList>
						<TabsTrigger value="view">View</TabsTrigger>
						<TabsTrigger value="edit">
							<Pencil className="size-3.5" />
							<span>Edit</span>
						</TabsTrigger>
					</TabsList>
				</div>

				<TabsContent value="view" className="mt-0 space-y-3">
					<div className="max-h-80 overflow-y-auto rounded-lg border border-border/80 bg-muted/20 p-4">
						{template.content.trim() ? (
							<MessageResponse className="text-sm leading-relaxed [&_strong]:font-semibold [&_em]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-1 [&_p]:my-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
								{template.content}
							</MessageResponse>
						) : (
							<p className="text-sm text-muted-foreground">
								Empty template — switch to the Edit tab to write the prompt.
							</p>
						)}
					</div>
					<div className="flex flex-wrap justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={!template.content}
							onClick={() => void copy(template.content)}
						>
							{copied ? (
								<Check className="size-3.5" />
							) : (
								<Copy className="size-3.5" />
							)}
							{copied ? "Copied" : "Copy"}
						</Button>
					</div>
				</TabsContent>

				<TabsContent value="edit" className="mt-0 space-y-3">
					<div className="space-y-2">
						<Label htmlFor={`template-title-${template._id}`}>Title</Label>
						<Input
							id={`template-title-${template._id}`}
							value={draftTitle}
							onChange={(event) => setDraftTitle(event.target.value)}
							maxLength={120}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor={`template-content-${template._id}`}>
							Prompt content
						</Label>
						<MarkdownTextarea
							id={`template-content-${template._id}`}
							value={draftContent}
							onChange={(event) => setDraftContent(event.target.value)}
							className="min-h-72 max-h-96 resize-y"
							aria-label="Template prompt content"
						/>
					</div>
					<div className="flex flex-wrap justify-end gap-2">
						{dirty ? (
							<Button
								type="button"
								size="sm"
								disabled={saving}
								onClick={() => setConfirmSaveOpen(true)}
							>
								{saving ? "Saving…" : "Save"}
							</Button>
						) : null}
						<AlertDialog>
							<AlertDialogTrigger
								render={
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="text-destructive"
									/>
								}
							>
								<Trash2 className="size-3.5" />
								<span>Delete</span>
							</AlertDialogTrigger>
							<AlertDialogContent size="sm">
								<AlertDialogHeader>
									<AlertDialogTitle>Delete template?</AlertDialogTitle>
									<AlertDialogDescription>
										“{template.title}” will be removed. Runs currently using it
										will be forced to pick a template again before their next
										plan.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction
										variant="destructive"
										disabled={deleting}
										onClick={() => void handleDelete()}
									>
										{deleting ? "Deleting…" : "Delete"}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</div>
				</TabsContent>
			</Tabs>

			<AlertDialog open={confirmSaveOpen} onOpenChange={setConfirmSaveOpen}>
				<AlertDialogContent size="sm">
					<AlertDialogHeader>
						<AlertDialogTitle>Save template changes?</AlertDialogTitle>
						<AlertDialogDescription>
							Existing plans keep the prompt snapshot they were generated with.
							Future plans using “{draftTitle.trim() || template.title}” will
							use the updated content.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={saving}
							onClick={() => void handleSave()}
						>
							Save
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
