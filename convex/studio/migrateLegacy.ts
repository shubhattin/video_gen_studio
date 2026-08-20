import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
} from "../_generated/server";
import {
	asGalleryImageId,
	asGalleryVideoId,
	findGalleryByObjectKey,
	uniqueIds,
} from "./media";

type LegacyImage = NonNullable<Doc<"generationRuns">["referenceImages"]>[number];
type LegacyVideo = NonNullable<Doc<"generationRuns">["videos"]>[number];

function definedFields<T extends Record<string, unknown>>(fields: T) {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fields)) {
		if (value !== undefined) {
			out[key] = value;
		}
	}
	return out as T;
}

export function leftoverObjectKeys(
	doc: Doc<"generationRuns"> | Doc<"compositionClips">,
): string[] {
	const keys: string[] = [];
	if ("referenceImages" in doc) {
		for (const image of doc.referenceImages ?? []) {
			keys.push(image.objectKey);
		}
		for (const video of doc.videos ?? []) {
			keys.push(video.objectKey);
		}
	}
	if ("video" in doc && doc.video) {
		keys.push(doc.video.objectKey);
	}
	if ("terminalFrameObjectKey" in doc && doc.terminalFrameObjectKey) {
		keys.push(doc.terminalFrameObjectKey);
	}
	return keys;
}

async function ensureGalleryImage(
	ctx: MutationCtx,
	image: Pick<
		LegacyImage,
		"objectKey" | "meta" | "source" | "revisedImagePrompt" | "createdAt"
	>,
): Promise<Id<"galleryImages">> {
	const existing = await findGalleryByObjectKey(ctx, image.objectKey);
	if (existing?.kind === "image") {
		return existing.doc._id;
	}
	const source =
		image.source === "generated" ||
		image.source === "uploaded" ||
		image.source === "terminal_frame"
			? image.source
			: "uploaded";
	return await ctx.db.insert("galleryImages", {
		objectKey: image.objectKey,
		meta: image.meta,
		source,
		revisedImagePrompt: image.revisedImagePrompt,
		createdAt: image.createdAt,
	});
}

async function ensureGalleryVideo(
	ctx: MutationCtx,
	video: LegacyVideo,
	sourceRunId?: Id<"generationRuns">,
): Promise<Id<"galleryVideos">> {
	const existing = await findGalleryByObjectKey(ctx, video.objectKey);
	if (existing?.kind === "video") {
		return existing.doc._id;
	}
	return await ctx.db.insert("galleryVideos", {
		objectKey: video.objectKey,
		meta: video.meta,
		openRouterJobId: video.openRouterJobId,
		openRouterGenerationId: video.openRouterGenerationId,
		actualCostUsd: video.actualCostUsd,
		videoParams: video.videoParams,
		videoPrompt: video.videoPrompt,
		warnings: video.warnings,
		sourceRunId,
		createdAt: video.createdAt,
	});
}

function remapImageId(
	ctx: MutationCtx,
	legacyId: string | undefined,
	oldToNew: Map<string, Id<"galleryImages">>,
): Id<"galleryImages"> | undefined {
	if (!legacyId) {
		return undefined;
	}
	return asGalleryImageId(ctx, legacyId) ?? oldToNew.get(legacyId);
}

export const migrateLegacyStudioMedia = internalMutation({
	args: {},
	returns: v.object({
		runsMigrated: v.number(),
		clipsMigrated: v.number(),
		imagesCreated: v.number(),
		videosCreated: v.number(),
	}),
	handler: async (ctx) => {
		let imagesCreated = 0;
		let videosCreated = 0;
		let runsMigrated = 0;
		let clipsMigrated = 0;

		const globalImageMap = new Map<string, Id<"galleryImages">>();
		const runs = await ctx.db.query("generationRuns").collect();
		for (const run of runs) {
			const imageMap = new Map<string, Id<"galleryImages">>();

			for (const image of run.referenceImages ?? []) {
				const before = await findGalleryByObjectKey(ctx, image.objectKey);
				const imageId = await ensureGalleryImage(ctx, image);
				if (before?.kind !== "image") {
					imagesCreated += 1;
				}
				imageMap.set(image.id, imageId);
				globalImageMap.set(image.id, imageId);
			}

			const attachedImageIds = uniqueIds([
				...(run.attachedImageIds ?? []).flatMap((id) => {
					const ok = asGalleryImageId(ctx, id);
					return ok ? [ok] : [];
				}),
				...imageMap.values(),
			]);

			const videoMap = new Map<string, Id<"galleryVideos">>();
			for (const video of run.videos ?? []) {
				const before = await findGalleryByObjectKey(ctx, video.objectKey);
				const videoId = await ensureGalleryVideo(ctx, video, run._id);
				if (before?.kind !== "video") {
					videosCreated += 1;
				}
				videoMap.set(video.id, videoId);
			}

			const attachedVideoIds = uniqueIds([
				...(run.attachedVideoIds ?? []).flatMap((id) => {
					const ok = asGalleryVideoId(ctx, id);
					return ok ? [ok] : [];
				}),
				...videoMap.values(),
			]);

			const firstFrameImageId = remapImageId(
				ctx,
				run.firstFrameImageId,
				imageMap,
			);
			const lastFrameImageId = remapImageId(ctx, run.lastFrameImageId, imageMap);
			const extraReferenceImageIds = uniqueIds(
				(run.extraReferenceImageIds ?? []).flatMap((id) => {
					const remapped = remapImageId(ctx, id, imageMap);
					return remapped &&
						remapped !== firstFrameImageId &&
						remapped !== lastFrameImageId
						? [remapped]
						: [];
				}),
			);

			await ctx.db.replace(
				run._id,
				definedFields({
					provenance: run.provenance,
					status: run.status,
					title: run.title,
					shlokaText: run.shlokaText,
					customInstructions: run.customInstructions,
					plannerSystemPrompt: run.plannerSystemPrompt,
					plannerModel: run.plannerModel,
					plannerReasoning: run.plannerReasoning,
					imagePrompt: run.imagePrompt,
					videoScenes: run.videoScenes,
					imageSize: run.imageSize,
					imageQuality: run.imageQuality,
					selectedModelId: run.selectedModelId,
					videoParams: run.videoParams,
					videoPrompt: run.videoPrompt,
					compositionMode: run.compositionMode,
					compositionMultiplier: run.compositionMultiplier,
					compositionClipCount: run.compositionClipCount,
					attachedImageIds,
					attachedVideoIds,
					firstFrameImageId,
					lastFrameImageId,
					extraReferenceImageIds,
					warnings: run.warnings,
					lastError: run.lastError,
					planningKey: run.planningKey,
					planningCompletedAt: run.planningCompletedAt,
					imageCompletedAt: run.imageCompletedAt,
					videoCompletedAt: run.videoCompletedAt,
					activePlanId: run.activePlanId,
					activeCompositionJobId: run.activeCompositionJobId,
					createdAt: run.createdAt,
					updatedAt: Date.now(),
				}),
			);
			runsMigrated += 1;
		}

		const clips = await ctx.db.query("compositionClips").collect();
		for (const clip of clips) {
			let galleryVideoId = asGalleryVideoId(ctx, clip.galleryVideoId);
			if (!galleryVideoId && clip.video) {
				const before = await findGalleryByObjectKey(ctx, clip.video.objectKey);
				galleryVideoId = await ensureGalleryVideo(ctx, clip.video, clip.runId);
				if (before?.kind !== "video") {
					videosCreated += 1;
				}
			}

			let terminalFrameImageId = asGalleryImageId(
				ctx,
				clip.terminalFrameImageId,
			);
			if (!terminalFrameImageId && clip.terminalFrameObjectKey) {
				const before = await findGalleryByObjectKey(
					ctx,
					clip.terminalFrameObjectKey,
				);
				terminalFrameImageId = await ensureGalleryImage(ctx, {
					objectKey: clip.terminalFrameObjectKey,
					meta: { mimeType: "image/jpeg" },
					source: "terminal_frame",
					createdAt: clip.createdAt,
				});
				if (before?.kind !== "image") {
					imagesCreated += 1;
				}
			}

			const parentRun = await ctx.db.get(clip.runId);
			if (parentRun) {
				for (const imageId of parentRun.attachedImageIds ?? []) {
					const ok = asGalleryImageId(ctx, imageId);
					if (ok) {
						globalImageMap.set(imageId, ok);
					}
				}
			}

			const referenceImageId = remapImageId(
				ctx,
				clip.referenceImageId,
				globalImageMap,
			);

			await ctx.db.replace(
				clip._id,
				definedFields({
					jobId: clip.jobId,
					runId: clip.runId,
					clipIndex: clip.clipIndex,
					status: clip.status,
					globalDescription: clip.globalDescription,
					scenePrompt: clip.scenePrompt,
					continuityInstructions: clip.continuityInstructions,
					transition: clip.transition,
					referenceImageId,
					terminalFrameImageId,
					galleryVideoId,
					attempts: clip.attempts,
					lastError: clip.lastError,
					warnings: clip.warnings,
					createdAt: clip.createdAt,
					updatedAt: Date.now(),
				}),
			);
			clipsMigrated += 1;
		}

		return {
			runsMigrated,
			clipsMigrated,
			imagesCreated,
			videosCreated,
		};
	},
});
