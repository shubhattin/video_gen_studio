import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import {
	compositionPlannerOutputSchema,
	validateVideoParams,
} from "./lib/schemas";

describe("studio mutations", () => {
	it("creates a shloka draft with portrait defaults", async () => {
		const t = convexTest(schema, modules);
		const runId = await t.mutation(api.studio.createShlokaDraft, {
			shlokaText: "धर्मक्षेत्रे कुरुक्षेत्रे",
			customInstructions: "Twilight forest mood",
		});

		const run = await t.query(api.studio.getRun, { runId });
		expect(run?.provenance).toBe("shloka");
		expect(run?.status).toBe("draft");
		expect(run?.imageSize).toBe("1024x1536");
		expect(run?.videoParams?.aspectRatio).toBe("9:16");
		expect(run?.referenceImages).toEqual([]);
		expect(run?.videos).toEqual([]);
	});

	it("transitions plan commit to plan_ready", async () => {
		const t = convexTest(schema, modules);
		const runId = await t.mutation(api.studio.createShlokaDraft, {
			shlokaText: "Test shloka",
		});

		await t.mutation(internal.studioInternal.commitPlan, {
			runId,
			plannerModel: "openai/gpt-5.6-terra",
			plannerReasoning: "medium",
			imagePrompt: "Portrait warm temple courtyard with soft diya glow",
			videoScenes: [
				{
					sceneNumber: 1,
					intent: "Opening",
					subjects: "Temple path",
					locationTime: "Twilight",
					composition: "Centered portrait",
					lensCamera: "Slow push-in",
					lighting: "Soft gold",
					paletteAesthetics: "Warm marigold and sandalwood",
					actionMotion: "Gentle drift",
					soundDirection: "Quiet ambience",
					transition: "Fade",
					negativeConstraints: "No text overlays",
				},
			],
			planningKey: "plan-test",
		});

		const run = await t.query(api.studio.getRun, { runId });
		expect(run?.status).toBe("plan_ready");
		expect(run?.imagePrompt).toContain("Portrait");
	});

	it("deletes a run", async () => {
		const t = convexTest(schema, modules);
		const runId = await t.mutation(api.studio.createShlokaDraft, {
			shlokaText: "Delete me",
		});
		await t.mutation(api.studio.deleteRun, { runId });
		const run = await t.query(api.studio.getRun, { runId });
		expect(run).toBeNull();
	});

	it("attaches an uploaded reference image", async () => {
		const t = convexTest(schema, modules);
		const runId = await t.mutation(api.studio.createModelStudioDraft, {
			modelId: "google/veo-3.1-lite",
			prompt: "Temple courtyard at dusk",
		});

		const uploadUrl = await t.mutation(api.studio.generateUploadUrl, {});
		expect(typeof uploadUrl).toBe("string");

		const storageId = await t.run(async (ctx) => {
			const blob = new Blob([new Uint8Array([137, 80, 78, 71])], {
				type: "image/png",
			});
			return await ctx.storage.store(blob);
		});

		const attached = await t.mutation(api.studio.attachUploadedReferenceImage, {
			runId,
			storageId,
			mimeType: "image/png",
			width: 1024,
			height: 1536,
			bytes: 4,
		});

		const run = await t.query(api.studio.getRun, { runId });
		expect(run?.status).toBe("image_ready");
		expect(run?.firstFrameImageId).toBeUndefined();
		expect(run?.referenceImages).toHaveLength(1);
		expect(run?.referenceImages?.[0]?.source).toBe("uploaded");
		expect(run?.referenceImages?.[0]?.meta.mimeType).toBe("image/png");
		expect(run?.referenceImages?.[0]?.id).toBe(attached.imageId);
	});

	it("persists a bounded composition plan as ordered clip rows", async () => {
		const t = convexTest(schema, modules);
		const runId = await t.mutation(api.studio.createShlokaDraft, {
			shlokaText: "वसुदेवसुतं देवं",
		});
		await t.mutation(api.studio.updateDraft, {
			runId,
			compositionMode: "continuation",
			compositionMultiplier: 2,
			compositionClipCount: 2,
		});
		await t.mutation(internal.studioInternal.commitCompositionPlan, {
			runId,
			plannerModel: "openai/gpt-5.6-terra",
			plannerReasoning: "medium",
			imagePrompt: "A warm illustrated temple path at dawn with a golden diya",
			overallDescription: "A devotional walk from dawn prayer into quiet temple light.",
			clips: [
				{
					clipIndex: 0,
					globalDescription:
						"A devotional walk from dawn prayer into quiet temple light.",
					scenePrompt: "A devotee walks toward a dawn temple, slow camera push in.",
					continuityInstructions:
						"Keep the same illustrated devotee, saffron shawl, and golden dawn.",
					transition: "End on the devotee reaching the carved temple gate.",
				},
				{
					clipIndex: 1,
					globalDescription:
						"A devotional walk from dawn prayer into quiet temple light.",
					scenePrompt:
						"Continue from the gate into the glowing temple courtyard, gentle pan.",
					continuityInstructions:
						"Continue the same pose, shawl, lighting, and temple architecture.",
					transition: "Resolve on the diya flame in the courtyard.",
				},
			],
			planningKey: "composition-plan-test",
		});

		const composition = await t.query(api.studio.getCompositionForRun, {
			runId,
		});
		expect(composition?.status).toBe("planned");
		expect(composition?.clips).toHaveLength(2);
		expect(composition?.clips.map((clip: { clipIndex: number }) => clip.clipIndex)).toEqual([
			0,
			1,
		]);
	});
});

describe("video param validation", () => {
	it("rejects unsupported Veo duration", () => {
		expect(() =>
			validateVideoParams({
				modelId: "google/veo-3.1",
				aspectRatio: "9:16",
				resolution: "720p",
				durationSeconds: 10,
			}),
		).toThrow();
	});

	it("accepts valid Kling configuration", () => {
		const params = validateVideoParams({
			modelId: "kwaivgi/kling-v3.0-std",
			aspectRatio: "9:16",
			resolution: "720p",
			durationSeconds: 5,
			generateAudio: true,
		});
		expect(params.durationSeconds).toBe(5);
	});

	it("rejects audio on Grok", () => {
		expect(() =>
			validateVideoParams({
				modelId: "x-ai/grok-imagine-video-1.5",
				aspectRatio: "9:16",
				resolution: "720p",
				durationSeconds: 5,
				generateAudio: true,
			}),
		).toThrow();
	});

	it("accepts Wan 2.7 and Sora 2 Pro configs", () => {
		expect(
			validateVideoParams({
				modelId: "alibaba/wan-2.7",
				aspectRatio: "9:16",
				resolution: "1080p",
				durationSeconds: 5,
				generateAudio: true,
			}).modelId,
		).toBe("alibaba/wan-2.7");

		expect(
			validateVideoParams({
				modelId: "openai/sora-2-pro",
				aspectRatio: "16:9",
				resolution: "720p",
				durationSeconds: 8,
				generateAudio: true,
			}).durationSeconds,
		).toBe(8);
	});

	it("accepts Grok Imagine Video base model", () => {
		const params = validateVideoParams({
			modelId: "x-ai/grok-imagine-video",
			aspectRatio: "9:16",
			resolution: "720p",
			durationSeconds: 6,
		});
		expect(params.modelId).toBe("x-ai/grok-imagine-video");
	});
});

describe("prompt limits", () => {
	it("truncates Kling prompts over 2500 chars", async () => {
		const { fitPromptToLimit } = await import("./lib/videoAdapters");
		const long = "a".repeat(3000);
		const fitted = fitPromptToLimit(long, 2500);
		expect(fitted.truncated).toBe(true);
		expect(fitted.prompt.length).toBeLessThanOrEqual(2500);
	});

	it("requires at least two composition clips", () => {
		expect(() =>
			compositionPlannerOutputSchema.parse({
				kind: "multi-clip",
				imagePrompt: "A warm stylized temple path with soft dawn light.",
				overallDescription: "A connected devotional walk from dawn to temple prayer.",
				clips: [
					{
						clipIndex: 0,
						globalDescription:
							"A connected devotional walk from dawn to temple prayer.",
						scenePrompt: "A devotee walks toward a temple at dawn.",
						continuityInstructions:
							"Keep the saffron shawl and warm illustrated dawn lighting.",
						transition: "Hold on the temple gate.",
					},
				],
			}),
		).toThrow();
	});
});
