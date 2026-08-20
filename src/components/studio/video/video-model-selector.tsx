import { CheckIcon, CaretUpDownIcon } from "@phosphor-icons/react";
import { useMemo, useState, type ReactNode } from "react";
import {
	ModelSelectorLogo,
	ModelSelectorName,
} from "#/components/ai-elements/model-selector";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "#/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
import {
	MODEL_CAPABILITY_PROFILES,
	VIDEO_MODEL_FAMILY_META,
	groupVideoModelsByFamily,
	resolveVideoModelSortPrice,
	sortVideoModelsByPrice,
	type VideoModelId,
} from "#/lib/model-catalog";
import { cn } from "#/lib/utils";

type GatewayPricing = {
	input?: string;
	output?: string;
};

type VideoModelSelectorProps = {
	value: VideoModelId;
	onValueChange: (modelId: VideoModelId) => void;
	gatewayPricingById?: Map<string, GatewayPricing>;
	/** Live OpenRouter `pricing_skus` by model id — drives cheapest-first sort. */
	pricingSkusById?: Map<string, Record<string, string>>;
	disabled?: boolean;
	className?: string;
};

type GroupBy = "none" | "provider";

function providerForModel(modelId: VideoModelId): string {
	const [provider] = modelId.split("/");
	if (provider === "google") return "google";
	if (provider === "x-ai") return "xai";
	if (provider === "openai") return "openai";
	if (provider === "alibaba") return "alibaba";
	if (provider === "runway") return "runway";
	if (provider === "bytedance") return "openrouter";
	if (provider === "kwaivgi") return "openrouter";
	return "openrouter";
}

function capabilityChips(modelId: VideoModelId) {
	const profile = MODEL_CAPABILITY_PROFILES[modelId];
	const chips: string[] = [];
	if (profile.supportsFirstFrame) chips.push("First frame");
	if (profile.supportsLastFrame) chips.push("Last frame");
	if (profile.supportsInputReferences) {
		chips.push(`Style refs ×${profile.maxInputReferences}`);
	}
	if (profile.supportsAudio) chips.push("Audio");
	if (!profile.supportsAudio) chips.push("Video only");
	if (profile.supportsNegativePrompt) chips.push("Neg. prompt");
	if (profile.requiresFirstFrame) chips.push("Requires frame");
	return chips;
}

function formatUsdPerSecond(value: number | undefined) {
	if (value == null || !Number.isFinite(value)) return null;
	return `$${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}/s`;
}

function FilterPill({
	active,
	children,
	onClick,
	disabled,
}: {
	active?: boolean;
	children: ReactNode;
	onClick?: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			onPointerDown={(event) => event.preventDefault()}
			className={cn(
				"inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors",
				active
					? "border-foreground/20 bg-foreground text-background"
					: "border-border/80 bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
				disabled && "pointer-events-none opacity-60",
			)}
		>
			{children}
		</button>
	);
}

function ModelRow({
	modelId,
	value,
	onValueChange,
	onClose,
	gatewayPricingById,
	pricingSkusById,
	searchExtra = "",
}: {
	modelId: VideoModelId;
	value: VideoModelId;
	onValueChange: (modelId: VideoModelId) => void;
	onClose: () => void;
	gatewayPricingById?: Map<string, GatewayPricing>;
	pricingSkusById?: Map<string, Record<string, string>>;
	searchExtra?: string;
}) {
	const profile = MODEL_CAPABILITY_PROFILES[modelId];
	const pricing = gatewayPricingById?.get(modelId);
	const chips = capabilityChips(modelId);
	const isSelected = modelId === value;
	const durations = profile.supportedDurations;
	const sortPrice = resolveVideoModelSortPrice(
		modelId,
		pricingSkusById?.get(modelId),
	);
	const priceLabel = formatUsdPerSecond(sortPrice);
	const audioPriceLabel = formatUsdPerSecond(
		profile.fallbackEstimateUsdPerSecondWithAudio,
	);
	const familyLabel = VIDEO_MODEL_FAMILY_META[profile.family].label;

	return (
		<CommandItem
			value={`${profile.displayName} ${modelId} ${familyLabel} ${profile.family} ${profile.description} ${chips.join(" ")} ${searchExtra}`}
			onSelect={() => {
				onValueChange(modelId);
				onClose();
			}}
			className="items-start gap-3 px-3 py-3"
		>
			<ModelSelectorLogo
				provider={providerForModel(modelId)}
				className="mt-0.5 size-4 shrink-0"
			/>
			<span className="flex min-w-0 flex-1 flex-col gap-1.5">
				<span className="flex flex-wrap items-center gap-2">
					<ModelSelectorName className="font-medium">
						{profile.displayName}
					</ModelSelectorName>
					{priceLabel ? (
						<Badge variant="secondary" className="font-normal">
							{priceLabel}
							{audioPriceLabel && audioPriceLabel !== priceLabel
								? ` · ${audioPriceLabel} audio`
								: ""}
						</Badge>
					) : null}
					{isSelected ? <Badge variant="outline">Selected</Badge> : null}
				</span>
				<span className="text-xs text-muted-foreground">
					{profile.description}
				</span>
				<span className="flex flex-wrap gap-1.5">
					{chips.map((chip) => (
						<Badge key={chip} variant="outline" className="font-normal">
							{chip}
						</Badge>
					))}
				</span>
				<span className="text-xs text-muted-foreground">
					{profile.aspectRatios.slice(0, 4).join(" · ")}
					{profile.aspectRatios.length > 4 ? "…" : ""}
					{" · "}
					{profile.resolutions.join(" · ")}
					{" · "}
					{durations[0]}–{durations[durations.length - 1]}s
				</span>
				<span className="text-xs text-muted-foreground">
					{pricing?.output
						? `Pricing ref: ${pricing.output}`
						: profile.pricingNotes}
				</span>
			</span>
			<CheckIcon
				className={cn(
					"mt-0.5 size-4 shrink-0",
					isSelected ? "opacity-100" : "opacity-0",
				)}
			/>
		</CommandItem>
	);
}

export function VideoModelSelector({
	value,
	onValueChange,
	gatewayPricingById,
	pricingSkusById,
	disabled,
	className,
}: VideoModelSelectorProps) {
	const [open, setOpen] = useState(false);
	const [groupBy, setGroupBy] = useState<GroupBy>("none");

	const pricingByModelId = useMemo(() => {
		if (!pricingSkusById || pricingSkusById.size === 0) {
			return undefined;
		}
		const record: Partial<
			Record<string, Record<string, string> | null | undefined>
		> = {};
		for (const [id, skus] of pricingSkusById) {
			record[id] = skus;
		}
		return record;
	}, [pricingSkusById]);

	const flatSorted = useMemo(
		() => sortVideoModelsByPrice(undefined, pricingByModelId),
		[pricingByModelId],
	);

	const groupedModels = useMemo(
		() => groupVideoModelsByFamily(undefined, pricingByModelId),
		[pricingByModelId],
	);

	const selected = MODEL_CAPABILITY_PROFILES[value];
	const selectedPricing = gatewayPricingById?.get(value);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<Button
						type="button"
						variant="outline"
						disabled={disabled}
						aria-expanded={open}
						className={cn(
							"h-auto min-h-11 w-full justify-between gap-3 px-3 py-2.5 text-left font-normal",
							className,
						)}
					/>
				}
			>
				<span className="flex min-w-0 flex-1 items-center gap-2.5">
					<ModelSelectorLogo
						provider={providerForModel(value)}
						className="size-4 shrink-0"
					/>
					<span className="flex min-w-0 flex-col gap-0.5">
						<span className="truncate text-sm font-medium">
							{selected.displayName}
						</span>
						<span className="truncate text-xs text-muted-foreground">
							{VIDEO_MODEL_FAMILY_META[selected.family].label} ·{" "}
							{selected.resolutions.join(" · ")} ·{" "}
							{selected.supportedDurations[0]}–
							{selected.supportedDurations.at(-1)}s
							{selected.supportsAudio ? " · audio" : " · video only"}
						</span>
					</span>
				</span>
				<CaretUpDownIcon className="size-4 shrink-0 opacity-50" />
			</PopoverTrigger>
			<PopoverContent
				align="start"
				sideOffset={6}
				className="w-(--anchor-width) min-w-80 max-w-xl gap-0 overflow-hidden p-0"
			>
				<div className="flex flex-col gap-2.5 border-b border-border/80 px-3 py-2.5">
					<div className="flex flex-wrap items-center gap-2">
						<span className="w-14 shrink-0 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
							Group by
						</span>
						<div className="flex flex-wrap gap-1.5">
							<FilterPill
								active={groupBy === "none"}
								onClick={() => setGroupBy("none")}
							>
								None
							</FilterPill>
							<FilterPill
								active={groupBy === "provider"}
								onClick={() => setGroupBy("provider")}
							>
								Provider
							</FilterPill>
						</div>
					</div>
				</div>

				<Command className="rounded-none! border-0 shadow-none">
					<CommandInput placeholder="Search models…" />
					<CommandList className="max-h-80">
						<CommandEmpty>No models found.</CommandEmpty>
						{groupBy === "none" ? (
							<CommandGroup heading="Cheapest first">
								{flatSorted.map((modelId) => (
									<ModelRow
										key={modelId}
										modelId={modelId}
										value={value}
										onValueChange={onValueChange}
										onClose={() => setOpen(false)}
										gatewayPricingById={gatewayPricingById}
										pricingSkusById={pricingSkusById}
									/>
								))}
							</CommandGroup>
						) : (
							groupedModels.map((group) => (
								<CommandGroup key={group.family} heading={group.label}>
									{group.modelIds.map((modelId) => (
										<ModelRow
											key={modelId}
											modelId={modelId}
											value={value}
											onValueChange={onValueChange}
											onClose={() => setOpen(false)}
											gatewayPricingById={gatewayPricingById}
											pricingSkusById={pricingSkusById}
											searchExtra={group.label}
										/>
									))}
								</CommandGroup>
							))
						)}
					</CommandList>
				</Command>
				{selectedPricing?.output || selected.pricingNotes ? (
					<div className="border-t border-border/80 px-3 py-2 text-xs text-muted-foreground">
						{selectedPricing?.output || selected.pricingNotes ? (
							<>
								Current:{" "}
								{selectedPricing?.output
									? `pricing ref ${selectedPricing.output}`
									: selected.pricingNotes}
							</>
						) : null}
					</div>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
