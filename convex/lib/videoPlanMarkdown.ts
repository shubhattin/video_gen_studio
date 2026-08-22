/**
 * Seedance-oriented scene plan: six-part formula + intent heading.
 * Scenes are strictly the current eight-field shape.
 */

export type EditableVideoScene = {
	sceneNumber: number;
	intent: string;
	/** Who/what appears — required for Seedance. */
	subject: string;
	/** What happens — required for Seedance. */
	action: string;
	/** Scene / environment (optional). */
	scene: string;
	/** Visual style (optional). */
	style: string;
	/** Camera movement / cut (optional). */
	camera: string;
	/** Audio direction — only present when audio generation is enabled for the plan. */
	audio?: string | null;
};

/** Labels for markdown edit round-trip. */
const FIELD_LABELS = [
	["subject", "Subject"],
	["action", "Action"],
	["scene", "Scene"],
	["style", "Style"],
	["camera", "Camera"],
	["audio", "Audio"],
] as const;

type SceneField = (typeof FIELD_LABELS)[number][0];

/** Optional slots omitted from markdown/provider text when blank. */
const OPTIONAL_FIELDS = new Set<SceneField>([
	"scene",
	"style",
	"camera",
	"audio",
]);

/**
 * Scene shape after normalization: audio is stripped of null/whitespace so it
 * matches the Convex validator (`v.optional(v.string())`).
 */
export type NormalizedVideoScene = Omit<EditableVideoScene, "audio"> & {
	audio?: string;
};

/** Order by sceneNumber and renumber 1..n. Strips empty/null audio. */
export function normalizeVideoScenes(
	scenes: EditableVideoScene[] | undefined | null,
): NormalizedVideoScene[] {
	if (!scenes?.length) return [];
	return [...scenes]
		.sort((a, b) => a.sceneNumber - b.sceneNumber)
		.map((s, i) => ({
			...s,
			sceneNumber: i + 1,
			audio: s.audio?.trim() || undefined,
		}));
}

function compactSceneLine(scene: EditableVideoScene, index: number): string {
	const chunks: string[] = [
		`${index + 1}.${scene.intent}`,
		`Subject:${scene.subject}`,
		`Action:${scene.action}`,
	];
	if (scene.scene.trim()) chunks.push(`Scene:${scene.scene.trim()}`);
	if (scene.style.trim()) chunks.push(`Style:${scene.style.trim()}`);
	if (scene.camera.trim()) chunks.push(`Camera:${scene.camera.trim()}`);
	if (scene.audio?.trim()) chunks.push(`Audio:${scene.audio.trim()}`);
	return chunks.join(" ");
}

/**
 * Compact provider prompt from structured scenes (Seedance-oriented).
 * No scene-count truncation — full plan is included; summarization handles limits.
 */
export function buildVideoPromptFromScenes(
	scenes: EditableVideoScene[],
): string {
	const normalized = normalizeVideoScenes(scenes);
	if (normalized.length === 0) {
		return "stylized illustrated characters, not photoreal people";
	}
	const body = normalized.map((s, i) => compactSceneLine(s, i)).join("|");
	return `${body}|stylized illustrated characters, not photoreal people`;
}

/** Compact markdown for UI edit — omit blank optional slots; single blank line between scenes. */
export function videoScenesToMarkdown(scenes: EditableVideoScene[]): string {
	const normalized = normalizeVideoScenes(scenes);
	return normalized
		.map((scene) => {
			const lines = [`### Scene ${scene.sceneNumber}: ${scene.intent}`];
			for (const [key, label] of FIELD_LABELS) {
				const value = scene[key]?.trim() ?? "";
				if (!value && OPTIONAL_FIELDS.has(key)) continue;
				lines.push(`- **${label}:** ${value || "—"}`);
			}
			return lines.join("\n");
		})
		.join("\n");
}

function emptyScene(sceneNumber: number): EditableVideoScene {
	return {
		sceneNumber,
		intent: "Untitled beat",
		subject: "",
		action: "",
		scene: "",
		style: "",
		camera: "",
	};
}

function labelToField(label: string): SceneField | null {
	const normalized = label.trim().toLowerCase();
	const labels: Record<string, SceneField> = {
		subject: "subject",
		action: "action",
		scene: "scene",
		style: "style",
		camera: "camera",
		audio: "audio",
	};
	return labels[normalized] ?? null;
}

export type MarkdownToVideoScenesResult = {
	scenes: NormalizedVideoScene[];
	/** Non-blocking notice about non-conforming input. Null when input is clean. */
	warning: string | null;
};

/**
 * Parse markdown produced by {@link videoScenesToMarkdown}.
 * Never throws.
 */
export function markdownToVideoScenes(
	markdown: string,
): MarkdownToVideoScenesResult {
	const trimmed = markdown.trim();
	if (!trimmed) {
		return { scenes: [], warning: "Video plan markdown is empty." };
	}

	const chunks = trimmed.split(/^###\s+/m).filter((chunk) => chunk.trim());
	const scenes: EditableVideoScene[] = [];
	let skippedSections = 0;
	let unrecognizedFields = 0;

	for (const chunk of chunks) {
		const lines = chunk.split("\n");
		const header = lines[0]?.trim() ?? "";
		const headerMatch = /^Scene\s+(\d+)\s*[:\-—]?\s*(.*)$/i.exec(header);
		if (!headerMatch) {
			skippedSections++;
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
			const trimmedLine = line.trim();
			if (!trimmedLine) continue;
			const fieldMatch = /^-\s+\*\*(.+?):\*\*\s*(.*)$/.exec(trimmedLine);
			if (!fieldMatch) {
				if (/^[-*]\s+/.test(trimmedLine)) {
					unrecognizedFields++;
				}
				continue;
			}
			const field = labelToField(fieldMatch[1] ?? "");
			if (!field) {
				unrecognizedFields++;
				continue;
			}
			const value = (fieldMatch[2] ?? "").trim();
			// Audio is plan-optional: only populate it when the markdown
			// actually carries a non-empty value.
			if (field === "audio") {
				if (value && value !== "—") {
					scene.audio = value;
				}
				continue;
			}
			scene[field] = value === "—" ? "" : value;
		}
		scenes.push(scene);
	}

	if (scenes.length === 0) {
		return {
			scenes: [],
			warning:
				'Could not parse any scenes. Keep headings like "### Scene 1: …" with bullet fields ("- **Subject:** value").',
		};
	}

	const warnings: string[] = [];
	if (skippedSections > 0) {
		warnings.push(
			`${skippedSections} section${skippedSections === 1 ? "" : "s"} skipped — headings must look like "### Scene 1: …".`,
		);
	}
	if (unrecognizedFields > 0) {
		warnings.push(
			`${unrecognizedFields} field line${unrecognizedFields === 1 ? "" : "s"} not recognized — use "- **Label:** value".`,
		);
	}

	const sorted = scenes
		.sort((a, b) => a.sceneNumber - b.sceneNumber)
		.map((scene, index) => ({
			...scene,
			sceneNumber: index + 1,
			subject: scene.subject.trim() || "Untitled subject",
			action: scene.action.trim() || "Quiet motion",
			audio: scene.audio?.trim() || undefined,
		}));

	return {
		scenes: sorted,
		warning: warnings.length > 0 ? warnings.join(" ") : null,
	};
}

/** Stable hash of the canonical provider prompt source (for summarization cache). */
export function hashVideoPromptSource(text: string): string {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(16);
}
