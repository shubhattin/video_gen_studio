export type EditableVideoScene = {
	sceneNumber: number;
	intent: string;
	subjects: string;
	locationTime: string;
	composition: string;
	lensCamera: string;
	lighting: string;
	paletteAesthetics: string;
	actionMotion: string;
	soundDirection: string;
	transition: string;
	negativeConstraints: string;
};

const FIELD_LABELS = [
	["subjects", "Subjects"],
	["locationTime", "Location / time"],
	["composition", "Composition"],
	["lensCamera", "Lens / camera"],
	["lighting", "Lighting"],
	["paletteAesthetics", "Palette"],
	["actionMotion", "Motion"],
	["soundDirection", "Sound"],
	["transition", "Transition"],
	["negativeConstraints", "Avoid"],
] as const;

type SceneField = (typeof FIELD_LABELS)[number][0];

/** Compact provider prompt derived from structured scenes (shared with generation). */
export function buildVideoPromptFromScenes(
	scenes: Array<{ intent: string; actionMotion: string }>,
) {
	const compact = scenes
		.slice(0, 6)
		.map(
			(scene, index) => `${index + 1}. ${scene.intent}: ${scene.actionMotion}`,
		)
		.join(" | ");
	return `${compact} | stylized illustrated characters, not photoreal people`;
}

export function videoScenesToMarkdown(scenes: EditableVideoScene[]): string {
	return scenes
		.map((scene) => {
			const lines = [
				`### Scene ${scene.sceneNumber}: ${scene.intent}`,
				...FIELD_LABELS.map(
					([key, label]) => `- **${label}:** ${scene[key] || "—"}`,
				),
			];
			return lines.join("\n");
		})
		.join("\n\n");
}

function emptyScene(sceneNumber: number): EditableVideoScene {
	return {
		sceneNumber,
		intent: "Untitled beat",
		subjects: "",
		locationTime: "",
		composition: "",
		lensCamera: "",
		lighting: "",
		paletteAesthetics: "",
		actionMotion: "",
		soundDirection: "",
		transition: "",
		negativeConstraints: "",
	};
}

function labelToField(label: string): SceneField | null {
	const normalized = label.trim().toLowerCase();
	for (const [key, fieldLabel] of FIELD_LABELS) {
		if (fieldLabel.toLowerCase() === normalized) {
			return key;
		}
	}
	return null;
}

/**
 * Parse markdown produced by {@link videoScenesToMarkdown}.
 * Throws if no scenes can be recovered.
 */
export function markdownToVideoScenes(markdown: string): EditableVideoScene[] {
	const trimmed = markdown.trim();
	if (!trimmed) {
		throw new Error("Video plan markdown is empty.");
	}

	const chunks = trimmed.split(/^###\s+/m).filter((chunk) => chunk.trim());
	const scenes: EditableVideoScene[] = [];

	for (const chunk of chunks) {
		const lines = chunk.split("\n");
		const header = lines[0]?.trim() ?? "";
		const headerMatch = /^Scene\s+(\d+)\s*:\s*(.*)$/i.exec(header);
		if (!headerMatch) {
			continue;
		}
		const sceneNumber = Number(headerMatch[1]);
		const scene = emptyScene(
			Number.isFinite(sceneNumber) && sceneNumber > 0
				? sceneNumber
				: scenes.length + 1,
		);
		scene.intent = headerMatch[2]?.trim() || scene.intent;

		for (const line of lines.slice(1)) {
			const fieldMatch = /^-\s+\*\*(.+?):\*\*\s*(.*)$/.exec(line.trim());
			if (!fieldMatch) continue;
			const field = labelToField(fieldMatch[1] ?? "");
			if (!field) continue;
			const value = (fieldMatch[2] ?? "").trim();
			scene[field] = value === "—" ? "" : value;
		}
		scenes.push(scene);
	}

	if (scenes.length === 0) {
		throw new Error(
			'Could not parse scenes. Keep headings like "### Scene 1: …" and bullet fields.',
		);
	}

	return scenes
		.sort((a, b) => a.sceneNumber - b.sceneNumber)
		.map((scene, index) => ({
			...scene,
			sceneNumber: index + 1,
		}));
}
