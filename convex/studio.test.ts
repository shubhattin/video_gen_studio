import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import {
	compositionPlannerOutputSchema,
	validateVideoParams,
} from "./lib/schemas";

vi.mock("./lib/r2", () => ({
	buildStudioObjectKey: ({
		runId,
		kind,
		mimeType,
	}: {
		runId: string;
		kind: string;
		mimeType: string;
	}) => {
		const ext = mimeType.includes("png")
			? "png"
			: mimeType.includes("jpeg")
				? "jpg"
				: "bin";
		return `studio/runs/${runId}/${kind}/test.${ext}`;
	},
	createPresignedPutUrl: async ({ objectKey }: { objectKey: string }) =>
		`https://r2.example/put/${objectKey}`,
	createPresignedGetUrl: async ({ objectKey }: { objectKey: string }) =>
		`https://r2.example/get/${objectKey}`,
	headObject: async () => ({
		contentType: "image/png",
		contentLength: 4,
		etag: '"abc"',
	}),
	putObjectBytes: async ({ objectKey }: { objectKey: string }) => objectKey,
	deleteObjects: async () => undefined,
	deleteObject: async () => undefined,
	getR2Client: () => {
		throw new Error("getR2Client should not be called in unit tests");
	},
	getR2ApiOrigin: () => "https://account.r2.cloudflarestorage.com",
}));

const ADMIN_IDENTITY = {
	subject: "admin-user",
	issuer: "https://auth.test",
	role: "admin",
} as const;

const MEMBER_IDENTITY = {
	subject: "member-user",
	issuer: "https://auth.test",
	role: "user",
} as const;

function adminConvex() {
	return convexTest(schema, modules).withIdentity(ADMIN_IDENTITY);
}

describe("studio mutations", () => {
	it("creates a shloka draft with portrait defaults", async () => {
		const t = adminConvex();
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
		const t = adminConvex();
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
		const t = adminConvex();
		const runId = await t.mutation(api.studio.createShlokaDraft, {
			shlokaText: "Delete me",
		});
		await t.mutation(api.studio.deleteRun, { runId });
		const run = await t.query(api.studio.getRun, { runId });
		expect(run).toBeNull();
	});

	it("attaches an uploaded reference image via object key", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.studio.createModelStudioDraft, {
			modelId: "google/veo-3.1-lite",
			prompt: "Temple courtyard at dusk",
		});

		const objectKey = `studio/runs/${runId}/refs/test.png`;
		await t.mutation(internal.studioInternal.appendReferenceImage, {
			runId,
			image: {
				id: "img_test",
				objectKey,
				meta: {
					mimeType: "image/png",
					width: 1024,
					height: 1536,
					bytes: 4,
				},
				source: "uploaded",
				createdAt: Date.now(),
			},
		});

		const run = await t.query(api.studio.getRun, { runId });
		expect(run?.status).toBe("image_ready");
		expect(run?.firstFrameImageId).toBeUndefined();
		expect(run?.referenceImages).toHaveLength(1);
		expect(run?.referenceImages?.[0]?.source).toBe("uploaded");
		expect(run?.referenceImages?.[0]?.meta.mimeType).toBe("image/png");
		expect(run?.referenceImages?.[0]?.objectKey).toBe(objectKey);
		expect(run?.referenceImages?.[0]?.id).toBe("img_test");

		const belongs = await t.query(
			internal.studioQueries.objectKeyBelongsToRun,
			{ runId, objectKey },
		);
		expect(belongs).toBe(true);
		const foreign = await t.query(
			internal.studioQueries.objectKeyBelongsToRun,
			{
				runId,
				objectKey: "studio/runs/other/refs/x.png",
			},
		);
		expect(foreign).toBe(false);
	});

	it("persists a bounded composition plan as ordered clip rows", async () => {
		const t = adminConvex();
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
		expect(composition?.attemptNumber).toBe(1);
		expect(composition?.clips).toHaveLength(2);
		expect(composition?.clips.map((clip: { clipIndex: number }) => clip.clipIndex)).toEqual([
			0,
			1,
		]);

		const runAfterFirst = await t.query(api.studio.getRun, { runId });
		expect(runAfterFirst?.activeCompositionJobId).toBe(composition?._id);

		await t.mutation(internal.studioInternal.commitCompositionPlan, {
			runId,
			plannerModel: "openai/gpt-5.6-terra",
			plannerReasoning: "high",
			imagePrompt: "A second illustrated temple path at dusk",
			overallDescription: "A dusk revisit of the same temple walk.",
			clips: [
				{
					clipIndex: 0,
					globalDescription: "A dusk revisit of the same temple walk.",
					scenePrompt: "Dusk approach to the temple with cooler light.",
					continuityInstructions: "Keep the same devotee and shawl.",
					transition: "End at the gate under blue hour sky.",
				},
				{
					clipIndex: 1,
					globalDescription: "A dusk revisit of the same temple walk.",
					scenePrompt: "Continue into the courtyard at dusk.",
					continuityInstructions: "Preserve pose, shawl, and architecture.",
					transition: "Resolve on the diya flame.",
				},
			],
			planningKey: "composition-plan-test-2",
		});

		const attempts = await t.query(api.studio.listCompositionJobsForRun, {
			runId,
		});
		expect(attempts).toHaveLength(2);
		expect(attempts.map((job: { attemptNumber: number }) => job.attemptNumber).sort()).toEqual([
			1, 2,
		]);

		const active = await t.query(api.studio.getCompositionForRun, { runId });
		expect(active?.attemptNumber).toBe(2);
		expect(active?.overallDescription).toContain("dusk");

		await t.mutation(api.studio.selectCompositionJob, {
			runId,
			jobId: composition!._id,
		});
		const selected = await t.query(api.studio.getCompositionForRun, { runId });
		expect(selected?._id).toBe(composition?._id);
		expect(selected?.attemptNumber).toBe(1);
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

describe("studio authorization", () => {
	it("rejects missing and non-admin identities on public queries and mutations", async () => {
		const backend = convexTest(schema, modules);
		const admin = backend.withIdentity(ADMIN_IDENTITY);
		const member = backend.withIdentity(MEMBER_IDENTITY);
		const runId = await admin.mutation(api.studio.createShlokaDraft, {
			shlokaText: "Auth gate shloka",
		});

		await expect(backend.query(api.studio.getRun, { runId })).rejects.toThrow(
			"Not authenticated.",
		);
		await expect(member.query(api.studio.getRun, { runId })).rejects.toThrow(
			"Admin access required.",
		);
		const run = await admin.query(api.studio.getRun, { runId });
		expect(run?._id).toBe(runId);

		await expect(
			backend.mutation(api.studio.wipeAllStudioData, {}),
		).rejects.toThrow("Not authenticated.");
		await expect(
			member.mutation(api.studio.wipeAllStudioData, {}),
		).rejects.toThrow("Admin access required.");
		const wiped = await admin.mutation(api.studio.wipeAllStudioData, {});
		expect(wiped.runsDeleted).toBe(1);
	});

	it("rejects missing and non-admin identities on cost-bearing and R2 actions", async () => {
		const backend = convexTest(schema, modules);
		const admin = backend.withIdentity(ADMIN_IDENTITY);
		const member = backend.withIdentity(MEMBER_IDENTITY);
		const runId = await admin.mutation(api.studio.createShlokaDraft, {
			shlokaText: "Action auth shloka",
		});
		const objectKey = `studio/runs/${runId}/refs/test.png`;
		await admin.mutation(internal.studioInternal.appendReferenceImage, {
			runId,
			image: {
				id: "img_auth",
				objectKey,
				meta: {
					mimeType: "image/png",
					width: 1024,
					height: 1536,
					bytes: 4,
				},
				source: "uploaded",
				createdAt: Date.now(),
			},
		});

		await expect(
			backend.action(api.studioActions.planShlokaRun, { runId }),
		).rejects.toThrow("Not authenticated.");
		await expect(
			member.action(api.studioActions.planShlokaRun, { runId }),
		).rejects.toThrow("Admin access required.");

		await expect(
			backend.action(api.studioR2.getReadUrls, {
				runId,
				objectKeys: [objectKey],
			}),
		).rejects.toThrow("Not authenticated.");
		await expect(
			member.action(api.studioR2.getReadUrls, {
				runId,
				objectKeys: [objectKey],
			}),
		).rejects.toThrow("Admin access required.");

		const urls = await admin.action(api.studioR2.getReadUrls, {
			runId,
			objectKeys: [objectKey],
		});
		expect(urls[objectKey]).toBe(`https://r2.example/get/${objectKey}`);
	});

	it("keeps internal functions callable without a user identity", async () => {
		const backend = convexTest(schema, modules);
		const admin = backend.withIdentity(ADMIN_IDENTITY);
		const runId = await admin.mutation(api.studio.createShlokaDraft, {
			shlokaText: "Internal still works",
		});
		const objectKey = `studio/runs/${runId}/refs/test.png`;
		await backend.mutation(internal.studioInternal.appendReferenceImage, {
			runId,
			image: {
				id: "img_internal",
				objectKey,
				meta: {
					mimeType: "image/png",
					width: 64,
					height: 64,
					bytes: 4,
				},
				source: "uploaded",
				createdAt: Date.now(),
			},
		});
		const belongs = await backend.query(
			internal.studioQueries.objectKeyBelongsToRun,
			{ runId, objectKey },
		);
		expect(belongs).toBe(true);
	});

	it("requires an admin bearer for the media HTTP fallback", async () => {
		const backend = convexTest(schema, modules);
		const admin = backend.withIdentity(ADMIN_IDENTITY);
		const member = backend.withIdentity(MEMBER_IDENTITY);
		const runId = await admin.mutation(api.studio.createShlokaDraft, {
			shlokaText: "Media proxy auth",
		});
		const objectKey = `studio/runs/${runId}/refs/test.png`;
		await admin.mutation(internal.studioInternal.appendReferenceImage, {
			runId,
			image: {
				id: "img_media",
				objectKey,
				meta: {
					mimeType: "image/png",
					width: 64,
					height: 64,
					bytes: 4,
				},
				source: "uploaded",
				createdAt: Date.now(),
			},
		});

		const mediaPath = `/studio/media?runId=${runId}&objectKey=${encodeURIComponent(objectKey)}`;
		const missing = await backend.fetch(mediaPath);
		expect(missing.status).toBe(401);
		expect(await missing.text()).toBe("Not authenticated.");

		const forbidden = await member.fetch(mediaPath);
		expect(forbidden.status).toBe(403);
		expect(await forbidden.text()).toBe("Admin access required.");

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith("https://r2.example/")) {
				return new Response("fake-bytes", {
					status: 200,
					headers: {
						"Content-Type": "image/png",
						"Content-Length": "10",
					},
				});
			}
			return originalFetch(input, init);
		}) as typeof fetch;
		try {
			const allowed = await admin.fetch(mediaPath);
			expect(allowed.status).toBe(200);
			expect(await allowed.text()).toBe("fake-bytes");
			expect(allowed.headers.get("Content-Type")).toBe("image/png");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
