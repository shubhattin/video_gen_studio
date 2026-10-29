import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { AudioLines, Clapperboard, Plus, Sparkles, Video } from "lucide-react";
import { useState } from "react";
import { AudioRunSetup } from "#/components/studio/audio/audio-run-setup";
import { type PillTab, PillTabs } from "#/components/studio/pill-tabs";
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

type Medium = "video" | "audio";

const MEDIUM_TABS: ReadonlyArray<PillTab<Medium>> = [
	{ id: "video", label: "Video", icon: Video },
	{ id: "audio", label: "Audio", icon: AudioLines },
];

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
			"Assisted flow for shloka explainers — plan scenes from a verse, craft the reference still, then render the clip.",
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
 * Home-page launcher for a new run. Pick a medium (video / audio), then the
 * assisted or direct studio for it, and start a run of that type.
 */
export function StudioLauncher({ onShlokaRunCreated }: StudioLauncherProps) {
	const navigate = useNavigate();
	const createShlokaDraft = useMutation(api.studio.mutations.createShlokaDraft);
	const createModelStudioDraft = useMutation(
		api.studio.mutations.createModelStudioDraft,
	);
	const [medium, setMedium] = useState<Medium>("video");
	const [studio, setStudio] = useState<StudioType>("shloka");
	const [selectedModel, setSelectedModel] = useState<VideoModelId>(
		"bytedance/seedance-2.5",
	);
	const [videoConfig, setVideoConfig] = useState<VideoConfigState>(() =>
		defaultVideoParams("bytedance/seedance-2.5"),
	);
	const [creating, setCreating] = useState(false);

	const onStart = async () => {
		setCreating(true);
		try {
			if (studio === "shloka") {
				const { runId } = await createShlokaDraft({});
				onShlokaRunCreated(runId);
			} else {
				const runId = await createModelStudioDraft({
					modelId: selectedModel,
					prompt: "",
				});
				void navigate({ to: "/studio", search: { run: runId } });
			}
		} catch (error) {
			notifyStudioError("Could not create the run", error);
		} finally {
			setCreating(false);
		}
	};

	const mediumSwitch = (
		<PillTabs
			tabs={MEDIUM_TABS}
			active={medium}
			onChange={setMedium}
			aria-label="Studio medium"
		/>
	);

	if (medium === "audio") {
		return (
			<div className="flex flex-col gap-5">
				{mediumSwitch}
				<AudioRunSetup
					onCreated={(runId) =>
						void navigate({ to: "/audio", search: { run: runId } })
					}
				/>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			{mediumSwitch}
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

			{studio === "model" ? (
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

					<VideoConfiguration value={videoConfig} onChange={setVideoConfig} />
				</div>
			) : null}
		</div>
	);
}
