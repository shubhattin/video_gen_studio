import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
	internalQuery,
	query,
	type MutationCtx,
	type QueryCtx,
} from "../_generated/server";
import { requireAdmin } from "../lib/auth";
import {
	MODEL_CAPABILITY_PROFILES,
	VIDEO_MODEL_IDS,
} from "../lib/modelCatalog";
import {
	DEFAULT_PLANNER_SYSTEM_PROMPT,
	type PlannerPromptSelection,
} from "../lib/plannerPrompt";
import { normalizeVideoScenes } from "../lib/videoPlanMarkdown";
import { plannerPromptSelectionValidator } from "../schema";
import {
	findGalleryByObjectKey,
	galleryVideoToResult,
	imageReferencedOutsideRun,
	listAllPlansForRunCtx,
	listPlansForRunCtx,
	loadImagesByIds,
	loadVideosByIds,
	videoReferencedOutsideRun,
} from "./media";

type DbCtx = QueryCtx | MutationCtx;

/** Hydrate a plan for clients: normalized scenes + resolved output videos. */
export async function hydratePlan(
	ctx: QueryCtx,
	plan: Doc<"shlokaPlans">,
): Promise<Doc<"shlokaPlans"> & { videos: ReturnType<typeof galleryVideoToResult>[] }> {
	const videos = await loadVideosByIds(ctx, plan.videoOutputIds ?? []);
	return {
		...plan,
		videoScenes: plan.videoScenes
			? normalizeVideoScenes(plan.videoScenes)
			: plan.videoScenes,
		videos,
	};
}

/**
 * Resolve a run for clients: gallery-derived images (roles included) plus the
 * active shloka plan. Videos are plan-scoped and hydrate with each plan.
 */
async function hydrateRun(ctx: QueryCtx, run: Doc<"generationRuns">) {
	const firstFrameImageId = run.firstFrameImageId;
	const lastFrameImageId = run.lastFrameImageId;
	const extraReferenceImageIds = run.extraReferenceImageIds ?? [];
	const imageIds = [
		...(run.attachedImageIds ?? []),
		firstFrameImageId,
		lastFrameImageId,
		...extraReferenceImageIds,
	].filter((id): id is Id<"galleryImages"> => Boolean(id));
	const uniqueImageIds = [...new Set(imageIds)];
	const [images, activePlan] = await Promise.all([
		loadImagesByIds(ctx, uniqueImageIds),
		run.activePlanId ? ctx.db.get(run.activePlanId) : null,
	]);
	return {
		...run,
		images,
		activePlan: activePlan
			? {
					...activePlan,
					videoScenes: activePlan.videoScenes
						? normalizeVideoScenes(activePlan.videoScenes)
						: activePlan.videoScenes,
				}
			: null,
	};
}

export const getRun = query({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return null;
		}
		return await hydrateRun(ctx, run);
	},
});

export const getRunDoc = internalQuery({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return null;
		}
		return await hydrateRun(ctx, run);
	},
});

export const getPlan = query({
	args: {
		runId: v.id("generationRuns"),
		planId: v.id("shlokaPlans"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const plan = await ctx.db.get(args.planId);
		if (!plan || plan.runId !== args.runId) {
			return null;
		}
		return await hydratePlan(ctx, plan);
	},
});

export const getPlanDoc = internalQuery({
	args: {
		planId: v.id("shlokaPlans"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		return await ctx.db.get(args.planId);
	},
});

export const listPlansForRun = query({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const plans = await listPlansForRunCtx(ctx, args.runId);
		return await Promise.all(plans.map((plan) => hydratePlan(ctx, plan)));
	},
});

async function countShlokaRunVideos(
	ctx: QueryCtx,
	runId: Id<"generationRuns">,
): Promise<number> {
	const plans = await ctx.db
		.query("shlokaPlans")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.take(50);
	let count = 0;
	for (const plan of plans) {
		count += plan.videoOutputIds?.length ?? 0;
	}
	return count;
}

export const listRecentRuns = query({
	args: {
		limit: v.optional(v.number()),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const limit = Math.min(args.limit ?? 20, 50);
		const runs = await ctx.db
			.query("generationRuns")
			.withIndex("by_createdAt")
			.order("desc")
			.take(limit);
		return await Promise.all(
			runs.map(async (run) => ({
				_id: run._id,
				kind: "shloka" as const,
				status: run.status,
				title: run.title,
				shlokaText: run.shlokaText,
				createdAt: run.createdAt,
				videoCount: await countShlokaRunVideos(ctx, run._id),
			})),
		);
	},
});

/**
 * Unified sidebar feed: shloka runs + model-studio runs merged into one
 * newest-first list. One stable query for the history panel so both sources
 * always render together.
 */
export const listRecentActivity = query({
	args: {
		limit: v.optional(v.number()),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const limit = Math.min(args.limit ?? 24, 50);
		const [shlokaRuns, modelRuns] = await Promise.all([
			ctx.db
				.query("generationRuns")
				.withIndex("by_createdAt")
				.order("desc")
				.take(limit),
			ctx.db
				.query("modelStudioRuns")
				.withIndex("by_createdAt")
				.order("desc")
				.take(limit),
		]);

		const items: Array<{
			_id: Id<"generationRuns"> | Id<"modelStudioRuns">;
			kind: "shloka" | "model-studio";
			status: string;
			title?: string;
			subtitle?: string;
			selectedModelId?: string;
			createdAt: number;
			videoCount: number;
		}> = [];

		for (const run of shlokaRuns) {
			items.push({
				_id: run._id,
				kind: "shloka",
				status: run.status,
				title: run.title,
				subtitle: run.shlokaText?.slice(0, 80),
				createdAt: run.createdAt,
				videoCount: await countShlokaRunVideos(ctx, run._id),
			});
		}
		for (const run of modelRuns) {
			items.push({
				_id: run._id,
				kind: "model-studio",
				status: run.status,
				title: run.title,
				subtitle: run.prompt?.slice(0, 80),
				selectedModelId: run.selectedModelId,
				createdAt: run.createdAt,
				videoCount: run.videoOutputIds?.length ?? 0,
			});
		}

		items.sort((a, b) => b.createdAt - a.createdAt);
		return items.slice(0, limit);
	},
});

export const getModelStudioRun = query({
	args: {
		runId: v.id("modelStudioRuns"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return null;
		}
		const imageIds = [
			...(run.attachedImageIds ?? []),
			run.firstFrameImageId,
			run.lastFrameImageId,
			...(run.extraReferenceImageIds ?? []),
		].filter((id): id is Id<"galleryImages"> => Boolean(id));
		const [images, videos] = await Promise.all([
			loadImagesByIds(ctx, [...new Set(imageIds)]),
			loadVideosByIds(ctx, run.videoOutputIds ?? []),
		]);
		return { ...run, images, videos };
	},
});

export const getModelStudioRunDoc = internalQuery({
	args: {
		runId: v.id("modelStudioRuns"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		return await ctx.db.get(args.runId);
	},
});

/** Internal: hydrated image refs (id + objectKey) for a model-studio run. */
export const listModelStudioRunImages = internalQuery({
	args: {
		runId: v.id("modelStudioRuns"),
	},
	returns: v.array(
		v.object({
			id: v.id("galleryImages"),
			objectKey: v.string(),
		}),
	),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return [];
		}
		const ids = [
			...(run.attachedImageIds ?? []),
			run.firstFrameImageId,
			run.lastFrameImageId,
			...(run.extraReferenceImageIds ?? []),
		].filter((id): id is Id<"galleryImages"> => Boolean(id));
		const out: Array<{ id: Id<"galleryImages">; objectKey: string }> = [];
		for (const id of [...new Set(ids)]) {
			const doc = await ctx.db.get(id);
			if (doc) {
				out.push({ id: doc._id, objectKey: doc.objectKey });
			}
		}
		return out;
	},
});

// ── System prompt templates ─────────────────────────────────────────────

export async function listSystemPromptTemplatesCtx(ctx: DbCtx) {
	return await ctx.db.query("systemPromptTemplates").order("desc").take(200);
}

/**
 * Resolve the actual planner prompt text for a run selection. Absent or
 * "default" selections resolve to the built-in default prompt; template
 * selections resolve to the template body (throws if the template is gone).
 */
export async function resolvePlannerPromptSnapshot(
	ctx: DbCtx,
	selection: PlannerPromptSelection | undefined,
): Promise<{ content: string; templateId?: Id<"systemPromptTemplates"> }> {
	if (!selection || selection.kind === "default") {
		return { content: DEFAULT_PLANNER_SYSTEM_PROMPT };
	}
	const template = await ctx.db.get(
		"systemPromptTemplates",
		selection.templateId,
	);
	if (!template) {
		throw new Error("The selected system prompt template no longer exists.");
	}
	return { content: template.content, templateId: template._id };
}

export const listSystemPromptTemplates = query({
	args: {},
	returns: v.array(v.any()),
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const templates = await listSystemPromptTemplatesCtx(ctx);
		return templates.map((template) => ({
			_id: template._id,
			title: template.title,
			content: template.content,
			updatedAt: template.updatedAt,
			createdAt: template._creationTime,
		}));
	},
});

export const getSystemPromptTemplate = query({
	args: {
		templateId: v.id("systemPromptTemplates"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const template = await ctx.db.get(args.templateId);
		if (!template) {
			return null;
		}
		return {
			_id: template._id,
			title: template.title,
			content: template.content,
			updatedAt: template.updatedAt,
			createdAt: template._creationTime,
		};
	},
});

/** Internal: resolve a selection to prompt text inside an action runtime. */
export const resolvePlannerPromptSelectionForRun = internalQuery({
	args: {
		selection: v.optional(plannerPromptSelectionValidator),
	},
	returns: v.union(
		v.object({ source: v.literal("default"), content: v.string() }),
		v.object({
			source: v.literal("template"),
			content: v.string(),
			templateId: v.id("systemPromptTemplates"),
		}),
	),
	handler: async (ctx, args) => {
		const resolved = await resolvePlannerPromptSnapshot(ctx, args.selection);
		if (resolved.templateId) {
			return {
				source: "template" as const,
				content: resolved.content,
				templateId: resolved.templateId,
			};
		}
		return { source: "default" as const, content: resolved.content };
	},
});

// ── Gallery ─────────────────────────────────────────────────────────────

export const listGalleryImages = query({
	args: {
		limit: v.optional(v.number()),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const limit = Math.min(args.limit ?? 80, 200);
		const docs = await ctx.db
			.query("galleryImages")
			.withIndex("by_createdAt")
			.order("desc")
			.take(limit);
		return docs.map((doc) => ({
			id: doc._id,
			objectKey: doc.objectKey,
			meta: doc.meta,
			source: doc.source,
			revisedImagePrompt: doc.revisedImagePrompt,
			createdAt: doc.createdAt,
		}));
	},
});

export const listGalleryVideos = query({
	args: {
		limit: v.optional(v.number()),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const limit = Math.min(args.limit ?? 80, 200);
		const docs = await ctx.db
			.query("galleryVideos")
			.withIndex("by_createdAt")
			.order("desc")
			.take(limit);
		return docs.map((doc) => galleryVideoToResult(doc));
	},
});

/**
 * Resolve the single owner of a gallery video (if any): a shloka plan that
 * produced it, or a model-studio run that produced it. Videos are linked only
 * through `videoOutputIds` — deleting a plan abandons its videos (no
 * sourceRunId fallback, so they become individually deletable).
 */
export async function resolveGalleryVideoRunConnection(
	ctx: DbCtx,
	videoId: Id<"galleryVideos">,
): Promise<{
	runId: Id<"generationRuns"> | Id<"modelStudioRuns">;
	kind: "shloka" | "model-studio";
	title?: string;
	status: string;
} | null> {
	const plans = await ctx.db.query("shlokaPlans").collect();
	const plan = plans.find((item) =>
		(item.videoOutputIds ?? []).includes(videoId),
	);
	if (plan) {
		const run = await ctx.db.get(plan.runId);
		if (run) {
			return {
				runId: run._id,
				kind: "shloka",
				title: run.title,
				status: run.status,
			};
		}
	}
	const modelRuns = await ctx.db.query("modelStudioRuns").collect();
	const modelRun = modelRuns.find((item) =>
		(item.videoOutputIds ?? []).includes(videoId),
	);
	if (modelRun) {
		return {
			runId: modelRun._id,
			kind: "model-studio",
			title: modelRun.title,
			status: modelRun.status,
		};
	}
	return null;
}

export const getGalleryVideoRunConnection = query({
	args: {
		videoId: v.id("galleryVideos"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		return await resolveGalleryVideoRunConnection(ctx, args.videoId);
	},
});

/** Runs that reference a gallery image (attached, role). */
export const listRunsReferencingImage = query({
	args: {
		imageId: v.id("galleryImages"),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const imageId = args.imageId;
		const results: Array<{
			runId: Id<"generationRuns"> | Id<"modelStudioRuns">;
			kind: "shloka" | "model-studio";
			title?: string;
			status: string;
		}> = [];
		const runs = await ctx.db.query("generationRuns").collect();
		for (const run of runs) {
			if (
				(run.attachedImageIds ?? []).includes(imageId) ||
				run.firstFrameImageId === imageId ||
				run.lastFrameImageId === imageId ||
				(run.extraReferenceImageIds ?? []).includes(imageId)
			) {
				results.push({
					runId: run._id,
					kind: "shloka",
					title: run.title,
					status: run.status,
				});
			}
		}
		const modelRuns = await ctx.db.query("modelStudioRuns").collect();
		for (const run of modelRuns) {
			if (
				(run.attachedImageIds ?? []).includes(imageId) ||
				run.firstFrameImageId === imageId ||
				run.lastFrameImageId === imageId ||
				(run.extraReferenceImageIds ?? []).includes(imageId)
			) {
				results.push({
					runId: run._id,
					kind: "model-studio",
					title: run.title,
					status: run.status,
				});
			}
		}
		return results;
	},
});

export const getRunMediaCounts = query({
	args: {
		runId: v.id("generationRuns"),
	},
	returns: v.object({
		images: v.number(),
		videos: v.number(),
	}),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return { images: 0, videos: 0 };
		}
		const plans = await listAllPlansForRunCtx(ctx, args.runId);
		const { images, videos } = await collectRunMediaIdsLocal(run, plans);

		const allVideos = await ctx.db.query("galleryVideos").collect();
		for (const video of allVideos) {
			if (video.sourceRunId === args.runId) {
				videos.add(video._id);
			}
		}

		let imageCount = 0;
		for (const imageId of images) {
			if (await imageReferencedOutsideRun(ctx, imageId, args.runId)) {
				continue;
			}
			imageCount += 1;
		}
		let videoCount = 0;
		for (const videoId of videos) {
			if (await videoReferencedOutsideRun(ctx, videoId, args.runId)) {
				continue;
			}
			videoCount += 1;
		}
		return { images: imageCount, videos: videoCount };
	},
});

function collectRunMediaIdsLocal(
	run: Doc<"generationRuns">,
	plans: Array<Doc<"shlokaPlans">>,
) {
	const images = new Set<Id<"galleryImages">>();
	const videos = new Set<Id<"galleryVideos">>();
	for (const id of run.attachedImageIds ?? []) {
		images.add(id);
	}
	for (const id of [run.firstFrameImageId, run.lastFrameImageId]) {
		if (id) images.add(id);
	}
	for (const id of run.extraReferenceImageIds ?? []) {
		images.add(id);
	}
	for (const plan of plans) {
		for (const id of plan.videoOutputIds ?? []) {
			videos.add(id);
		}
	}
	return { images, videos };
}

export const getStaticModelCatalog = query({
	args: {},
	returns: v.any(),
	handler: async (ctx) => {
		await requireAdmin(ctx);
		return {
			modelIds: VIDEO_MODEL_IDS,
			profiles: MODEL_CAPABILITY_PROFILES,
		};
	},
});

export const getCachedOpenRouterCatalog = query({
	args: {},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const cached = await ctx.db.query("catalogCache").first();
		if (!cached) {
			return null;
		}
		try {
			return {
				fetchedAt: cached.fetchedAt,
				models: JSON.parse(cached.payload),
			};
		} catch {
			return null;
		}
	},
});

export const objectKeyInGallery = internalQuery({
	args: {
		objectKey: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const found = await findGalleryByObjectKey(ctx, args.objectKey);
		return found !== null;
	},
});
