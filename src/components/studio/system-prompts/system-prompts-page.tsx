import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { AudioLines, Search, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type PillTab, PillTabs } from "#/components/studio/pill-tabs";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "#/components/ui/accordion";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { builtInPromptFor } from "#/lib/built-in-prompts";
import type { PromptTemplateKind } from "#/lib/planner-prompt";
import { AddTemplateDialog } from "./add-template-dialog";
import { DefaultSystemPromptItem } from "./default-system-prompt-item";
import { SystemPromptItem } from "./system-prompt-item";

type SortMode = "newest" | "oldest" | "title";

const KIND_TABS: ReadonlyArray<PillTab<PromptTemplateKind>> = [
	{ id: "video", label: "Video", icon: Video },
	{ id: "audio", label: "Audio", icon: AudioLines },
];

const KIND_COPY: Record<PromptTemplateKind, string> = {
	video: "Used by Shloka Studio to plan reference images and video scenes.",
	audio: "Used by Sanskrit Song Studio to write song and recitation scripts.",
};

/** Which tab a deep-link focus key belongs to (built-in keys only). */
function kindForBuiltInKey(key: string): PromptTemplateKind | null {
	if (key === builtInPromptFor("video").focusKey) return "video";
	if (key === builtInPromptFor("audio").focusKey) return "audio";
	return null;
}

type SystemPromptsPageProps = {
	/** Template kind tab currently shown. */
	kind: PromptTemplateKind;
	onKindChange: (kind: PromptTemplateKind) => void;
	/**
	 * Deep-link focus key (`Pdefault`, `Paudio-default`, or `P<templateId>`)
	 * that should be auto-expanded, scrolled to, and briefly highlighted.
	 */
	focusKey: string | null;
	/** Called once focus handling is done so the hash can be cleared. */
	onFocusHandled?: () => void;
};

export function SystemPromptsPage({
	kind,
	onKindChange,
	focusKey,
	onFocusHandled,
}: SystemPromptsPageProps) {
	// All kinds — deep links may target a template on the other tab.
	const allTemplates = useQuery(
		api.studio.queries.listSystemPromptTemplates,
		{},
	);
	const templates = useMemo(
		() => allTemplates?.filter((template) => template.kind === kind),
		[allTemplates, kind],
	);
	const builtIn = builtInPromptFor(kind);
	const [search, setSearch] = useState("");
	const [sort, setSort] = useState<SortMode>("newest");
	const [openItems, setOpenItems] = useState<string[]>([]);
	const [pendingFocus, setPendingFocus] = useState<string | null>(focusKey);
	const [highlightKey, setHighlightKey] = useState<string | null>(null);

	useEffect(() => {
		if (focusKey) {
			setPendingFocus(focusKey);
		}
	}, [focusKey]);

	const filtered = useMemo(() => {
		const query = search.trim().toLowerCase();
		const list = (templates ?? []).filter((template) =>
			query ? template.title.toLowerCase().includes(query) : true,
		);
		if (sort === "title") {
			return [...list].sort((a, b) => a.title.localeCompare(b.title));
		}
		if (sort === "oldest") {
			return [...list].sort((a, b) => a.createdAt - b.createdAt);
		}
		return [...list].sort((a, b) => b.createdAt - a.createdAt);
	}, [templates, search, sort]);

	useEffect(() => {
		if (!pendingFocus) {
			return;
		}
		const key = pendingFocus;
		// Switch to the tab that owns the deep-linked item first.
		const targetKind =
			kindForBuiltInKey(key) ??
			allTemplates?.find((template) => `P${template._id}` === key)?.kind ??
			null;
		if (targetKind && targetKind !== kind) {
			onKindChange(targetKind);
			return;
		}
		// If the deep-linked template exists but is hidden by the search filter,
		// clear the search so it becomes visible and can be scrolled to.
		if (key !== builtIn.focusKey && templates !== undefined) {
			const templateExists = templates.some(
				(template) => `P${template._id}` === key,
			);
			const filteredOut =
				templateExists && !filtered.some((t) => `P${t._id}` === key);
			if (filteredOut) {
				setSearch("");
				return;
			}
		}
		const ready =
			key === builtIn.focusKey ||
			(templates ?? []).some((template) => `P${template._id}` === key);
		if (!ready) {
			return;
		}
		setOpenItems((previous) =>
			previous.includes(key) ? previous : [...previous, key],
		);
		const element = document.getElementById(key);
		if (element) {
			element.scrollIntoView({ behavior: "smooth", block: "center" });
		}
		setHighlightKey(key);
		const timer = setTimeout(() => {
			setHighlightKey((current) => (current === key ? null : current));
		}, 2000);
		setPendingFocus(null);
		onFocusHandled?.();
		return () => clearTimeout(timer);
	}, [
		pendingFocus,
		templates,
		allTemplates,
		filtered,
		onFocusHandled,
		kind,
		onKindChange,
		builtIn.focusKey,
	]);

	const handleCreated = (templateId: string) => {
		setPendingFocus(`P${templateId}`);
	};

	const handleDeleted = (templateId: string) => {
		const key = `P${templateId}`;
		setOpenItems((previous) => previous.filter((item) => item !== key));
		setPendingFocus((previous) => (previous === key ? null : previous));
	};

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<PillTabs
					tabs={KIND_TABS}
					active={kind}
					onChange={(next) => {
						setSearch("");
						onKindChange(next);
					}}
					aria-label="Template kind"
				/>
				<p className="text-sm text-muted-foreground">{KIND_COPY[kind]}</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative min-w-52 flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search templates…"
						className="pl-8"
						aria-label="Search templates"
					/>
				</div>
				<Select
					value={sort}
					onValueChange={(value) => {
						if (value === "newest" || value === "oldest" || value === "title") {
							setSort(value);
						}
					}}
				>
					<SelectTrigger size="sm" aria-label="Sort templates">
						<SelectValue />
					</SelectTrigger>
					<SelectContent align="end">
						<SelectItem value="newest">Newest</SelectItem>
						<SelectItem value="oldest">Oldest</SelectItem>
						<SelectItem value="title">Title A–Z</SelectItem>
					</SelectContent>
				</Select>
				<AddTemplateDialog kind={kind} onCreated={handleCreated} />
			</div>

			<Accordion
				value={openItems}
				onValueChange={(value) => setOpenItems(value as string[])}
				multiple
				className="gap-1"
			>
				<AccordionItem
					value={builtIn.focusKey}
					id={builtIn.focusKey}
					className="rounded-lg border border-border/80 px-4 data-open:border-ring/40"
				>
					<AccordionTrigger className="gap-2 rounded-none !py-3 hover:no-underline">
						<span className="font-heading text-base font-semibold">
							Built-in default
						</span>
						<span className="text-sm font-normal text-muted-foreground">
							Always available · view and copy only
						</span>
					</AccordionTrigger>
					<AccordionContent>
						<DefaultSystemPromptItem
							kind={kind}
							highlighted={highlightKey === builtIn.focusKey}
						/>
					</AccordionContent>
				</AccordionItem>

				{filtered.map((template) => {
					const key = `P${template._id}`;
					return (
						<AccordionItem
							key={template._id}
							value={key}
							id={key}
							className="rounded-lg border border-border/80 px-4 data-open:border-ring/40"
						>
							<AccordionTrigger className="gap-2 rounded-none !py-3 hover:no-underline">
								<span className="truncate font-medium">{template.title}</span>
							</AccordionTrigger>
							<AccordionContent>
								<SystemPromptItem
									template={template}
									highlighted={highlightKey === key}
									onDeleted={handleDeleted}
								/>
							</AccordionContent>
						</AccordionItem>
					);
				})}

				{templates !== undefined && filtered.length === 0 ? (
					<p className="py-6 text-center text-sm text-muted-foreground">
						{search.trim()
							? "No templates match that search."
							: "No custom templates yet — add your first one above."}
					</p>
				) : null}
			</Accordion>
		</div>
	);
}
