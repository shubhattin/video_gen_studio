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
			imagePrompt: "Portrait devotional forest scene with soft gold light",
			videoScenes: [
				{
					sceneNumber: 1,
					intent: "Opening",
					subjects: "Forest path",
					locationTime: "Twilight",
					composition: "Centered portrait",
					lensCamera: "Slow push-in",
					lighting: "Soft gold",
					paletteAesthetics: "Warm greens",
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
});

describe("video param validation", () => {
	it("rejects unsupported Veo duration", () => {
		expect(() =>
			validateVideoParams({
				modelId: "google/veo-3.1-generate-001",
				aspectRatio: "9:16",
				resolution: "720p",
				durationSeconds: 10,
			}),
		).toThrow();
	});

	it("accepts valid Kling configuration", () => {
		const params = validateVideoParams({
			modelId: "klingai/kling-v3.0-i2v",
			aspectRatio: "9:16",
			resolution: "1080p",
			durationSeconds: 5,
			klingMode: "pro",
			generateAudio: true,
		});
		expect(params.durationSeconds).toBe(5);
	});
});
