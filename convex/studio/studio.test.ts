import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";
import {
	compositionPlannerOutputSchema,
	defaultVideoParams,
	validateVideoParams,
} from "../lib/schemas";
import { DEFAULT_PLANNER_SYSTEM_PROMPT } from "../lib/plannerPrompt";

vi.mock("../lib/r2", () => ({
	buildStudioObjectKey: ({
		kind,
		mimeType,
	}: {
		kind: string;
		mimeType: string;
	}) => {
		const ext = mimeType.includes("png")
			? "png"
			: mimeType.includes("jpeg")
				? "jpg"
				: "bin";
		return `studio/gallery/${kind}/test.${ext}`;
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
		const runId = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "धर्मक्षेत्रे कुरुक्षेत्रे",
			customInstructions: "Twilight forest mood",
		});

		const run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.provenance).toBe("shloka");
		expect(run?.status).toBe("draft");
		expect(run?.imageSize).toBe("1024x1536");
		expect(run?.videoParams?.aspectRatio).toBe("9:16");
		expect(run?.attachedImageIds).toEqual([]);
		expect(run?.attachedVideoIds).toEqual([]);
		expect(run?.referenceImages).toEqual([]);
		expect(run?.videos).toEqual([]);
	});

	it("transitions plan commit to plan_ready", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Test shloka",
		});

		await t.mutation(internal.studio.internal.commitPlan, {
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

		const run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.status).toBe("plan_ready");
		expect(run?.imagePrompt).toContain("Portrait");
	});

	it("deletes a run", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Delete me",
		});
		await t.mutation(api.studio.mutations.deleteRun, { runId });
		const run = await t.query(api.studio.queries.getRun, { runId });
		expect(run).toBeNull();
	});

	it("attaches an uploaded reference image via object key", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.studio.mutations.createModelStudioDraft, {
			modelId: "google/veo-3.1-lite",
			prompt: "Temple courtyard at dusk",
		});

		const objectKey = "studio/gallery/images/test.png";
		const imageId = await t.mutation(internal.studio.internal.insertGalleryImage, {
			runId,
			objectKey,
			meta: {
				mimeType: "image/png",
				width: 1024,
				height: 1536,
				bytes: 4,
			},
			source: "uploaded",
		});

		const run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.status).toBe("image_ready");
		expect(run?.firstFrameImageId).toBeUndefined();
		expect(run?.referenceImages).toHaveLength(1);
		expect(run?.referenceImages?.[0]?.source).toBe("uploaded");
		expect(run?.referenceImages?.[0]?.meta.mimeType).toBe("image/png");
		expect(run?.referenceImages?.[0]?.objectKey).toBe(objectKey);
		expect(run?.referenceImages?.[0]?.id).toBe(imageId);

		const belongs = await t.query(
			internal.studio.queries.objectKeyBelongsToRun,
			{ runId, objectKey },
		);
		expect(belongs).toBe(true);
		const inGallery = await t.query(internal.studio.queries.objectKeyInGallery, {
			objectKey,
		});
		expect(inGallery).toBe(true);
		const foreign = await t.query(
			internal.studio.queries.objectKeyBelongsToRun,
			{
				runId,
				objectKey: "studio/gallery/images/other.png",
			},
		);
		expect(foreign).toBe(false);
	});

	it("keeps gallery media when a run is deleted or an image is removed from the run", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Keep media",
		});
		const objectKey = "studio/gallery/images/keep.png";
		const imageId = await t.mutation(internal.studio.internal.insertGalleryImage, {
			runId,
			objectKey,
			meta: { mimeType: "image/png", bytes: 4 },
			source: "uploaded",
		});

		await t.mutation(api.studio.mutations.removeReferenceImage, {
			runId,
			imageId,
		});
		const afterUnlink = await t.query(api.studio.queries.getRun, { runId });
		expect(afterUnlink?.referenceImages).toEqual([]);
		const stillThere = await t.query(internal.studio.queries.objectKeyInGallery, {
			objectKey,
		});
		expect(stillThere).toBe(true);

		await t.mutation(api.studio.mutations.attachGalleryImageToRun, {
			runId,
			imageId,
		});
		const reattached = await t.query(api.studio.queries.getRun, { runId });
		expect(reattached?.referenceImages).toHaveLength(1);

		await t.mutation(api.studio.mutations.deleteRun, { runId });
		expect(await t.query(api.studio.queries.getRun, { runId })).toBeNull();
		expect(
			await t.query(internal.studio.queries.objectKeyInGallery, { objectKey }),
		).toBe(true);
	});

	it("keeps previous shloka plans when planning again", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Multi plan shloka",
		});
		const scene = {
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
		};
		const firstPlanId = await t.mutation(internal.studio.internal.commitPlan, {
			runId,
			plannerModel: "openai/gpt-5.6-terra",
			plannerReasoning: "medium",
			imagePrompt: "Portrait warm temple courtyard with soft diya glow",
			videoScenes: [scene],
			planningKey: "plan-1",
		});
		const secondPlanId = await t.mutation(internal.studio.internal.commitPlan, {
			runId,
			plannerModel: "openai/gpt-5.6-terra",
			plannerReasoning: "medium",
			imagePrompt: "A dusk temple courtyard with cooler blue light",
			videoScenes: [{ ...scene, intent: "Dusk" }],
			planningKey: "plan-2",
		});
		const plans = await t.query(api.studio.queries.listShlokaPlansForRun, {
			runId,
		});
		expect(plans).toHaveLength(2);
		const run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.activePlanId).toBe(secondPlanId);
		expect(run?.imagePrompt).toContain("dusk");

		await t.mutation(api.studio.mutations.selectShlokaPlan, {
			runId,
			planId: firstPlanId,
		});
		const selected = await t.query(api.studio.queries.getRun, { runId });
		expect(selected?.activePlanId).toBe(firstPlanId);
		expect(selected?.imagePrompt).toContain("Portrait");
	});

	it("forks a plan into a new attempt and renames plans", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Fork plan shloka",
		});
		const scene = {
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
		};
		const planId = await t.mutation(internal.studio.internal.commitPlan, {
			runId,
			plannerModel: "openai/gpt-5.6-terra",
			plannerReasoning: "medium",
			imagePrompt: "Warm temple courtyard at dawn",
			videoScenes: [scene],
			planningKey: "plan-1",
		});

		await t.mutation(api.studio.mutations.renameShlokaPlan, {
			planId,
			title: "Dawn cut",
		});
		let plans = await t.query(api.studio.queries.listShlokaPlansForRun, {
			runId,
		});
		expect(plans[0].title).toBe("Dawn cut");

		const forkedId = await t.mutation(api.studio.mutations.forkShlokaPlan, {
			runId,
			planId,
			title: "Forked variant",
		});
		plans = await t.query(api.studio.queries.listShlokaPlansForRun, { runId });
		expect(plans).toHaveLength(2);
		const forked = plans.find((plan) => plan._id === forkedId);
		expect(forked?.attemptNumber).toBe(2);
		expect(forked?.title).toBe("Forked variant");
		expect(forked?.imagePrompt).toContain("Warm temple courtyard");

		const run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.activePlanId).toBe(forkedId);

		const blankForkId = await t.mutation(api.studio.mutations.forkShlokaPlan, {
			runId,
			planId: forkedId,
			title: "",
		});
		plans = await t.query(api.studio.queries.listShlokaPlansForRun, { runId });
		expect(plans).toHaveLength(3);
		const blankFork = plans.find((plan) => plan._id === blankForkId);
		expect(blankFork?.attemptNumber).toBe(3);
		expect(blankFork?.title).toBeUndefined();
	});

	it("persists a bounded composition plan as ordered clip rows", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "वसुदेवसुतं देवं",
		});
		await t.mutation(api.studio.mutations.updateDraft, {
			runId,
			compositionMode: "continuation",
			compositionMultiplier: 2,
			compositionClipCount: 2,
		});
		await t.mutation(internal.studio.internal.commitCompositionPlan, {
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

		const composition = await t.query(api.studio.queries.getCompositionForRun, {
			runId,
		});
		expect(composition?.status).toBe("planned");
		expect(composition?.attemptNumber).toBe(1);
		expect(composition?.clips).toHaveLength(2);
		expect(composition?.clips.map((clip: { clipIndex: number }) => clip.clipIndex)).toEqual([
			0,
			1,
		]);

		const runAfterFirst = await t.query(api.studio.queries.getRun, { runId });
		expect(runAfterFirst?.activeCompositionJobId).toBe(composition?._id);

		await t.mutation(internal.studio.internal.commitCompositionPlan, {
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

		const attempts = await t.query(api.studio.queries.listCompositionJobsForRun, {
			runId,
		});
		expect(attempts).toHaveLength(2);
		expect(attempts.map((job: { attemptNumber: number }) => job.attemptNumber).sort()).toEqual([
			1, 2,
		]);

		const active = await t.query(api.studio.queries.getCompositionForRun, { runId });
		expect(active?.attemptNumber).toBe(2);
		expect(active?.overallDescription).toContain("dusk");

		await t.mutation(api.studio.mutations.selectCompositionJob, {
			runId,
			jobId: composition!._id,
		});
		const selected = await t.query(api.studio.queries.getCompositionForRun, { runId });
		expect(selected?._id).toBe(composition?._id);
		expect(selected?.attemptNumber).toBe(1);
	});
});

describe("system prompt templates", () => {
	it("creates, lists, updates, and deletes templates", async () => {
		const t = adminConvex();
		const id = await t.mutation(api.studio.mutations.createSystemPromptTemplate, {
			title: "Concise devotional",
		});

		let list = await t.query(api.studio.queries.listSystemPromptTemplates, {});
		expect(list).toHaveLength(1);
		expect(list[0]._id).toBe(id);
		expect(list[0].title).toBe("Concise devotional");
		expect(list[0].content).toBe("");

		await t.mutation(api.studio.mutations.updateSystemPromptTemplate, {
			templateId: id,
			title: "Concise",
			content: "You are a concise creative director.",
		});

		list = await t.query(api.studio.queries.listSystemPromptTemplates, {});
		expect(list[0].title).toBe("Concise");
		expect(list[0].content).toBe("You are a concise creative director.");

		const single = await t.query(api.studio.queries.getSystemPromptTemplate, {
			templateId: id,
		});
		expect(single?.title).toBe("Concise");

		await t.mutation(api.studio.mutations.deleteSystemPromptTemplate, {
			templateId: id,
		});
		list = await t.query(api.studio.queries.listSystemPromptTemplates, {});
		expect(list).toHaveLength(0);
		expect(
			await t.query(api.studio.queries.getSystemPromptTemplate, { templateId: id }),
		).toBeNull();
	});

	it("requires a non-empty title and trims it", async () => {
		const t = adminConvex();
		await expect(
			t.mutation(api.studio.mutations.createSystemPromptTemplate, { title: "   " }),
		).rejects.toThrow("Title is required.");
		const id = await t.mutation(api.studio.mutations.createSystemPromptTemplate, {
			title: "  Padded title  ",
		});
		const list = await t.query(api.studio.queries.listSystemPromptTemplates, {});
		expect(list[0].title).toBe("Padded title");
	});

	it("blocks planning without a selected system prompt", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "No selection yet",
		});
		await expect(
			t.action(api.studio.actions.planShlokaRun, { runId }),
		).rejects.toThrow("Select a system prompt template before planning.");
	});

	it("resolves default and template selections to prompt content", async () => {
		const t = adminConvex();
		const resolvedDefault = await t.query(
			internal.studio.queries.resolvePlannerPromptSelectionForRun,
			{ selection: { kind: "default" } },
		);
		expect(resolvedDefault.source).toBe("default");
		expect(resolvedDefault.content).toBe(DEFAULT_PLANNER_SYSTEM_PROMPT);

		const id = await t.mutation(api.studio.mutations.createSystemPromptTemplate, {
			title: "Custom",
		});
		await t.mutation(api.studio.mutations.updateSystemPromptTemplate, {
			templateId: id,
			content: "Custom planner instructions.",
		});

		const resolvedTemplate = await t.query(
			internal.studio.queries.resolvePlannerPromptSelectionForRun,
			{ selection: { kind: "template", templateId: id } },
		);
		expect(resolvedTemplate.source).toBe("template");
		expect(resolvedTemplate.content).toBe("Custom planner instructions.");
		expect(resolvedTemplate.templateId).toBe(id);
	});

	it("throws when a selected template was deleted", async () => {
		const t = adminConvex();
		const id = await t.mutation(api.studio.mutations.createSystemPromptTemplate, {
			title: "Temporary",
		});
		await t.mutation(api.studio.mutations.deleteSystemPromptTemplate, {
			templateId: id,
		});
		await expect(
			t.query(internal.studio.queries.resolvePlannerPromptSelectionForRun, {
				selection: { kind: "template", templateId: id },
			}),
		).rejects.toThrow("no longer exists");
	});

	it("persists planner prompt selection on runs and clears it with null", async () => {
		const t = adminConvex();
		const id = await t.mutation(api.studio.mutations.createSystemPromptTemplate, {
			title: "Draft selection",
		});

		const runId = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Selection run",
			plannerPromptSelection: { kind: "default" },
		});
		let run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.plannerPromptSelection).toEqual({ kind: "default" });

		await t.mutation(api.studio.mutations.updateDraft, {
			runId,
			plannerPromptSelection: { kind: "template", templateId: id },
		});
		run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.plannerPromptSelection).toEqual({
			kind: "template",
			templateId: id,
		});

		await t.mutation(api.studio.mutations.updateDraft, {
			runId,
			plannerPromptSelection: null,
		});
		run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.plannerPromptSelection).toBeUndefined();
	});

	it("commits a snapshot of the resolved prompt content onto the plan", async () => {
		const t = adminConvex();
		const id = await t.mutation(api.studio.mutations.createSystemPromptTemplate, {
			title: "Snapshot source",
		});
		await t.mutation(api.studio.mutations.updateSystemPromptTemplate, {
			templateId: id,
			content: "Snapshot planner content.",
		});

		const runId = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Snapshot run",
			plannerPromptSelection: { kind: "template", templateId: id },
		});
		await t.mutation(internal.studio.internal.commitPlan, {
			runId,
			plannerModel: "openai/gpt-5.6-terra",
			plannerReasoning: "medium",
			imagePrompt: "A warm illustrated temple courtyard",
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
			planningKey: "plan-snapshot",
		});

		const plans = await t.query(api.studio.queries.listShlokaPlansForRun, {
			runId,
		});
		expect(plans[0].plannerSystemPrompt).toBe("Snapshot planner content.");
		expect(plans[0].plannerSystemPromptTemplateId).toBe(id);

		// Editing the template later does NOT change the historical snapshot.
		await t.mutation(api.studio.mutations.updateSystemPromptTemplate, {
			templateId: id,
			content: "Changed later.",
		});
		const plansAfter = await t.query(api.studio.queries.listShlokaPlansForRun, {
			runId,
		});
		expect(plansAfter[0].plannerSystemPrompt).toBe("Snapshot planner content.");
	});

	it("clears run selections when a template is deleted", async () => {
		const t = adminConvex();
		const id = await t.mutation(api.studio.mutations.createSystemPromptTemplate, {
			title: "To delete",
		});
		const runId = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Deletion run",
			plannerPromptSelection: { kind: "template", templateId: id },
		});
		await t.mutation(api.studio.mutations.deleteSystemPromptTemplate, {
			templateId: id,
		});
		const run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.plannerPromptSelection).toBeUndefined();
	});
});

describe("gallery references and guarded deletes", () => {
	it("lists runs that reference a gallery image", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Image reference run",
		});
		const imageId = await t.mutation(internal.studio.internal.insertGalleryImage, {
			runId,
			objectKey: "studio/gallery/images/ref.png",
			meta: { mimeType: "image/png", bytes: 4 },
			source: "generated",
		});
		const references = await t.query(
			api.studio.queries.listRunsReferencingImage,
			{ imageId },
		);
		expect(references).toHaveLength(1);
		expect(references[0].runId).toBe(runId);
		expect(references[0].provenance).toBe("shloka");
	});

	it("refuses to delete a video connected to a run", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Connected video run",
		});
		const videoId = await t.mutation(internal.studio.internal.insertGalleryVideo, {
			runId,
			video: {
				objectKey: "studio/gallery/videos/connected.mp4",
				meta: { mimeType: "video/mp4" },
				openRouterJobId: "or-connected",
				videoParams: defaultVideoParams("bytedance/seedance-2.5"),
				createdAt: Date.now(),
			},
		});

		const connection = await t.query(
			api.studio.queries.getGalleryVideoRunConnection,
			{ videoId },
		);
		expect(connection?.runId).toBe(runId);

		await expect(
			t.mutation(api.studio.mutations.deleteGalleryVideo, { videoId }),
		).rejects.toThrow(/still connected to a run/);

		// Still present after the blocked delete.
		expect(
			await t.query(internal.studio.queries.objectKeyInGallery, {
				objectKey: "studio/gallery/videos/connected.mp4",
			}),
		).toBe(true);
	});

	it("deletes an abandoned video after confirmation", async () => {
		const t = adminConvex();
		const videoId = await t.mutation(internal.studio.internal.insertGalleryVideo, {
			video: {
				objectKey: "studio/gallery/videos/orphan.mp4",
				meta: { mimeType: "video/mp4" },
				openRouterJobId: "or-orphan",
				videoParams: defaultVideoParams("bytedance/seedance-2.5"),
				createdAt: Date.now(),
			},
		});

		const connection = await t.query(
			api.studio.queries.getGalleryVideoRunConnection,
			{ videoId },
		);
		expect(connection).toBeNull();

		await t.mutation(api.studio.mutations.deleteGalleryVideo, { videoId });
		expect(
			await t.query(internal.studio.queries.objectKeyInGallery, {
				objectKey: "studio/gallery/videos/orphan.mp4",
			}),
		).toBe(false);
	});
});

describe("video param validation", () => {
	it("rejects unsupported Veo duration", () => {
		expect(() =>
			validateVideoParams({
				modelId: "google/veo-3.1-lite",
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

	it("rejects audio on Runway (video-only model)", () => {
		expect(() =>
			validateVideoParams({
				modelId: "runway/gen-4.5",
				aspectRatio: "9:16",
				resolution: "720p",
				durationSeconds: 5,
				generateAudio: true,
			}),
		).toThrow();
	});

	it("accepts Wan 2.7 and Seedance 2.5 configs", () => {
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
				modelId: "bytedance/seedance-2.5",
				aspectRatio: "16:9",
				resolution: "720p",
				durationSeconds: 8,
				generateAudio: true,
			}).durationSeconds,
		).toBe(8);
	});

	it("accepts Runway base model", () => {
		const params = validateVideoParams({
			modelId: "runway/gen-4.5",
			aspectRatio: "9:16",
			resolution: "720p",
			durationSeconds: 6,
		});
		expect(params.modelId).toBe("runway/gen-4.5");
	});
});

describe("prompt limits", () => {
	it("truncates Kling prompts over 2500 chars", async () => {
		const { fitPromptToLimit } = await import("../lib/videoAdapters");
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
		const runId = await admin.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Auth gate shloka",
		});

		await expect(backend.query(api.studio.queries.getRun, { runId })).rejects.toThrow(
			"Not authenticated.",
		);
		await expect(member.query(api.studio.queries.getRun, { runId })).rejects.toThrow(
			"Admin access required.",
		);
		const run = await admin.query(api.studio.queries.getRun, { runId });
		expect(run?._id).toBe(runId);

		await expect(
			backend.mutation(api.studio.mutations.wipeAllStudioData, {}),
		).rejects.toThrow("Not authenticated.");
		await expect(
			member.mutation(api.studio.mutations.wipeAllStudioData, {}),
		).rejects.toThrow("Admin access required.");
		const wiped = await admin.mutation(api.studio.mutations.wipeAllStudioData, {});
		expect(wiped.runsDeleted).toBe(1);
	});

	it("rejects missing and non-admin identities on cost-bearing and R2 actions", async () => {
		const backend = convexTest(schema, modules);
		const admin = backend.withIdentity(ADMIN_IDENTITY);
		const member = backend.withIdentity(MEMBER_IDENTITY);
		const runId = await admin.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Action auth shloka",
		});
		const objectKey = "studio/gallery/images/auth.png";
		await admin.mutation(internal.studio.internal.insertGalleryImage, {
			runId,
			objectKey,
			meta: {
				mimeType: "image/png",
				width: 1024,
				height: 1536,
				bytes: 4,
			},
			source: "uploaded",
		});

		await expect(
			backend.action(api.studio.actions.planShlokaRun, { runId }),
		).rejects.toThrow("Not authenticated.");
		await expect(
			member.action(api.studio.actions.planShlokaRun, { runId }),
		).rejects.toThrow("Admin access required.");

		await expect(
			backend.action(api.studio.r2.getReadUrls, {
				runId,
				objectKeys: [objectKey],
			}),
		).rejects.toThrow("Not authenticated.");
		await expect(
			member.action(api.studio.r2.getReadUrls, {
				runId,
				objectKeys: [objectKey],
			}),
		).rejects.toThrow("Admin access required.");

		const urls = await admin.action(api.studio.r2.getReadUrls, {
			runId,
			objectKeys: [objectKey],
		});
		expect(urls[objectKey]).toBe(`https://r2.example/get/${objectKey}`);
	});

	it("keeps internal functions callable without a user identity", async () => {
		const backend = convexTest(schema, modules);
		const admin = backend.withIdentity(ADMIN_IDENTITY);
		const runId = await admin.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Internal still works",
		});
		const objectKey = "studio/gallery/images/internal.png";
		await backend.mutation(internal.studio.internal.insertGalleryImage, {
			runId,
			objectKey,
			meta: {
				mimeType: "image/png",
				width: 64,
				height: 64,
				bytes: 4,
			},
			source: "uploaded",
		});
		const belongs = await backend.query(
			internal.studio.queries.objectKeyBelongsToRun,
			{ runId, objectKey },
		);
		expect(belongs).toBe(true);
	});

	it("requires an admin bearer for the media HTTP fallback", async () => {
		const backend = convexTest(schema, modules);
		const admin = backend.withIdentity(ADMIN_IDENTITY);
		const member = backend.withIdentity(MEMBER_IDENTITY);
		const runId = await admin.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Media proxy auth",
		});
		const objectKey = "studio/gallery/images/media.png";
		await admin.mutation(internal.studio.internal.insertGalleryImage, {
			runId,
			objectKey,
			meta: {
				mimeType: "image/png",
				width: 64,
				height: 64,
				bytes: 4,
			},
			source: "uploaded",
		});

		const mediaPath = `/studio/media?objectKey=${encodeURIComponent(objectKey)}`;
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

describe("legacy studio media migration", () => {
	it("lifts embedded images and videos into the gallery and remaps img_* ids", async () => {
		const t = adminConvex();
		const now = Date.now();
		const runId = await t.run(async (ctx) => {
			return await ctx.db.insert("generationRuns", {
				provenance: "shloka",
				status: "completed",
				shlokaText: "legacy shloka",
				createdAt: now,
				updatedAt: now,
				firstFrameImageId: "img_legacy_first",
				extraReferenceImageIds: ["img_legacy_style"],
				referenceImages: [
					{
						id: "img_legacy_first",
						objectKey: "studio/runs/old/images/first.png",
						meta: { mimeType: "image/png" },
						source: "generated",
						createdAt: now,
					},
					{
						id: "img_legacy_style",
						objectKey: "studio/runs/old/images/style.png",
						meta: { mimeType: "image/png" },
						source: "uploaded",
						createdAt: now,
					},
				],
				videos: [
					{
						id: "vid_legacy_1",
						objectKey: "studio/runs/old/videos/clip.mp4",
						meta: { mimeType: "video/mp4" },
						openRouterJobId: "or-job",
						videoParams: defaultVideoParams("bytedance/seedance-2.5"),
						createdAt: now,
					},
				],
			} as never);
		});

		const migrated = await t.mutation(
			api.studio.mutations.migrateLegacyStudioMedia,
			{},
		);
		expect(migrated.runsMigrated).toBe(1);
		expect(migrated.imagesCreated).toBe(2);
		expect(migrated.videosCreated).toBe(1);

		const run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.referenceImages).toHaveLength(2);
		expect(run?.videos).toHaveLength(1);
		expect(run?.firstFrameImageId).toBe(run?.referenceImages?.[0]?.id);
		expect(run?.extraReferenceImageIds).toEqual([run?.referenceImages?.[1]?.id]);
		expect(run?.referenceImages?.[0]?.objectKey).toBe(
			"studio/runs/old/images/first.png",
		);
		expect(
			await t.query(internal.studio.queries.objectKeyInGallery, {
				objectKey: "studio/runs/old/videos/clip.mp4",
			}),
		).toBe(true);

		const again = await t.mutation(
			api.studio.mutations.migrateLegacyStudioMedia,
			{},
		);
		expect(again.imagesCreated).toBe(0);
		expect(again.videosCreated).toBe(0);
		const after = await t.query(api.studio.queries.getRun, { runId });
		expect(after?.referenceImages).toHaveLength(2);
		expect(after?.firstFrameImageId).toBe(run?.firstFrameImageId);
	});

	it("drops leftover img_* role ids that have no matching media", async () => {
		const t = adminConvex();
		const now = Date.now();
		const runId = await t.run(async (ctx) => {
			return await ctx.db.insert("generationRuns", {
				provenance: "model-studio",
				status: "draft",
				createdAt: now,
				updatedAt: now,
				firstFrameImageId: "img_orphan",
				lastFrameImageId: "img_also_orphan",
			} as never);
		});

		await t.mutation(api.studio.mutations.migrateLegacyStudioMedia, {});
		const run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.firstFrameImageId).toBeUndefined();
		expect(run?.lastFrameImageId).toBeUndefined();
		expect(run?.referenceImages).toEqual([]);
	});
});
