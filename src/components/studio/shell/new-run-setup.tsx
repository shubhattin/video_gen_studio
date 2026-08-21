import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
	type VideoConfigState,
	VideoConfiguration,
} from "#/components/studio/video/video-configuration";
import { VideoModelSelector } from "#/components/studio/video/video-model-selector";
import { Button } from "#/components/ui/button";
import { defaultVideoParams, type VideoModelId } from "#/lib/model-catalog";
import { notifyStudioError } from "#/lib/studio-toast";

type NewRunSetupProps = {
	onCreated: (runId: Id<"modelStudioRuns">) => void;
};

/**
 * Lean "start a new run" setup for Model Studio shown before any run exists.
 * Only configuration (video model, video settings) is shown here — the prompt
 * field appears once the run is created. Clicking "Create run" creates the
 * run up-front and navigates to it, avoiding a lazy redirect on first action.
 */
export function NewRunSetup({ onCreated }: NewRunSetupProps) {
	const createModelStudioDraft = useMutation(
		api.studio.mutations.createModelStudioDraft,
	);
	const [selectedModel, setSelectedModel] = useState<VideoModelId>(
		"bytedance/seedance-2.5",
	);
	const [videoConfig, setVideoConfig] = useState<VideoConfigState>(() =>
		defaultVideoParams("bytedance/seedance-2.5"),
	);
	const [creating, setCreating] = useState(false);

	const onCreate = async () => {
		setCreating(true);
		try {
			const runId = await createModelStudioDraft({
				modelId: selectedModel,
			});
			onCreated(runId);
		} catch (error) {
			notifyStudioError("Could not create the run", error);
		} finally {
			setCreating(false);
		}
	};

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap gap-3">
				<Button
					className="min-h-11"
					disabled={creating}
					onClick={() => void onCreate()}
				>
					{creating ? "Creating…" : "Create New Run"}
				</Button>
			</div>

			<div className="flex flex-col gap-5">
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
		</div>
	);
}
