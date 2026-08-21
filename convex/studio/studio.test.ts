import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";
import { defaultVideoParams, validateVideoParams } from "../lib/schemas";
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

const SCENE = {
	sceneNumber: 1,
	intent: "Opening",
	subject: "Temple path",
	action: "Gentle drift",
	scene: "Twilight courtyard",
	style: "Warm marigold and sandalwood, soft gold light",
	camera: "Slow push-in",
	audio: "Quiet ambience",
};

const PLAN_BUDGET = {
	modelId: "bytedance/seedance-2.5",
	aspectRatio: "9:16",
	resolution: "720p",
	durationSeconds: 8,
	maxPromptChars: 4000,
};

async function createRunWithPlan() {
	const t = adminConvex();
	const { runId, planId } = await t.mutation(api.studio.mutations.createShlokaDraft, {
		shlokaText: "धर्मक्षेत्रे कुरुक्षेत्रे",
		customInstructions: "Twilight forest mood",
	});
	return { t, runId, planId };
}

describe("shloka runs and plans", () => {
	it("creates a run with a default Plan 1 draft", async () => {
		const t = adminConvex();
		const { runId, planId } = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "Test shloka",
			customInstructions: "Warm mood",
		});

		const run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.provenance).toBe("shloka");
		expect(run?.status).toBe("draft");
		expect(run?.imageSize).toBe("1024x1536");
		expect(run?.activePlanId).toBe(planId);
		expect(run?.attachedImageIds).toEqual([]);
		expect(run?.images).toEqual([]);

		const plans = await t.query(api.studio.queries.listPlansForRun, { runId });
		expect(plans).toHaveLength(1);
		expect(plans[0]._id).toBe(planId);
		expect(plans[0].attemptNumber).toBe(1);
		expect(plans[0].status).toBe("draft");
		expect(plans[0].videoParams.modelId).toBe("bytedance/seedance-2.5");
		expect(plans[0].videoParams.aspectRatio).toBe("9:16");
		expect(plans[0].imagePrompt).toBeUndefined();
		expect(plans[0].videoScenes).toBeUndefined();
	});

	it("commits plan content with the generation config snapshot", async () => {
		const { t, runId, planId } = await createRunWithPlan();

		await t.mutation(internal.studio.internal.commitPlanContent, {
			planId,
			imagePrompt: "Portrait warm temple courtyard with soft diya glow",
			videoScenes: [SCENE],
			plannerModel: "openai/gpt-5.6-terra",
			plannerReasoning: "medium",
			lastModelParamsUsed: PLAN_BUDGET,
		});

		const run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.status).toBe("plan_ready");
		expect(run?.activePlan?.imagePrompt).toContain("Portrait");
		expect(run?.activePlan?.lastModelParamsUsed?.maxPromptChars).toBe(4000);

		const plan = await t.query(api.studio.queries.getPlan, { runId, planId });
		expect(plan?.status).toBe("ready");
		expect(plan?.videoScenes).toHaveLength(1);
	});

	it("creates additional plans that inherit config and become active", async () => {
		const { t, runId, planId } = await createRunWithPlan();

		await t.mutation(api.studio.mutations.updatePlanConfig, {
			runId,
			planId,
			videoParams: {
				modelId: "kwaivgi/kling-v3.0-pro",
				aspectRatio: "16:9",
				resolution: "720p",
				durationSeconds: 5,
			},
		});

		const secondPlanId = await t.mutation(api.studio.mutations.createPlan, {
			runId,
		});
		expect(secondPlanId).not.toBe(planId);

		const run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.activePlanId).toBe(secondPlanId);

		const plans = await t.query(api.studio.queries.listPlansForRun, { runId });
		expect(plans).toHaveLength(2);
		const second = plans.find(
			(plan: { _id: string }) => plan._id === secondPlanId,
		)!;
		expect(second.attemptNumber).toBe(2);
		// Inherits the active plan's tuned config.
		expect(second.videoParams.modelId).toBe("kwaivgi/kling-v3.0-pro");
		expect(second.status).toBe("draft");
	});

	it("rejects invalid plan configs", async () => {
		const { t, runId, planId } = await createRunWithPlan();
		await expect(
			t.mutation(api.studio.mutations.updatePlanConfig, {
				runId,
				planId,
				videoParams: {
					modelId: "not-a-model",
					aspectRatio: "9:16",
					resolution: "720p",
					durationSeconds: 8,
				},
			}),
		).rejects.toThrow();
	});

	it("edits generated plan content and requires a ready plan", async () => {
		const { t, runId, planId } = await createRunWithPlan();

		await expect(
			t.mutation(api.studio.mutations.updatePlanContent, {
				runId,
				planId,
				imagePrompt: "A warm illustrated temple courtyard at dawn",
			}),
		).rejects.toThrow("Generate the plan");

		await t.mutation(internal.studio.internal.commitPlanContent, {
			planId,
			imagePrompt: "Portrait warm temple courtyard with soft diya glow",
			videoScenes: [SCENE],
			plannerModel: "openai/gpt-5.6-terra",
			plannerReasoning: "medium",
			plannerSystemPrompt: DEFAULT_PLANNER_SYSTEM_PROMPT,
			lastModelParamsUsed: PLAN_BUDGET,
		});

		await t.mutation(api.studio.mutations.updatePlanContent, {
			runId,
			planId,
			imagePrompt: "A dusk temple courtyard with cooler blue light",
			videoScenes: [{ ...SCENE, intent: "Dusk" }],
		});

		const plan = await t.query(api.studio.queries.getPlan, { runId, planId });
		expect(plan?.imagePrompt).toContain("dusk");
		expect(plan?.videoScenes?.[0]?.intent).toBe("Dusk");

		await expect(
			t.mutation(api.studio.mutations.updatePlanContent, {
				runId,
				planId,
				imagePrompt: "short",
			}),
		).rejects.toThrow("at least 20 characters");
	});

	it("selects, renames, and deletes plans with active fallback", async () => {
		const { t, runId, planId } = await createRunWithPlan();
		const secondPlanId = await t.mutation(api.studio.mutations.createPlan, {
			runId,
		});

		await t.mutation(api.studio.mutations.renamePlan, {
			planId: secondPlanId,
			title: "Dawn cut",
		});
		let plans = await t.query(api.studio.queries.listPlansForRun, { runId });
		expect(
			plans.find((plan: { _id: string }) => plan._id === secondPlanId)!.title,
		).toBe("Dawn cut");

		// Switch back to Plan 1.
		await t.mutation(api.studio.mutations.selectPlan, { runId, planId });
		let run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.activePlanId).toBe(planId);

		// Deleting the active plan falls back to the latest remaining.
		await t.mutation(api.studio.mutations.deletePlan, { runId, planId });
		run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.activePlanId).toBe(secondPlanId);

		// Deleting the last remaining plan clears the active pointer.
		await t.mutation(api.studio.mutations.deletePlan, { runId, planId: secondPlanId });
		run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.activePlanId).toBeUndefined();

		plans = await t.query(api.studio.queries.listPlansForRun, { runId });
		expect(plans).toHaveLength(0);
	});

	it("updates run-level draft fields only", async () => {
		const { t, runId } = await createRunWithPlan();
		await t.mutation(api.studio.mutations.updateDraft, {
			runId,
			shlokaText: "Updated shloka",
			customInstructions: "Cooler tones",
			imageSize: "1024x1024",
		});
		const run = await t.query(api.studio.queries.getRun, { runId });
		expect(run?.shlokaText).toBe("Updated shloka");
		expect(run?.customInstructions).toBe("Cooler tones");
		expect(run?.imageSize).toBe("1024x1024");
		// Plan content lives on the plan row, not the run.
		const plans = await t.query(api.studio.queries.listPlansForRun, { runId });
		expect(plans[0]!.imagePrompt).toBeUndefined();
		expect(plans[0]!.videoScenes).toBeUndefined();
	});

	it("deletes a run and its plans", async () => {
		const { t, runId } = await createRunWithPlan();
		await t.mutation(api.studio.mutations.deleteRun, { runId });
		expect(await t.query(api.studio.queries.getRun, { runId })).toBeNull();
		const plans = await t.query(api.studio.queries.listPlansForRun, { runId });
		expect(plans).toHaveLength(0);
	});
});

describe("gallery references and guarded deletes", () => {
	it("lists runs that reference a gallery image", async () => {
		const { t, runId } = await createRunWithPlan();
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
		expect(references[0].kind).toBe("shloka");
	});

	it("keeps gallery media when a run is deleted or an image is removed", async () => {
		const { t, runId } = await createRunWithPlan();
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
		expect(afterUnlink?.images).toEqual([]);
		expect(
			await t.query(internal.studio.queries.objectKeyInGallery, { objectKey }),
		).toBe(true);

		await t.mutation(api.studio.mutations.attachGalleryImageToRun, {
			runId,
			imageId,
		});
		const reattached = await t.query(api.studio.queries.getRun, { runId });
		expect(reattached?.images).toHaveLength(1);

		await t.mutation(api.studio.mutations.deleteRun, { runId });
		expect(await t.query(api.studio.queries.getRun, { runId })).toBeNull();
		expect(
			await t.query(internal.studio.queries.objectKeyInGallery, { objectKey }),
		).toBe(true);
	});

	it("refuses to delete a video connected to a plan or model-studio run", async () => {
		const { t, runId, planId } = await createRunWithPlan();
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
		await t.mutation(internal.studio.internal.appendPlanVideoOutput, {
			planId,
			videoId,
		});

		const connection = await t.query(
			api.studio.queries.getGalleryVideoRunConnection,
			{ videoId },
		);
		expect(connection?.runId).toBe(runId);
		expect(connection?.kind).toBe("shloka");

		await expect(
			t.mutation(api.studio.mutations.deleteGalleryVideo, { videoId }),
		).rejects.toThrow(/still connected to a run/);

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

describe("model studio runs", () => {
	it("creates a direct run and appends video outputs", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.studio.mutations.createModelStudioDraft, {
			modelId: "google/veo-3.1-lite",
			prompt: "Temple courtyard at dusk",
		});

		let run = await t.query(api.studio.queries.getModelStudioRun, { runId });
		expect(run?.prompt).toBe("Temple courtyard at dusk");
		expect(run?.selectedModelId).toBe("google/veo-3.1-lite");
		expect(run?.status).toBe("draft");
		expect(run?.videos).toEqual([]);

		const videoId = await t.mutation(internal.studio.internal.insertGalleryVideo, {
			modelStudioRunId: runId,
			video: {
				objectKey: "studio/gallery/videos/model.mp4",
				meta: { mimeType: "video/mp4" },
				openRouterJobId: "or-model",
				videoParams: defaultVideoParams("google/veo-3.1-lite"),
				createdAt: Date.now(),
			},
		});
		await t.mutation(internal.studio.internal.appendModelStudioVideoOutput, {
			runId,
			videoId,
		});

		run = await t.query(api.studio.queries.getModelStudioRun, { runId });
		expect(run?.videos).toHaveLength(1);
		expect(run?.status).toBe("completed");

		const connection = await t.query(
			api.studio.queries.getGalleryVideoRunConnection,
			{ videoId },
		);
		expect(connection?.kind).toBe("model-studio");
		expect(connection?.runId).toBe(runId);
	});

	it("updates draft fields and rejects edits while generating", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.studio.mutations.createModelStudioDraft, {
			modelId: "bytedance/seedance-2.5",
		});
		await t.mutation(api.studio.mutations.updateModelStudioDraft, {
			runId,
			prompt: "A drifting boat on a lotus lake",
			selectedModelId: "bytedance/seedance-2.5",
		});
		const run = await t.query(api.studio.queries.getModelStudioRun, { runId });
		expect(run?.prompt).toBe("A drifting boat on a lotus lake");

		await t.run(async (ctx) => {
			await ctx.db.patch(runId, { status: "generating" });
		});
		await expect(
			t.mutation(api.studio.mutations.updateModelStudioDraft, {
				runId,
				prompt: "Changed while busy",
			}),
		).rejects.toThrow("busy");
	});

	it("deletes a model-studio run", async () => {
		const t = adminConvex();
		const runId = await t.mutation(api.studio.mutations.createModelStudioDraft, {
			modelId: "bytedance/seedance-2.5",
		});
		await t.mutation(api.studio.mutations.deleteModelStudioRun, { runId });
		expect(await t.query(api.studio.queries.getModelStudioRun, { runId })).toBeNull();
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
		const { runId, planId } = await t.mutation(api.studio.mutations.createShlokaDraft, {
			shlokaText: "No selection yet",
		});
		await expect(
			t.action(api.studio.actions.planShlokaRun, { runId, planId }),
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

		const { runId } = await t.mutation(api.studio.mutations.createShlokaDraft, {
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

	it("clears run selections when a template is deleted", async () => {
		const t = adminConvex();
		const id = await t.mutation(api.studio.mutations.createSystemPromptTemplate, {
			title: "To delete",
		});
		const { runId } = await t.mutation(api.studio.mutations.createShlokaDraft, {
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
});

describe("prompt limits", () => {
	it("truncates Kling prompts over 2500 chars", async () => {
		const { fitPromptToLimit } = await import("../lib/videoAdapters");
		const long = "a".repeat(3000);
		const fitted = fitPromptToLimit(long, 2500);
		expect(fitted.truncated).toBe(true);
		expect(fitted.prompt.length).toBeLessThanOrEqual(2500);
	});
});

describe("studio authorization", () => {
	it("rejects missing and non-admin identities on public queries and mutations", async () => {
		const backend = convexTest(schema, modules);
		const admin = backend.withIdentity(ADMIN_IDENTITY);
		const member = backend.withIdentity(MEMBER_IDENTITY);
		const { runId } = await admin.mutation(api.studio.mutations.createShlokaDraft, {
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
		expect(wiped.runsDeleted).toBeGreaterThan(0);
	});

	it("rejects missing and non-admin identities on cost-bearing and R2 actions", async () => {
		const backend = convexTest(schema, modules);
		const admin = backend.withIdentity(ADMIN_IDENTITY);
		const member = backend.withIdentity(MEMBER_IDENTITY);
		const { runId, planId } = await admin.mutation(
			api.studio.mutations.createShlokaDraft,
			{ shlokaText: "Action auth shloka" },
		);
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
			backend.action(api.studio.actions.planShlokaRun, { runId, planId }),
		).rejects.toThrow("Not authenticated.");
		await expect(
			member.action(api.studio.actions.planShlokaRun, { runId, planId }),
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

	it("requires an admin bearer for the media HTTP fallback", async () => {
		const backend = convexTest(schema, modules);
		const admin = backend.withIdentity(ADMIN_IDENTITY);
		const member = backend.withIdentity(MEMBER_IDENTITY);
		const { runId } = await admin.mutation(api.studio.mutations.createShlokaDraft, {
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
