import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalQuery, query, type QueryCtx } from "../_generated/server";
import {
	DEFAULT_AUDIO_SYSTEM_PROMPT,
	type AudioPromptSelection,
} from "../lib/audioPrompt";
import { requireAdmin } from "../lib/auth";
import { resolveRevisionIndex } from "../lib/revisions";
import { plannerPromptSelectionValidator } from "../schema";
import { galleryAudioToResult, loadImagesByIds } from "../studio/media";

/** Newest-first takes for one run (bounded). */
async function listRunAudios(ctx: QueryCtx, runId: Id<"audioRuns">) {
	const docs = await ctx.db
		.query("galleryAudios")
		.withIndex("by_audioRunId_and_createdAt", (q) => q.eq("audioRunId", runId))
		.order("desc")
		.take(100);
	return docs.map(galleryAudioToResult);
}

/** A run with its reference images and generated takes, for the studio UI. */
export const getAudioRun = query({
	args: {
		runId: v.id("audioRuns"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return null;
		}
		const [images, audios] = await Promise.all([
			loadImagesByIds(ctx, run.referenceImageIds ?? []),
			listRunAudios(ctx, run._id),
		]);
		const activeScriptRevisionIndex = resolveRevisionIndex(
			run.scriptRevisions,
			run.activeScriptRevisionIndex,
		);
		return {
			...run,
			scriptRevisions: run.scriptRevisions ?? [],
			activeScriptRevisionIndex,
			activeScriptRevision:
				activeScriptRevisionIndex === null
					? null
					: run.scriptRevisions![activeScriptRevisionIndex]!,
			images,
			audios,
		};
	},
});

export const getAudioRunDoc = internalQuery({
	args: {
		runId: v.id("audioRuns"),
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args): Promise<Doc<"audioRuns"> | null> => {
		return await ctx.db.get(args.runId);
	},
});

/** Internal: the run's reference images (id + key + mime) for generation. */
export const listAudioRunImages = internalQuery({
	args: {
		runId: v.id("audioRuns"),
	},
	returns: v.array(
		v.object({
			id: v.id("galleryImages"),
			objectKey: v.string(),
			mimeType: v.string(),
		}),
	),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return [];
		}
		const out: Array<{
			id: Id<"galleryImages">;
			objectKey: string;
			mimeType: string;
		}> = [];
		for (const id of run.referenceImageIds ?? []) {
			const doc = await ctx.db.get(id);
			if (doc) {
				out.push({
					id: doc._id,
					objectKey: doc.objectKey,
					mimeType: doc.meta.mimeType,
				});
			}
		}
		return out;
	},
});

/** Internal: resolve an audio run's prompt selection to scripter text. */
export const resolveAudioPromptSelection = internalQuery({
	args: {
		selection: v.optional(plannerPromptSelectionValidator),
	},
	returns: v.object({
		content: v.string(),
		templateId: v.optional(v.id("systemPromptTemplates")),
	}),
	handler: async (ctx, args) => {
		const selection = args.selection as AudioPromptSelection | undefined;
		if (!selection || selection.kind === "default") {
			return { content: DEFAULT_AUDIO_SYSTEM_PROMPT };
		}
		const template = await ctx.db.get(selection.templateId);
		if (!template) {
			throw new Error("The selected system prompt template no longer exists.");
		}
		if (template.kind !== "audio") {
			throw new Error(
				"The selected template is a video template — pick an audio template.",
			);
		}
		return { content: template.content, templateId: template._id };
	},
});

// ── Gallery ─────────────────────────────────────────────────────────────

export const listGalleryAudios = query({
	args: {
		limit: v.optional(v.number()),
	},
	returns: v.array(v.any()),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const limit = Math.min(args.limit ?? 80, 200);
		const docs = await ctx.db
			.query("galleryAudios")
			.withIndex("by_createdAt")
			.order("desc")
			.take(limit);
		return docs.map(galleryAudioToResult);
	},
});

/** Owning run of a gallery audio (if still connected). */
export const getGalleryAudioRunConnection = query({
	args: {
		audioId: v.id("galleryAudios"),
	},
	returns: v.union(
		v.null(),
		v.object({
			runId: v.id("audioRuns"),
			mode: v.union(v.literal("direct"), v.literal("guided")),
			title: v.optional(v.string()),
			status: v.string(),
		}),
	),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const audio = await ctx.db.get(args.audioId);
		if (!audio?.audioRunId) {
			return null;
		}
		const run = await ctx.db.get(audio.audioRunId);
		if (!run) {
			return null;
		}
		return {
			runId: run._id,
			mode: run.mode,
			title: run.title,
			status: run.status,
		};
	},
});
