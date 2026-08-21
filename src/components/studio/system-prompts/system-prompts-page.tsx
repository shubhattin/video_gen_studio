import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { AddTemplateDialog } from "./add-template-dialog";
import { DefaultSystemPromptItem } from "./default-system-prompt-item";
import { SystemPromptItem } from "./system-prompt-item";

export const DEFAULT_ITEM_KEY = "Pdefault";

type SortMode = "newest" | "oldest" | "title";

type SystemPromptsPageProps = {
	/**
	 * Deep-link focus key (`Pdefault` or `P<templateId>`) that should be
	 * auto-expanded, scrolled to, and briefly highlighted.
	 */
	focusKey: string | null;
	/** Called once focus handling is done so the hash can be cleared. */
	onFocusHandled?: () => void;
};

export function SystemPromptsPage({
	focusKey,
	onFocusHandled,
}: SystemPromptsPageProps) {
	const templates = useQuery(api.studio.queries.listSystemPromptTemplates);
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
		// If the deep-linked template exists but is hidden by the search filter,
		// clear the search so it becomes visible and can be scrolled to.
		if (key !== DEFAULT_ITEM_KEY && templates !== undefined) {
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
			key === DEFAULT_ITEM_KEY ||
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
	}, [pendingFocus, templates, filtered, onFocusHandled]);

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
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
						System prompt templates
					</h1>
					<p className="text-sm text-muted-foreground">
						Curate the creative-direction prompts used when generating Shloka
						plans. The built-in default is always available and cannot be
						edited.
					</p>
				</div>
				<AddTemplateDialog onCreated={handleCreated} />
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
			</div>

			<Accordion
				value={openItems}
				onValueChange={(value) => setOpenItems(value as string[])}
				multiple
				className="gap-1"
			>
				<AccordionItem
					value={DEFAULT_ITEM_KEY}
					id={DEFAULT_ITEM_KEY}
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
							highlighted={highlightKey === DEFAULT_ITEM_KEY}
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
