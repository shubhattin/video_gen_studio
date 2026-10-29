import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { AudioWaveform, Music, Plus } from "lucide-react";
import { useState } from "react";
import { AudioModelSelector } from "#/components/studio/audio/audio-model-selector";
import { Button } from "#/components/ui/button";
import { type AudioModelId, DEFAULT_AUDIO_MODEL_ID } from "#/lib/audio-catalog";
import { notifyStudioError } from "#/lib/studio-toast";
import { cn } from "#/lib/utils";

export type AudioRunMode = "guided" | "direct";

const MODES: Array<{
	id: AudioRunMode;
	title: string;
	description: string;
	icon: typeof Music;
}> = [
	{
		id: "guided",
		title: "Sanskrit Song Studio",
		description:
			"Assisted flow for short Sanskrit musiclets — Opus writes a song script from your instructions, you refine it, then render takes.",
		icon: Music,
	},
	{
		id: "direct",
		title: "Audio Model Studio",
		description:
			"Direct access to the audio models — write the prompt yourself and generate takes with full control.",
		icon: AudioWaveform,
	},
];

type AudioRunSetupProps = {
	onCreated: (runId: Id<"audioRuns">) => void;
};

/**
 * Start a new audio run: pick guided (song script) or direct mode and the
 * audio model. The run is created up-front, then the studio opens on it.
 */
export function AudioRunSetup({ onCreated }: AudioRunSetupProps) {
	const createAudioRun = useMutation(api.audio.mutations.createAudioRun);
	const [mode, setMode] = useState<AudioRunMode>("guided");
	const [modelId, setModelId] = useState<AudioModelId>(DEFAULT_AUDIO_MODEL_ID);
	const [creating, setCreating] = useState(false);

	const onCreate = async () => {
		setCreating(true);
		try {
			const runId = await createAudioRun({ mode, modelId });
			onCreated(runId);
		} catch (error) {
			notifyStudioError("Could not create the run", error);
		} finally {
			setCreating(false);
		}
	};

	return (
		<div className="flex flex-col gap-6">
			<div className="grid gap-3 sm:grid-cols-2">
				{MODES.map((entry) => {
					const Icon = entry.icon;
					const isActive = mode === entry.id;
					return (
						<button
							key={entry.id}
							type="button"
							aria-pressed={isActive}
							onClick={() => setMode(entry.id)}
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
					onClick={() => void onCreate()}
				>
					<Plus className="size-4" />
					{creating
						? "Creating…"
						: mode === "guided"
							? "Start New Song Run"
							: "Start New Audio Run"}
				</Button>
			</div>

			<section className="flex flex-col gap-2 border-t border-border/80 pt-5">
				<p className="text-sm font-medium">Audio model</p>
				<AudioModelSelector value={modelId} onValueChange={setModelId} />
				<p className="text-xs text-muted-foreground">
					You can switch models later — each run keeps every take it generates.
				</p>
			</section>
		</div>
	);
}
