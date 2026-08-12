import { Info } from "lucide-react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { cn } from "#/lib/utils";

export type CompositionAttemptSummary = {
	_id: string;
	attemptNumber: number;
	status: string;
	mode?: string;
	clipCount?: number;
	videoParams?: {
		modelId?: string;
		aspectRatio?: string;
		resolution?: string;
		durationSeconds?: number;
		generateAudio?: boolean;
	};
	overallDescription?: string;
	plannerModel?: string;
	plannerReasoning?: string;
	estimatedCostUsd?: number;
	actualCostUsd?: number;
	createdAt?: number;
};

type SceneClip = {
	clipIndex: number;
	scenePrompt: string;
	continuityInstructions?: string;
	transition?: string;
};

type CompositionAttemptControlsProps = {
	attempts: CompositionAttemptSummary[];
	activeJobId?: string | null;
	onSelectAttempt?: (jobId: string) => void;
	disabled?: boolean;
	scenes?: SceneClip[];
	/** Fallback config when the active attempt summary is incomplete. */
	activeConfig?: CompositionAttemptSummary | null;
	className?: string;
};

function statusLabel(status: string) {
	switch (status) {
		case "awaiting_terminal_frame":
			return "handoff";
		default:
			return status.replaceAll("_", " ");
	}
}

function shortModelId(modelId?: string) {
	if (!modelId) return null;
	const parts = modelId.split("/");
	return parts[parts.length - 1] ?? modelId;
}

function InfoRow({
	label,
	value,
	mono,
}: {
	label: string;
	value?: string | number | null;
	mono?: boolean;
}) {
	if (value == null || value === "") return null;
	return (
		<div className="flex items-start justify-between gap-3">
			<span className="shrink-0 text-xs text-muted-foreground">{label}</span>
			<span
				className={cn(
					"min-w-0 text-right text-xs text-foreground",
					mono && "font-mono break-all",
				)}
			>
				{value}
			</span>
		</div>
	);
}

function AttemptDetailsPopover({
	active,
	scenes,
}: {
	active: CompositionAttemptSummary | null | undefined;
	scenes: SceneClip[];
}) {
	const params = active?.videoParams;
	const sortedScenes = [...scenes].sort((a, b) => a.clipIndex - b.clipIndex);

	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Composition plan details"
					/>
				}
			>
				<Info />
			</PopoverTrigger>
			<PopoverContent align="end" className="w-96 max-w-[min(24rem,92vw)] gap-3 p-4">
				<PopoverHeader>
					<PopoverTitle>
						{active?.attemptNumber
							? `Plan ${active.attemptNumber} details`
							: "Composition details"}
					</PopoverTitle>
					<PopoverDescription>
						Saved clip config and scene scripts for this plan.
					</PopoverDescription>
				</PopoverHeader>
				<div className="flex flex-col gap-2">
					<InfoRow label="Status" value={active?.status} />
					<InfoRow label="Mode" value={active?.mode} />
					<InfoRow label="Model" value={params?.modelId} mono />
					<InfoRow label="Aspect" value={params?.aspectRatio} />
					<InfoRow label="Resolution" value={params?.resolution} />
					<InfoRow
						label="Clip length"
						value={
							params?.durationSeconds != null
								? `${params.durationSeconds}s`
								: null
						}
					/>
					<InfoRow
						label="Audio"
						value={
							params?.generateAudio == null
								? null
								: params.generateAudio
									? "On"
									: "Off"
						}
					/>
					<InfoRow label="Clips" value={active?.clipCount} />
					<InfoRow label="Planner" value={active?.plannerModel} mono />
					<InfoRow label="Reasoning" value={active?.plannerReasoning} />
					<InfoRow
						label="Est. cost"
						value={
							active?.estimatedCostUsd != null
								? `$${active.estimatedCostUsd.toFixed(4)}`
								: null
						}
					/>
					<InfoRow
						label="Actual cost"
						value={
							active?.actualCostUsd != null
								? `$${active.actualCostUsd.toFixed(4)}`
								: null
						}
					/>
					{active?.createdAt ? (
						<InfoRow
							label="Created"
							value={new Date(active.createdAt).toLocaleString()}
						/>
					) : null}
				</div>
				{active?.overallDescription?.trim() ? (
					<div className="flex flex-col gap-1.5 border-t border-border/70 pt-3">
						<span className="text-xs text-muted-foreground">Overview</span>
						<p className="max-h-24 overflow-y-auto text-xs leading-relaxed text-foreground">
							{active.overallDescription.trim()}
						</p>
					</div>
				) : null}
				{sortedScenes.length > 0 ? (
					<div className="flex flex-col gap-2 border-t border-border/70 pt-3">
						<span className="text-xs text-muted-foreground">Scene scripts</span>
						<div className="flex max-h-56 flex-col gap-3 overflow-y-auto">
							{sortedScenes.map((scene) => (
								<div key={scene.clipIndex} className="flex flex-col gap-1">
									<span className="text-xs font-medium text-foreground">
										Clip {scene.clipIndex + 1}
									</span>
									<p className="text-xs leading-relaxed text-muted-foreground">
										{scene.scenePrompt}
									</p>
									{scene.continuityInstructions?.trim() ? (
										<p className="text-[11px] leading-relaxed text-muted-foreground/90">
											Continuity: {scene.continuityInstructions.trim()}
										</p>
									) : null}
									{scene.transition?.trim() ? (
										<p className="text-[11px] leading-relaxed text-muted-foreground/90">
											Transition: {scene.transition.trim()}
										</p>
									) : null}
								</div>
							))}
						</div>
					</div>
				) : null}
			</PopoverContent>
		</Popover>
	);
}

/**
 * Plan-level attempt switcher. Place near composition planning, not on the player.
 */
export function CompositionAttemptControls({
	attempts,
	activeJobId,
	onSelectAttempt,
	disabled,
	scenes = [],
	activeConfig,
	className,
}: CompositionAttemptControlsProps) {
	if (attempts.length === 0 && !activeConfig) {
		return null;
	}

	const ordered = [...attempts].sort(
		(a, b) => a.attemptNumber - b.attemptNumber,
	);
	const active =
		ordered.find((item) => item._id === activeJobId) ??
		activeConfig ??
		ordered[ordered.length - 1];
	const activeValue = active?._id ?? ordered[0]?._id;
	const modelLabel = shortModelId(active?.videoParams?.modelId);
	const clipLabel =
		active?.clipCount != null ? `${active.clipCount} clips` : null;
	const metaBits = [modelLabel, clipLabel, active?.mode].filter(Boolean);

	return (
		<section
			className={cn(
				"flex flex-col gap-3 border-t border-border/80 pt-6",
				className,
			)}
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="font-heading text-xl font-semibold">
						Composition plans
					</h2>
					<p className="text-sm text-muted-foreground">
						{ordered.length > 1
							? "Switch plans to compare scripts, config, and generated clips."
							: "Each replan keeps a separate attempt you can revisit."}
					</p>
				</div>
				<AttemptDetailsPopover active={active} scenes={scenes} />
			</div>

			{ordered.length > 1 && activeValue ? (
				<Tabs
					value={activeValue}
					onValueChange={(value) => {
						if (disabled || !value || value === activeValue) return;
						onSelectAttempt?.(value);
					}}
					className="gap-3"
				>
					<TabsList
						variant="line"
						className={cn(
							"h-auto max-w-full flex-wrap justify-start gap-1",
							disabled && "pointer-events-none opacity-60",
						)}
					>
						{ordered.map((attempt) => (
							<TabsTrigger
								key={attempt._id}
								value={attempt._id}
								disabled={disabled}
								className="flex-none flex-col items-start gap-0.5 px-3 py-2"
							>
								<span className="flex items-center gap-1.5">
									<span className="font-medium">
										Plan {attempt.attemptNumber}
									</span>
									<Badge
										variant={
											attempt.status === "failed" ? "destructive" : "outline"
										}
										className="h-5 px-1.5 text-[10px] font-normal capitalize"
									>
										{statusLabel(attempt.status)}
									</Badge>
								</span>
								<span className="text-[11px] font-normal text-muted-foreground">
									{[
										shortModelId(attempt.videoParams?.modelId),
										attempt.clipCount != null
											? `${attempt.clipCount} clips`
											: null,
									]
										.filter(Boolean)
										.join(" · ") || "—"}
								</span>
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
			) : active?.attemptNumber ? (
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="secondary" className="font-mono tabular-nums">
						Plan {active.attemptNumber}
					</Badge>
					<Badge
						variant={active.status === "failed" ? "destructive" : "outline"}
						className="capitalize"
					>
						{statusLabel(active.status)}
					</Badge>
				</div>
			) : null}

			{metaBits.length > 0 ? (
				<p className="text-xs text-muted-foreground">{metaBits.join(" · ")}</p>
			) : null}

			{disabled ? (
				<p className="text-xs text-muted-foreground">
					Plan switching is paused while this composition is generating.
				</p>
			) : null}
		</section>
	);
}
