import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { resolveAudioParams } from "../lib/audioCatalog";
import { buildAudioProviderPrompt } from "../lib/audioPrompt";
import schema from "../schema";
import { modules } from "../test.setup";

const generateTextMock = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
	...(await importOriginal<typeof import("ai")>()),
	generateText: generateTextMock,
}));
vi.mock("../lib/providers", () => ({
	openRouterChatModel: () => ({}),
	getOpenRouterApiKey: () => "test-key",
}));

vi.mock("../lib/r2", () => ({
	buildStudioObjectKey: ({ kind }: { kind: string }) =>
		`studio/gallery/${kind}/test.bin`,
	createPresignedPutUrl: async ({ objectKey }: { objectKey: string }) =>
		`https://r2.example/put/${objectKey}`,
	createPresignedGetUrl: async ({ objectKey }: { objectKey: string }) =>
		`https://r2.example/get/${objectKey}`,
	headObject: async () => ({ contentType: "image/png", contentLength: 4 }),
	putObjectBytes: async ({ objectKey }: { objectKey: string }) => objectKey,
	deleteObjects: async () => undefined,
	deleteObject: async () => undefined,
}));

const ADMIN_IDENTITY = {
	subject: "admin-user",
	issuer: "https://auth.test",
	role: "admin",
} as const;

function adminConvex() {
	return convexTest(schema, modules).withIdentity(ADMIN_IDENTITY);
}

const SCRIPT = {
	title: "Saha Navavatu",
	styleDirection: "Calm Bhupali devotional, tanpura drone, soft bansuri, 70 BPM.",
	lyrics: "[Verse]\nॐ सह नाववतु।\n[Chorus]\nसह नौ भुनक्तु।",
	pronunciationNotes: "Clear visarga.",
};

async function getRun(
	t: ReturnType<typeof adminConvex>,
	runId: Id<"audioRuns">,
) {
	const run = await t.query(api.audio.queries.getAudioRun, { runId });
	if (!run) throw new Error("run missing");
	return run;
}

async function insertTake(
	t: ReturnType<typeof adminConvex>,
	runId: Id<"audioRuns">,
	objectKey = "studio/gallery/audios/a.mp3",
) {
	return await t.mutation(internal.audio.internal.insertGalleryAudio, {
		runId,
		objectKey,
		meta: { mimeType: "audio/mpeg", durationSeconds: 30, bytes: 10 },
		audioParams: { modelId: "google/lyria-3-clip-preview" },
		prompt: "prompt",
		outputText: "[0.0:8.0] ॐ सह नाववतु।",
		actualCostUsd: 0.04,
	});
}

describe("audio runs", () => {
	it("creates guided runs on the built-in prompt with model defaults", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.audio.mutations.createAudioRun, {
			mode: "guided",
			modelId: "google/lyria-3-pro-preview",
		});
		const run = await getRun(t, runId);
		expect(run.status).toBe("draft");
		expect(run.promptSelection).toEqual({ kind: "default" });
		expect(run.audioParams).toMatchObject({
			modelId: "google/lyria-3-pro-preview",
			targetDurationSeconds: 60,
			instrumental: false,
		});
		expect(run.audios).toEqual([]);
	});

	it("rejects unsupported models", async () => {
		const t = adminConvex();
		await expect(
			t.mutation(api.audio.mutations.createAudioRun, {
				mode: "direct",
				modelId: "openai/gpt-audio",
			}),
		).rejects.toThrow(/Unsupported audio model/);
	});

	it("falls back to the default model for runs on removed models", () => {
		expect(
			resolveAudioParams({ modelId: "openai/gpt-audio", voice: "sage" }),
		).toEqual({
			modelId: "google/lyria-3-pro-preview",
			targetDurationSeconds: 60,
			instrumental: false,
		});
	});

	it("normalizes params per model when saving", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.audio.mutations.createAudioRun, {
			mode: "direct",
			modelId: "google/lyria-3-clip-preview",
		});
		await t.mutation(api.audio.mutations.updateAudioRun, {
			runId,
			prompt: "  Recite: ॐ  ",
			audioParams: {
				modelId: "google/lyria-3-pro-preview",
				voice: "alloy",
				targetDurationSeconds: 999,
				instrumental: true,
			},
		});
		const run = await getRun(t, runId);
		expect(run.prompt).toBe("Recite: ॐ");
		expect(run.audioParams).toEqual({
			modelId: "google/lyria-3-pro-preview",
			targetDurationSeconds: 180,
			instrumental: true,
		});
	});

	it("rejects edits while the run is busy", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.audio.mutations.createAudioRun, {
			mode: "direct",
			modelId: "google/lyria-3-clip-preview",
		});
		await t.mutation(internal.audio.internal.setAudioRunStatus, {
			runId,
			status: "generating",
		});
		await expect(
			t.mutation(api.audio.mutations.updateAudioRun, { runId, prompt: "x" }),
		).rejects.toThrow(/busy/);
	});

	it("commits, revises, switches, and edits the guided script", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.audio.mutations.createAudioRun, {
			mode: "guided",
			modelId: "google/lyria-3-pro-preview",
		});
		const turn = {
			runId,
			userMessage: "## Instructions",
			script: SCRIPT,
			scriptParamsUsed: { modelId: "google/lyria-3-pro-preview" },
			scriptModel: "anthropic/claude-opus-5.5",
			status: "draft" as const,
		};
		await t.mutation(internal.audio.internal.commitAudioScriptRevision, {
			...turn,
			scriptSystemPrompt: "system",
		});
		await t.mutation(internal.audio.internal.commitAudioScriptRevision, {
			...turn,
			parentIndex: 0,
			revisionPrompt: "Slower tempo",
			script: { ...SCRIPT, title: "Slower" },
			scriptSystemPrompt: "ignored on revise",
		});
		let run = await getRun(t, runId);
		expect(run.scriptRevisions).toHaveLength(2);
		expect(run.activeScriptRevisionIndex).toBe(1);
		expect(run.activeScriptRevision?.script.title).toBe("Slower");
		expect(run.scriptSystemPrompt).toBe("system");

		await t.mutation(api.audio.mutations.selectAudioScriptRevision, {
			runId,
			revisionIndex: 0,
		});
		await t.mutation(api.audio.mutations.updateAudioScript, {
			runId,
			revisionIndex: 0,
			script: { ...SCRIPT, title: "  Edited  ", pronunciationNotes: " " },
		});
		run = await getRun(t, runId);
		expect(run.activeScriptRevision?.script.title).toBe("Edited");
		expect(run.activeScriptRevision?.script.pronunciationNotes).toBeUndefined();
		expect(run.scriptRevisions[1].script.title).toBe("Slower");

		// Regenerate starts a fresh conversation.
		await t.mutation(internal.audio.internal.commitAudioScriptRevision, {
			...turn,
			scriptSystemPrompt: "fresh",
		});
		run = await getRun(t, runId);
		expect(run.scriptRevisions).toHaveLength(1);
		expect(run.scriptSystemPrompt).toBe("fresh");
	});

	it("revises the script from the shown revision's conversation", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.audio.mutations.createAudioRun, {
			mode: "guided",
			modelId: "google/lyria-3-pro-preview",
		});
		await t.mutation(internal.audio.internal.commitAudioScriptRevision, {
			runId,
			userMessage: "ROOT BRIEF",
			script: SCRIPT,
			scriptParamsUsed: { modelId: "google/lyria-3-pro-preview" },
			scriptModel: "anthropic/claude-opus-5.5",
			scriptSystemPrompt: "SONG SYSTEM PROMPT",
			status: "draft",
		});
		generateTextMock.mockResolvedValue({
			output: { ...SCRIPT, title: "Slower", pronunciationNotes: null },
			warnings: [],
		});

		await t.action(api.audio.actions.reviseAudioScript, {
			runId,
			baseRevisionIndex: 0,
			prompt: "Slower tempo",
		});

		const call = generateTextMock.mock.calls[0]![0];
		expect(call.instructions).toContain("SONG SYSTEM PROMPT");
		expect(call.messages.map((m: { role: string }) => m.role)).toEqual([
			"user",
			"assistant",
			"user",
		]);
		expect(call.messages[0].content).toBe("ROOT BRIEF");
		expect(JSON.parse(call.messages[1].content).title).toBe(SCRIPT.title);
		expect(call.messages[2].content).toContain("Slower tempo");

		const run = await getRun(t, runId);
		expect(run.status).toBe("draft");
		expect(run.scriptRevisions).toHaveLength(2);
		expect(run.activeScriptRevision?.script.title).toBe("Slower");
		expect(run.scriptRevisions[1].parentIndex).toBe(0);
	});

	it("links takes to the run and lists them in history", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.audio.mutations.createAudioRun, {
			mode: "direct",
			modelId: "google/lyria-3-clip-preview",
		});
		await insertTake(t, runId);
		const run = await getRun(t, runId);
		expect(run.status).toBe("completed");
		expect(run.audios).toHaveLength(1);
		expect(run.audios[0].outputText).toContain("नाववतु");

		const activity = await t.query(api.studio.queries.listRecentActivity, {});
		const item = activity.find((entry: { _id: string }) => entry._id === runId);
		expect(item).toMatchObject({
			kind: "audio",
			audioMode: "direct",
			audioCount: 1,
		});
	});

	it("abandons takes on run delete and only then allows gallery delete", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.audio.mutations.createAudioRun, {
			mode: "direct",
			modelId: "google/lyria-3-clip-preview",
		});
		const audioId = await insertTake(t, runId);
		await expect(
			t.mutation(api.audio.mutations.deleteGalleryAudio, { audioId }),
		).rejects.toThrow(/connected to a run/);

		await t.mutation(api.audio.mutations.deleteAudioRun, { runId });
		expect(
			await t.query(api.audio.queries.getGalleryAudioRunConnection, { audioId }),
		).toBeNull();
		const gallery = await t.query(api.audio.queries.listGalleryAudios, {});
		expect(gallery).toHaveLength(1);

		await t.mutation(api.audio.mutations.deleteGalleryAudio, { audioId });
		expect(await t.query(api.audio.queries.listGalleryAudios, {})).toHaveLength(0);
	});

	it("deletes takes and run-only images with deleteMedia", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.audio.mutations.createAudioRun, {
			mode: "guided",
			modelId: "google/lyria-3-pro-preview",
		});
		const imageId = await t.mutation(internal.studio.internal.insertGalleryImage, {
			audioRunId: runId,
			objectKey: "studio/gallery/images/ref.png",
			meta: { mimeType: "image/png" },
			source: "uploaded",
		});
		await insertTake(t, runId);
		const run = await getRun(t, runId);
		expect(run.images.map((image: { id: string }) => image.id)).toEqual([imageId]);

		await t.mutation(api.audio.mutations.deleteAudioRun, {
			runId,
			deleteMedia: true,
		});
		expect(await t.query(api.audio.queries.listGalleryAudios, {})).toHaveLength(0);
		expect(await t.query(api.studio.queries.listGalleryImages, {})).toHaveLength(0);
	});

	it("caps reference images at 10", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.audio.mutations.createAudioRun, {
			mode: "direct",
			modelId: "google/lyria-3-clip-preview",
		});
		const ids: Id<"galleryImages">[] = [];
		for (let i = 0; i < 11; i++) {
			ids.push(
				await t.mutation(internal.studio.internal.insertGalleryImage, {
					objectKey: `studio/gallery/images/${i}.png`,
					meta: { mimeType: "image/png" },
					source: "uploaded",
					attachToRun: false,
				}),
			);
		}
		for (const imageId of ids.slice(0, 10)) {
			await t.mutation(api.audio.mutations.attachImageToAudioRun, {
				runId,
				imageId,
			});
		}
		await expect(
			t.mutation(api.audio.mutations.attachImageToAudioRun, {
				runId,
				imageId: ids[10],
			}),
		).rejects.toThrow(/at most 10/);
	});
});

describe("audio prompt templates", () => {
	it("keeps video and audio templates apart", async () => {
		const t = adminConvex();
		const videoId = await t.mutation(
			api.studio.mutations.createSystemPromptTemplate,
			{ title: "Video", kind: "video" },
		);
		const audioId = await t.mutation(
			api.studio.mutations.createSystemPromptTemplate,
			{ title: "Audio", kind: "audio" },
		);
		const audioTemplates = await t.query(
			api.studio.queries.listSystemPromptTemplates,
			{ kind: "audio" },
		);
		expect(audioTemplates.map((item: { _id: string }) => item._id)).toEqual([
			audioId,
		]);
		expect(
			await t.query(api.studio.queries.listSystemPromptTemplates, {}),
		).toHaveLength(2);

		const runId = await t.mutation(api.audio.mutations.createAudioRun, {
			mode: "guided",
			modelId: "google/lyria-3-pro-preview",
		});
		await expect(
			t.mutation(api.audio.mutations.updateAudioRun, {
				runId,
				promptSelection: { kind: "template", templateId: videoId },
			}),
		).rejects.toThrow(/audio system prompt template/);

		await t.mutation(api.audio.mutations.updateAudioRun, {
			runId,
			promptSelection: { kind: "template", templateId: audioId },
		});
		await t.mutation(api.studio.mutations.deleteSystemPromptTemplate, {
			templateId: audioId,
		});
		const run = await getRun(t, runId);
		expect(run.promptSelection).toBeUndefined();
	});

	it("rejects audio templates for video planning", async () => {
		const t = adminConvex();
		const audioId = await t.mutation(
			api.studio.mutations.createSystemPromptTemplate,
			{ title: "Audio", kind: "audio" },
		);
		await expect(
			t.query(internal.studio.queries.resolvePlannerPromptSelectionForRun, {
				selection: { kind: "template", templateId: audioId },
			}),
		).rejects.toThrow(/audio template/);
	});
});

describe("buildAudioProviderPrompt", () => {
	it("includes direction, length, and lyrics for Lyria Pro", () => {
		const prompt = buildAudioProviderPrompt(SCRIPT, {
			modelId: "google/lyria-3-pro-preview",
			targetDurationSeconds: 90,
		});
		expect(prompt).toContain("Title: Saha Navavatu");
		expect(prompt).toContain("Length: about 90 seconds.");
		expect(prompt).toContain("Lyrics (Sanskrit, Devanagari):\n[Verse]");
		expect(prompt).toContain("Sanskrit pronunciation: Clear visarga.");
	});

	it("omits lyrics and length for instrumental Lyria Clip", () => {
		const prompt = buildAudioProviderPrompt(SCRIPT, {
			modelId: "google/lyria-3-clip-preview",
			targetDurationSeconds: 90,
			instrumental: true,
		});
		expect(prompt).toContain("Instrumental only, no vocals.");
		expect(prompt).not.toContain("Lyrics");
		expect(prompt).not.toContain("Length:");
	});
});

describe("audio authorization", () => {
	it("rejects non-admin callers", async () => {
		const t = convexTest(schema, modules).withIdentity({
			subject: "member",
			issuer: "https://auth.test",
			role: "user",
		});
		await expect(
			t.mutation(api.audio.mutations.createAudioRun, {
				mode: "direct",
				modelId: "google/lyria-3-clip-preview",
			}),
		).rejects.toThrow(/Admin access required/);
		await expect(
			t.query(api.audio.queries.listGalleryAudios, {}),
		).rejects.toThrow(/Admin access required/);
	});
});
