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
};

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

export function CompositionAttemptControls({
	attempts,
	activeJobId,
	onSelectAttempt,
	disabled,
	scenes = [],
	activeConfig,
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
	const params = active?.videoParams;
	const sortedScenes = [...scenes].sort((a, b) => a.clipIndex - b.clipIndex);

	return (
		<div className="flex flex-wrap items-center gap-2">
			{ordered.length > 1 ? (
				<div className="flex flex-wrap items-center gap-1">
					<span className="mr-1 text-xs text-muted-foreground">Attempts</span>
					{ordered.map((attempt) => {
						const isActive = attempt._id === active?._id;
						return (
							<Button
								key={attempt._id}
								type="button"
								size="sm"
								variant={isActive ? "secondary" : "outline"}
								disabled={disabled || isActive}
								aria-pressed={isActive}
								aria-label={`Composition attempt ${attempt.attemptNumber}`}
								className={cn(
									"min-w-9 px-2.5 font-mono tabular-nums",
									isActive && "ring-1 ring-primary/40",
								)}
								onClick={() => onSelectAttempt?.(attempt._id)}
							>
								{attempt.attemptNumber}
							</Button>
						);
					})}
				</div>
			) : active?.attemptNumber ? (
				<Badge variant="outline" className="font-mono tabular-nums">
					Attempt {active.attemptNumber}
				</Badge>
			) : null}

			<Popover>
				<PopoverTrigger
					render={
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Composition attempt details"
						/>
					}
				>
					<Info />
				</PopoverTrigger>
				<PopoverContent align="end" className="w-96 max-w-[min(24rem,92vw)] gap-3 p-4">
					<PopoverHeader>
						<PopoverTitle>
							{active?.attemptNumber
								? `Attempt ${active.attemptNumber} details`
								: "Composition details"}
						</PopoverTitle>
						<PopoverDescription>
							Saved clip config and scene scripts for this attempt.
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
		</div>
	);
}
