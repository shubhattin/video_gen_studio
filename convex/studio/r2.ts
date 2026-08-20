"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, internalAction } from "../_generated/server";
import { requireAdmin } from "../lib/auth";
import {
	buildStudioObjectKey,
	createPresignedGetUrl,
	createPresignedPutUrl,
	deleteObjects as deleteR2Objects,
	headObject,
} from "../lib/r2";

const ALLOWED_REFERENCE_UPLOAD_MIME_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/jpg",
	"image/webp",
	"image/gif",
]);

const MAX_REFERENCE_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_TERMINAL_FRAME_BYTES = 10 * 1024 * 1024;

function normalizeMimeType(mimeType: string) {
	return mimeType.toLowerCase();
}

export const deleteObjects = internalAction({
	args: {
		objectKeys: v.array(v.string()),
	},
	returns: v.null(),
	handler: async (_ctx, args) => {
		await deleteR2Objects(args.objectKeys);
		return null;
	},
});

export const prepareReferenceImageUpload = action({
	args: {
		runId: v.id("generationRuns"),
		mimeType: v.string(),
		bytes: v.optional(v.number()),
	},
	returns: v.object({
		uploadUrl: v.string(),
		objectKey: v.string(),
		contentType: v.string(),
	}),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.runQuery(internal.studio.queries.getRunDoc, {
			runId: args.runId,
		});
		if (!run) {
			throw new Error("Run not found.");
		}
		const mimeType = normalizeMimeType(args.mimeType);
		if (!ALLOWED_REFERENCE_UPLOAD_MIME_TYPES.has(mimeType)) {
			throw new Error("Unsupported image type. Use PNG, JPEG, WebP, or GIF.");
		}
		if (
			args.bytes !== undefined &&
			args.bytes > MAX_REFERENCE_UPLOAD_BYTES
		) {
			throw new Error("Image is too large. Max size is 20MB.");
		}
		const objectKey = buildStudioObjectKey({
			kind: "images",
			mimeType,
		});
		const uploadUrl = await createPresignedPutUrl({
			objectKey,
			mimeType,
		});
		return { uploadUrl, objectKey, contentType: mimeType };
	},
});

export const finalizeReferenceImageUpload = action({
	args: {
		runId: v.id("generationRuns"),
		objectKey: v.string(),
		mimeType: v.string(),
		width: v.optional(v.number()),
		height: v.optional(v.number()),
		bytes: v.optional(v.number()),
		setAsFirstFrame: v.optional(v.boolean()),
	},
	returns: v.object({
		imageId: v.id("galleryImages"),
	}),
	handler: async (ctx, args): Promise<{ imageId: Id<"galleryImages"> }> => {
		await requireAdmin(ctx);
		const run = await ctx.runQuery(internal.studio.queries.getRunDoc, {
			runId: args.runId,
		});
		if (!run) {
			throw new Error("Run not found.");
		}
		if (!args.objectKey.startsWith("studio/gallery/images/")) {
			throw new Error("Uploaded object key is invalid for the gallery.");
		}
		const mimeType = normalizeMimeType(args.mimeType);
		if (!ALLOWED_REFERENCE_UPLOAD_MIME_TYPES.has(mimeType)) {
			await deleteR2Objects([args.objectKey]);
			throw new Error("Unsupported image type. Use PNG, JPEG, WebP, or GIF.");
		}

		let head: Awaited<ReturnType<typeof headObject>>;
		try {
			head = await headObject(args.objectKey);
		} catch {
			throw new Error("Uploaded file not found in storage.");
		}
		const contentLength = head.contentLength ?? args.bytes;
		if (
			contentLength !== undefined &&
			contentLength !== null &&
			contentLength > MAX_REFERENCE_UPLOAD_BYTES
		) {
			await deleteR2Objects([args.objectKey]);
			throw new Error("Image is too large. Max size is 20MB.");
		}
		if (
			head.contentType &&
			!ALLOWED_REFERENCE_UPLOAD_MIME_TYPES.has(
				normalizeMimeType(head.contentType),
			)
		) {
			await deleteR2Objects([args.objectKey]);
			throw new Error("Unsupported image type. Use PNG, JPEG, WebP, or GIF.");
		}

		const imageId = await ctx.runMutation(
			internal.studio.internal.insertGalleryImage,
			{
				runId: args.runId,
				objectKey: args.objectKey,
				meta: {
					mimeType,
					width: args.width,
					height: args.height,
					bytes: contentLength ?? args.bytes ?? undefined,
				},
				source: "uploaded",
				setAsFirstFrame: args.setAsFirstFrame === true,
			},
		);
		return { imageId };
	},
});

export const prepareTerminalFrameUpload = action({
	args: {
		runId: v.id("generationRuns"),
		clipId: v.id("compositionClips"),
		mimeType: v.optional(v.string()),
	},
	returns: v.object({
		uploadUrl: v.string(),
		objectKey: v.string(),
		contentType: v.string(),
	}),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const job = await ctx.runQuery(
			internal.studio.queries.getCompositionJobByRun,
			{ runId: args.runId },
		);
		if (!job) {
			throw new Error("Composition job was not found.");
		}
		if (job.status !== "awaiting_terminal_frame") {
			throw new Error("Composition is not waiting for a continuity frame.");
		}
		const clip = await ctx.runQuery(internal.studio.queries.getCompositionClip, {
			clipId: args.clipId,
		});
		if (!clip || clip.jobId !== job._id) {
			throw new Error("Composition clip was not found.");
		}
		const mimeType = normalizeMimeType(args.mimeType ?? "image/jpeg");
		if (!ALLOWED_REFERENCE_UPLOAD_MIME_TYPES.has(mimeType)) {
			throw new Error("Unsupported continuity-frame type.");
		}
		const objectKey = buildStudioObjectKey({
			kind: "frames",
			mimeType,
		});
		const uploadUrl = await createPresignedPutUrl({
			objectKey,
			mimeType,
		});
		return { uploadUrl, objectKey, contentType: mimeType };
	},
});

export const finalizeTerminalFrameUpload = action({
	args: {
		runId: v.id("generationRuns"),
		clipId: v.id("compositionClips"),
		objectKey: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const job = await ctx.runQuery(
			internal.studio.queries.getCompositionJobByRun,
			{ runId: args.runId },
		);
		if (!job) {
			await deleteR2Objects([args.objectKey]);
			throw new Error("Composition job was not found.");
		}
		if (job.status !== "awaiting_terminal_frame") {
			await deleteR2Objects([args.objectKey]);
			throw new Error("Composition is not waiting for a continuity frame.");
		}
		const clip = await ctx.runQuery(internal.studio.queries.getCompositionClip, {
			clipId: args.clipId,
		});
		if (!clip || clip.jobId !== job._id) {
			await deleteR2Objects([args.objectKey]);
			throw new Error("Composition clip was not found.");
		}
		if (!args.objectKey.startsWith("studio/gallery/frames/")) {
			await deleteR2Objects([args.objectKey]);
			throw new Error("Uploaded object key is invalid for the gallery.");
		}
		let head: Awaited<ReturnType<typeof headObject>>;
		try {
			head = await headObject(args.objectKey);
		} catch {
			throw new Error("Uploaded continuity frame not found in storage.");
		}
		if (
			head.contentLength !== null &&
			head.contentLength > MAX_TERMINAL_FRAME_BYTES
		) {
			await deleteR2Objects([args.objectKey]);
			throw new Error("Continuity frame is too large.");
		}
		const terminalFrameImageId = await ctx.runMutation(
			internal.studio.internal.insertGalleryImage,
			{
				objectKey: args.objectKey,
				meta: {
					mimeType: head.contentType ?? "image/jpeg",
					bytes: head.contentLength ?? undefined,
				},
				source: "terminal_frame",
				attachToRun: false,
			},
		);
		await ctx.runMutation(
			internal.studio.internal.attachCompositionTerminalFrame,
			{
				jobId: job._id,
				clipId: args.clipId,
				terminalFrameImageId,
			},
		);
		return null;
	},
});

export const getReadUrls = action({
	args: {
		runId: v.optional(v.id("generationRuns")),
		objectKeys: v.array(v.string()),
	},
	returns: v.record(v.string(), v.union(v.string(), v.null())),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const uniqueKeys = [...new Set(args.objectKeys.filter(Boolean))];
		const result: Record<string, string | null> = {};
		await Promise.all(
			uniqueKeys.map(async (objectKey) => {
				const allowed = await ctx.runQuery(
					internal.studio.queries.objectKeyInGallery,
					{ objectKey },
				);
				if (!allowed) {
					result[objectKey] = null;
					return;
				}
				try {
					result[objectKey] = await createPresignedGetUrl({ objectKey });
				} catch {
					result[objectKey] = null;
				}
			}),
		);
		return result;
	},
});

export const getDownloadUrl = action({
	args: {
		runId: v.id("generationRuns"),
		objectKey: v.string(),
		filename: v.string(),
		contentType: v.optional(v.string()),
	},
	returns: v.string(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const allowed = await ctx.runQuery(
			internal.studio.queries.objectKeyInGallery,
			{
				objectKey: args.objectKey,
			},
		);
		if (!allowed) {
			throw new Error("Object was not found in the gallery.");
		}
		return await createPresignedGetUrl({
			objectKey: args.objectKey,
			filename: args.filename,
			contentType: args.contentType,
		});
	},
});

export const createInternalReadUrl = internalAction({
	args: {
		objectKey: v.string(),
	},
	returns: v.string(),
	handler: async (_ctx, args) => {
		return await createPresignedGetUrl({ objectKey: args.objectKey });
	},
});
