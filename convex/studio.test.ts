import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { validateVideoParams } from "./lib/schemas";

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
});

describe("prompt limits", () => {
	it("truncates Kling prompts over 2500 chars", async () => {
		const { fitPromptToLimit } = await import("./lib/videoAdapters");
		const long = "a".repeat(3000);
		const fitted = fitPromptToLimit(long, 2500);
		expect(fitted.truncated).toBe(true);
		expect(fitted.prompt.length).toBeLessThanOrEqual(2500);
	});
});
