import { CheckIcon, CaretUpDownIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
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
	if (profile.supportsNegativePrompt) chips.push("Neg. prompt");
	if (profile.requiresFirstFrame) chips.push("Requires frame");
	return chips;
}

function formatUsdPerSecond(value: number | undefined) {
	if (value == null || !Number.isFinite(value)) return null;
	return `$${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}/s`;
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

	const sortedModelIds = useMemo(
		() => sortVideoModelsByPrice(undefined, pricingByModelId),
		[pricingByModelId],
	);

	const selected = MODEL_CAPABILITY_PROFILES[value];
	const selectedPricing = gatewayPricingById?.get(value);
	const selectedSortPrice = resolveVideoModelSortPrice(
		value,
		pricingSkusById?.get(value),
	);
	const selectedPriceLabel = formatUsdPerSecond(selectedSortPrice);

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
							{selectedPriceLabel ? (
								<span className="ml-2 font-normal text-muted-foreground">
									{selectedPriceLabel}
								</span>
							) : null}
						</span>
						<span className="truncate text-xs text-muted-foreground">
							{selected.resolutions.join(" · ")} ·{" "}
							{selected.supportedDurations[0]}–
							{selected.supportedDurations.at(-1)}s
							{selected.supportsAudio ? " · audio" : ""}
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
				<Command className="rounded-md!">
					<CommandInput placeholder="Search video models…" />
					<CommandList className="max-h-80">
						<CommandEmpty>No models found.</CommandEmpty>
						<CommandGroup heading="OpenRouter video models · cheapest first">
							{sortedModelIds.map((modelId) => {
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

								return (
									<CommandItem
										key={modelId}
										value={`${profile.displayName} ${modelId} ${profile.description}`}
										onSelect={() => {
											onValueChange(modelId);
											setOpen(false);
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
												{isSelected ? (
													<Badge variant="outline">Selected</Badge>
												) : null}
											</span>
											<span className="text-xs text-muted-foreground">
												{profile.description}
											</span>
											<span className="flex flex-wrap gap-1.5">
												{chips.map((chip) => (
													<Badge
														key={chip}
														variant="outline"
														className="font-normal"
													>
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
													? `OpenRouter SKU: ${pricing.output}`
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
							})}
						</CommandGroup>
					</CommandList>
				</Command>
				{selectedPricing?.output || selected.pricingNotes ? (
					<div className="border-t border-border/80 px-3 py-2 text-xs text-muted-foreground">
						Current:{" "}
						{selectedPricing?.output
							? `OpenRouter SKU ${selectedPricing.output}`
							: selected.pricingNotes}
					</div>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
