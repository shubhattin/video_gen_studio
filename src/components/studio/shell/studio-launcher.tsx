import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Clapperboard, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import {
	type CompositionSettings,
	MultiClipCompositionControls,
} from "#/components/studio/composition/multi-clip-composition-controls";
import {
	type VideoConfigState,
	VideoConfiguration,
} from "#/components/studio/video/video-configuration";
import { VideoModelSelector } from "#/components/studio/video/video-model-selector";
import { Button } from "#/components/ui/button";
import { defaultVideoParams, type VideoModelId } from "#/lib/model-catalog";
import { notifyStudioError } from "#/lib/studio-toast";
import { cn } from "#/lib/utils";

type StudioType = "shloka" | "model";

type StudioLauncherProps = {
	/** Called after a Shloka Studio run is created on the home page. */
	onShlokaRunCreated: (runId: Id<"generationRuns">) => void;
};

const STUDIOS: Array<{
	id: StudioType;
	title: string;
	description: string;
	icon: typeof Sparkles;
}> = [
	{
		id: "shloka",
		title: "Shloka Studio",
		description:
			"Assisted flow for devotional shorts — plan scenes from a verse, craft the reference still, then render the clip.",
		icon: Sparkles,
	},
	{
		id: "model",
		title: "Model Studio",
		description:
			"Direct access to the video provider APIs — compose a prompt and generate clips with full control.",
		icon: Clapperboard,
	},
];

/**
 * Home-page launcher for a new run. Pick Shloka Studio or Model Studio,
 * configure the video model, then start a run of that type.
 */
export function StudioLauncher({ onShlokaRunCreated }: StudioLauncherProps) {
	const navigate = useNavigate();
	const createStudioRun = useMutation(api.studio.mutations.createStudioRun);
	const [studio, setStudio] = useState<StudioType>("shloka");
	const [selectedModel, setSelectedModel] = useState<VideoModelId>(
		"bytedance/seedance-2.5",
	);
	const [videoConfig, setVideoConfig] = useState<VideoConfigState>(() =>
		defaultVideoParams("bytedance/seedance-2.5"),
	);
	const [composition, setComposition] = useState<CompositionSettings>({
		enabled: false,
		mode: "continuation",
		multiplier: 2,
	});
	const [creating, setCreating] = useState(false);

	const onStart = async () => {
		setCreating(true);
		try {
			const runId = await createStudioRun({
				provenance: studio === "shloka" ? "shloka" : "model-studio",
				selectedModelId: selectedModel,
				videoParams: { ...videoConfig, modelId: selectedModel },
				compositionMode: composition.enabled ? composition.mode : undefined,
				compositionMultiplier: composition.enabled
					? composition.multiplier
					: undefined,
				compositionClipCount: composition.enabled
					? composition.multiplier
					: undefined,
			});
			if (studio === "shloka") {
				onShlokaRunCreated(runId);
			} else {
				void navigate({ to: "/studio", search: { run: runId } });
			}
		} catch (error) {
			notifyStudioError("Could not create the run", error);
		} finally {
			setCreating(false);
		}
	};

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-1.5">
				<h2 className="font-heading text-lg font-semibold">Start a new run</h2>
				<p className="text-sm text-muted-foreground">
					Choose a studio, pick a model and settings, then start the run.
				</p>
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				{STUDIOS.map((entry) => {
					const Icon = entry.icon;
					const isActive = studio === entry.id;
					return (
						<button
							key={entry.id}
							type="button"
							aria-pressed={isActive}
							onClick={() => setStudio(entry.id)}
							className={cn(
								"flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-all outline-none",
								"focus-visible:ring-3 focus-visible:ring-ring/50",
								isActive
									? "border-ring/50 bg-accent/40 ring-2 ring-ring/40"
									: "border-border bg-transparent hover:bg-muted/40",
							)}
						>
							<span className="flex items-center gap-2 font-heading text-base font-semibold">
								<Icon className="size-4 text-muted-foreground" />
								{entry.title}
							</span>
							<span className="text-sm text-muted-foreground">
								{entry.description}
							</span>
						</button>
					);
				})}
			</div>

			<div className="flex flex-wrap gap-3">
				<Button
					className="min-h-11"
					disabled={creating}
					onClick={() => void onStart()}
				>
					<Plus className="size-4" />
					{creating
						? "Creating…"
						: studio === "shloka"
							? "Start New Shloka Run"
							: "Start New Model Run"}
				</Button>
			</div>

			<div className="flex flex-col gap-5 border-t border-border/80 pt-5">
				<section className="flex flex-col gap-1.5">
					<p className="text-sm font-medium">Video model</p>
					<VideoModelSelector
						value={selectedModel}
						onValueChange={(modelId) => {
							setSelectedModel(modelId);
							setVideoConfig(defaultVideoParams(modelId));
						}}
					/>
				</section>

				<MultiClipCompositionControls
					value={composition}
					modelId={selectedModel}
					durationSeconds={videoConfig.durationSeconds}
					onChange={setComposition}
				/>

				<VideoConfiguration value={videoConfig} onChange={setVideoConfig} />
			</div>
		</div>
	);
}
