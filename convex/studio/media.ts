import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type DbCtx = QueryCtx | MutationCtx;

export function galleryImageToRef(doc: Doc<"galleryImages">) {
	return {
		id: doc._id,
		objectKey: doc.objectKey,
		meta: doc.meta,
		source: doc.source,
		revisedImagePrompt: doc.revisedImagePrompt,
		timeTakenMs: doc.timeTakenMs,
		createdAt: doc.createdAt,
	};
}

export function galleryVideoToResult(doc: Doc<"galleryVideos">) {
	return {
		id: doc._id,
		objectKey: doc.objectKey,
		meta: doc.meta,
		openRouterJobId: doc.openRouterJobId,
		openRouterGenerationId: doc.openRouterGenerationId,
		actualCostUsd: doc.actualCostUsd,
		timeTakenMs: doc.timeTakenMs,
		videoParams: doc.videoParams,
		videoPrompt: doc.videoPrompt,
		warnings: doc.warnings,
		createdAt: doc.createdAt,
		sourceRunId: doc.sourceRunId,
	};
}

export async function loadImagesByIds(
	ctx: DbCtx,
	ids: Array<Id<"galleryImages"> | undefined | null>,
) {
	const out: ReturnType<typeof galleryImageToRef>[] = [];
	for (const id of ids) {
		if (!id) continue;
		const doc = await ctx.db.get(id);
		if (doc) out.push(galleryImageToRef(doc));
	}
	return out;
}

export async function loadVideosByIds(
	ctx: DbCtx,
	ids: Array<Id<"galleryVideos"> | undefined | null>,
) {
	const out: ReturnType<typeof galleryVideoToResult>[] = [];
	for (const id of ids) {
		if (!id) continue;
		const doc = await ctx.db.get(id);
		if (doc) out.push(galleryVideoToResult(doc));
	}
	return out;
}

export async function findGalleryByObjectKey(ctx: DbCtx, objectKey: string) {
	const image = await ctx.db
		.query("galleryImages")
		.withIndex("by_objectKey", (q) => q.eq("objectKey", objectKey))
		.unique();
	if (image) {
		return { kind: "image" as const, doc: image };
	}
	const video = await ctx.db
		.query("galleryVideos")
		.withIndex("by_objectKey", (q) => q.eq("objectKey", objectKey))
		.unique();
	if (video) {
		return { kind: "video" as const, doc: video };
	}
	return null;
}

export async function listPlansForRunCtx(
	ctx: DbCtx,
	runId: Id<"generationRuns">,
) {
	return await ctx.db
		.query("shlokaPlans")
		.withIndex("by_runId_and_createdAt", (q) => q.eq("runId", runId))
		.order("asc")
		.take(50);
}

/** All plans belonging to a run — used for media ownership scans. */
export async function listAllPlansForRunCtx(
	ctx: DbCtx,
	runId: Id<"generationRuns">,
) {
	return await ctx.db
		.query("shlokaPlans")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.take(200);
}

/**
 * Media owned by a shloka run: its attached/role images plus every video
 * produced by any of its plans.
 */
export async function collectRunMediaIds(
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

export async function imageReferencedOutsideRun(
	ctx: DbCtx,
	imageId: Id<"galleryImages">,
	runId: Id<"generationRuns">,
): Promise<boolean> {
	const runs = await ctx.db.query("generationRuns").collect();
	for (const run of runs) {
		if (run._id === runId) continue;
		if ((run.attachedImageIds ?? []).includes(imageId)) return true;
		if ((run.extraReferenceImageIds ?? []).includes(imageId)) return true;
		if (run.firstFrameImageId === imageId) return true;
		if (run.lastFrameImageId === imageId) return true;
	}
	const modelRuns = await ctx.db.query("modelStudioRuns").collect();
	for (const run of modelRuns) {
		if ((run.attachedImageIds ?? []).includes(imageId)) return true;
		if ((run.extraReferenceImageIds ?? []).includes(imageId)) return true;
		if (run.firstFrameImageId === imageId) return true;
		if (run.lastFrameImageId === imageId) return true;
	}
	return false;
}

/** Same check for a model-studio run owner. */
export async function imageReferencedOutsideModelStudioRun(
	ctx: DbCtx,
	imageId: Id<"galleryImages">,
	runId: Id<"modelStudioRuns">,
): Promise<boolean> {
	const modelRuns = await ctx.db.query("modelStudioRuns").collect();
	for (const run of modelRuns) {
		if (run._id === runId) continue;
		if ((run.attachedImageIds ?? []).includes(imageId)) return true;
		if ((run.extraReferenceImageIds ?? []).includes(imageId)) return true;
		if (run.firstFrameImageId === imageId) return true;
		if (run.lastFrameImageId === imageId) return true;
	}
	const runs = await ctx.db.query("generationRuns").collect();
	for (const run of runs) {
		if ((run.attachedImageIds ?? []).includes(imageId)) return true;
		if ((run.extraReferenceImageIds ?? []).includes(imageId)) return true;
		if (run.firstFrameImageId === imageId) return true;
		if (run.lastFrameImageId === imageId) return true;
	}
	return false;
}

export async function videoReferencedOutsideRun(
	ctx: DbCtx,
	videoId: Id<"galleryVideos">,
	runId: Id<"generationRuns">,
): Promise<boolean> {
	const plans = await ctx.db.query("shlokaPlans").collect();
	for (const plan of plans) {
		if (plan.runId === runId) continue;
		if ((plan.videoOutputIds ?? []).includes(videoId)) return true;
	}
	const modelRuns = await ctx.db.query("modelStudioRuns").collect();
	for (const run of modelRuns) {
		if ((run.videoOutputIds ?? []).includes(videoId)) return true;
	}
	return false;
}

export function uniqueIds<T extends string>(ids: T[]): T[] {
	return [...new Set(ids)];
}

export async function unlinkGalleryImageFromRuns(
	ctx: MutationCtx,
	imageId: Id<"galleryImages">,
) {
	const runs = await ctx.db.query("generationRuns").collect();
	for (const run of runs) {
		const attached = run.attachedImageIds ?? [];
		const extras = run.extraReferenceImageIds ?? [];
		const attachedHit = attached.includes(imageId);
		const extraHit = extras.includes(imageId);
		const firstHit = run.firstFrameImageId === imageId;
		const lastHit = run.lastFrameImageId === imageId;
		if (!attachedHit && !extraHit && !firstHit && !lastHit) {
			continue;
		}
		await ctx.db.patch(run._id, {
			attachedImageIds: attached.filter((id) => id !== imageId),
			extraReferenceImageIds: extras.filter((id) => id !== imageId),
			firstFrameImageId: firstHit ? undefined : run.firstFrameImageId,
			lastFrameImageId: lastHit ? undefined : run.lastFrameImageId,
			updatedAt: Date.now(),
		});
	}

	const modelRuns = await ctx.db.query("modelStudioRuns").collect();
	for (const run of modelRuns) {
		const attached = run.attachedImageIds ?? [];
		const extras = run.extraReferenceImageIds ?? [];
		const attachedHit = attached.includes(imageId);
		const extraHit = extras.includes(imageId);
		const firstHit = run.firstFrameImageId === imageId;
		const lastHit = run.lastFrameImageId === imageId;
		if (!attachedHit && !extraHit && !firstHit && !lastHit) {
			continue;
		}
		await ctx.db.patch(run._id, {
			attachedImageIds: attached.filter((id) => id !== imageId),
			extraReferenceImageIds: extras.filter((id) => id !== imageId),
			firstFrameImageId: firstHit ? undefined : run.firstFrameImageId,
			lastFrameImageId: lastHit ? undefined : run.lastFrameImageId,
			updatedAt: Date.now(),
		});
	}
}

export async function unlinkGalleryVideoFromRuns(
	ctx: MutationCtx,
	videoId: Id<"galleryVideos">,
) {
	const plans = await ctx.db.query("shlokaPlans").collect();
	for (const plan of plans) {
		if (!(plan.videoOutputIds ?? []).includes(videoId)) {
			continue;
		}
		await ctx.db.patch(plan._id, {
			videoOutputIds: (plan.videoOutputIds ?? []).filter(
				(id) => id !== videoId,
			),
			updatedAt: Date.now(),
		});
	}

	const modelRuns = await ctx.db.query("modelStudioRuns").collect();
	for (const run of modelRuns) {
		if (!(run.videoOutputIds ?? []).includes(videoId)) {
			continue;
		}
		await ctx.db.patch(run._id, {
			videoOutputIds: (run.videoOutputIds ?? []).filter(
				(id) => id !== videoId,
			),
			updatedAt: Date.now(),
		});
	}
}
