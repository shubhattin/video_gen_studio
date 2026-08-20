import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type DbCtx = QueryCtx | MutationCtx;

export function asGalleryImageId(
	ctx: DbCtx,
	value: string | undefined | null,
): Id<"galleryImages"> | undefined {
	if (!value) {
		return undefined;
	}
	return ctx.db.normalizeId("galleryImages", value) ?? undefined;
}

export function asGalleryVideoId(
	ctx: DbCtx,
	value: string | undefined | null,
): Id<"galleryVideos"> | undefined {
	if (!value) {
		return undefined;
	}
	return ctx.db.normalizeId("galleryVideos", value) ?? undefined;
}

export function galleryImageToRef(doc: Doc<"galleryImages">) {
	return {
		id: doc._id,
		objectKey: doc.objectKey,
		meta: doc.meta,
		source: doc.source,
		revisedImagePrompt: doc.revisedImagePrompt,
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

export async function listShlokaPlansForRunCtx(
	ctx: DbCtx,
	runId: Id<"generationRuns">,
) {
	return await ctx.db
		.query("shlokaPlans")
		.withIndex("by_runId_and_createdAt", (q) => q.eq("runId", runId))
		.order("desc")
		.take(50);
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

	const clips = await ctx.db.query("compositionClips").collect();
	for (const clip of clips) {
		if (
			clip.terminalFrameImageId !== imageId &&
			clip.referenceImageId !== imageId
		) {
			continue;
		}
		await ctx.db.patch(clip._id, {
			terminalFrameImageId:
				clip.terminalFrameImageId === imageId
					? undefined
					: clip.terminalFrameImageId,
			referenceImageId:
				clip.referenceImageId === imageId ? undefined : clip.referenceImageId,
			updatedAt: Date.now(),
		});
	}
}

export async function unlinkGalleryVideoFromRuns(
	ctx: MutationCtx,
	videoId: Id<"galleryVideos">,
) {
	const runs = await ctx.db.query("generationRuns").collect();
	for (const run of runs) {
		const attached = run.attachedVideoIds ?? [];
		if (!attached.includes(videoId)) {
			continue;
		}
		await ctx.db.patch(run._id, {
			attachedVideoIds: attached.filter((id) => id !== videoId),
			updatedAt: Date.now(),
		});
	}

	const clips = await ctx.db.query("compositionClips").collect();
	for (const clip of clips) {
		if (clip.galleryVideoId !== videoId) {
			continue;
		}
		await ctx.db.patch(clip._id, {
			galleryVideoId: undefined,
			updatedAt: Date.now(),
		});
	}
}
