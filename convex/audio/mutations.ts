import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import {
	defaultAudioParams,
	isAudioModelId,
	normalizeAudioParams,
} from "../lib/audioCatalog";
import { requireAdmin } from "../lib/auth";
import {
	audioParamsValidator,
	audioRunModeValidator,
	audioScriptValidator,
	plannerPromptSelectionValidator,
} from "../schema";
import {
	imageReferencedByAudioRuns,
	imageReferencedByVideoRuns,
	uniqueIds,
	unlinkGalleryImageFromRuns,
} from "../studio/media";

/** Highest image count any audio model accepts (Lyria). */
const MAX_REFERENCE_IMAGES = 10;
const MAX_PROMPT_CHARS = 20_000;
const MAX_INSTRUCTIONS_CHARS = 10_000;

function assertNotBusy(run: Doc<"audioRuns">) {
	if (run.status === "scripting" || run.status === "generating") {
		throw new Error("Run is busy. Wait for the current step to finish.");
	}
}

function boundedText(
	value: string | undefined,
	max: number,
	label: string,
): string | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (trimmed.length > max) {
		throw new Error(`${label} is too long (max ${max.toLocaleString()} characters).`);
	}
	return trimmed;
}

async function requireRun(ctx: MutationCtx, runId: Id<"audioRuns">) {
	const run = await ctx.db.get(runId);
	if (!run) {
		throw new Error("Run not found.");
	}
	return run;
}

async function scheduleTitle(ctx: MutationCtx, run: Doc<"audioRuns">) {
	if (run.title?.trim()) return;
	await ctx.scheduler.runAfter(
		1500,
		internal.audio.actions.generateAudioRunTitleScheduled,
		{ runId: run._id },
	);
}

export const createAudioRun = mutation({
	args: {
		mode: audioRunModeValidator,
		modelId: v.string(),
	},
	returns: v.id("audioRuns"),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (!isAudioModelId(args.modelId)) {
			throw new Error("Unsupported audio model.");
		}
		const now = Date.now();
		return await ctx.db.insert("audioRuns", {
			mode: args.mode,
			status: "draft",
			audioParams: defaultAudioParams(args.modelId),
			// Guided runs start on the built-in Sanskrit song prompt.
			promptSelection: args.mode === "guided" ? { kind: "default" } : undefined,
			referenceImageIds: [],
			createdAt: now,
			updatedAt: now,
		});
	},
});

/** Autosave for inputs and settings. Omitted fields are left unchanged. */
export const updateAudioRun = mutation({
	args: {
		runId: v.id("audioRuns"),
		prompt: v.optional(v.string()),
		customInstructions: v.optional(v.string()),
		/** `null` clears the selection. */
		promptSelection: v.optional(
			v.union(plannerPromptSelectionValidator, v.null()),
		),
		audioParams: v.optional(audioParamsValidator),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await requireRun(ctx, args.runId);
		assertNotBusy(run);

		if (args.promptSelection?.kind === "template") {
			const template = await ctx.db.get(args.promptSelection.templateId);
			if (!template || template.kind !== "audio") {
				throw new Error("Pick an audio system prompt template.");
			}
		}

		const prompt = boundedText(args.prompt, MAX_PROMPT_CHARS, "Prompt");
		const customInstructions = boundedText(
			args.customInstructions,
			MAX_INSTRUCTIONS_CHARS,
			"Instructions",
		);
		const patch: Partial<Doc<"audioRuns">> = { updatedAt: Date.now() };
		if (prompt !== undefined) patch.prompt = prompt || undefined;
		if (customInstructions !== undefined) {
			patch.customInstructions = customInstructions || undefined;
		}
		if (args.promptSelection !== undefined) {
			patch.promptSelection = args.promptSelection ?? undefined;
		}
		if (args.audioParams) {
			patch.audioParams = normalizeAudioParams(args.audioParams);
		}
		await ctx.db.patch(args.runId, patch);

		const hasContent = Boolean(
			(patch.prompt ?? run.prompt) ||
				(patch.customInstructions ?? run.customInstructions),
		);
		if (hasContent) {
			await scheduleTitle(ctx, run);
		}
		return null;
	},
});

/** Save user edits to the guided script. */
export const updateAudioScript = mutation({
	args: {
		runId: v.id("audioRuns"),
		script: audioScriptValidator,
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await requireRun(ctx, args.runId);
		assertNotBusy(run);
		if (run.mode !== "guided") {
			throw new Error("Only guided runs have a script.");
		}
		const title = args.script.title.trim();
		const styleDirection = args.script.styleDirection.trim();
		const lyrics = args.script.lyrics.trim();
		if (!title || !styleDirection) {
			throw new Error("Script title and direction cannot be empty.");
		}
		if (lyrics.length > MAX_PROMPT_CHARS || styleDirection.length > MAX_PROMPT_CHARS) {
			throw new Error("Script is too long.");
		}
		await ctx.db.patch(args.runId, {
			script: {
				title: title.slice(0, 200),
				styleDirection,
				lyrics,
				pronunciationNotes: args.script.pronunciationNotes?.trim() || undefined,
			},
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const renameAudioRun = mutation({
	args: {
		runId: v.id("audioRuns"),
		title: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		await requireRun(ctx, args.runId);
		const title = args.title.trim();
		if (!title) {
			throw new Error("Title cannot be empty.");
		}
		await ctx.db.patch(args.runId, {
			title: title.slice(0, 90),
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const attachImageToAudioRun = mutation({
	args: {
		runId: v.id("audioRuns"),
		imageId: v.id("galleryImages"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await requireRun(ctx, args.runId);
		assertNotBusy(run);
		const image = await ctx.db.get(args.imageId);
		if (!image) {
			throw new Error("Gallery image not found.");
		}
		const next = uniqueIds([...(run.referenceImageIds ?? []), args.imageId]);
		if (next.length > MAX_REFERENCE_IMAGES) {
			throw new Error(
				`Audio runs take at most ${MAX_REFERENCE_IMAGES} reference images.`,
			);
		}
		await ctx.db.patch(args.runId, {
			referenceImageIds: next,
			updatedAt: Date.now(),
		});
		return null;
	},
});

/** Unlink an image from the run (the gallery file stays). */
export const removeAudioRunReferenceImage = mutation({
	args: {
		runId: v.id("audioRuns"),
		imageId: v.id("galleryImages"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await requireRun(ctx, args.runId);
		assertNotBusy(run);
		await ctx.db.patch(args.runId, {
			referenceImageIds: (run.referenceImageIds ?? []).filter(
				(id) => id !== args.imageId,
			),
			updatedAt: Date.now(),
		});
		return null;
	},
});

/**
 * Delete a run. With `deleteMedia`, its takes and any reference images used
 * by no other run are removed too; otherwise takes stay in the gallery as
 * abandoned (unlinked) files.
 */
export const deleteAudioRun = mutation({
	args: {
		runId: v.id("audioRuns"),
		deleteMedia: v.optional(v.boolean()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return null;
		}
		const keysToDelete: string[] = [];
		const takes = ctx.db
			.query("galleryAudios")
			.withIndex("by_audioRunId_and_createdAt", (q) =>
				q.eq("audioRunId", args.runId),
			);
		for await (const audio of takes) {
			if (args.deleteMedia === true) {
				keysToDelete.push(audio.objectKey);
				await ctx.db.delete(audio._id);
			} else {
				await ctx.db.patch(audio._id, { audioRunId: undefined });
			}
		}
		if (args.deleteMedia === true) {
			for (const imageId of run.referenceImageIds ?? []) {
				if (
					(await imageReferencedByAudioRuns(ctx, imageId, run._id)) ||
					(await imageReferencedByVideoRuns(ctx, imageId))
				) {
					continue;
				}
				const image = await ctx.db.get(imageId);
				if (!image) continue;
				await unlinkGalleryImageFromRuns(ctx, imageId);
				await ctx.db.delete(imageId);
				keysToDelete.push(image.objectKey);
			}
		}
		await ctx.db.delete(args.runId);
		if (keysToDelete.length > 0) {
			await ctx.scheduler.runAfter(0, internal.studio.r2.deleteObjects, {
				objectKeys: keysToDelete,
			});
		}
		return null;
	},
});

/** Delete an abandoned take from the shared gallery. */
export const deleteGalleryAudio = mutation({
	args: {
		audioId: v.id("galleryAudios"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const audio = await ctx.db.get(args.audioId);
		if (!audio) {
			return null;
		}
		if (audio.audioRunId && (await ctx.db.get(audio.audioRunId))) {
			throw new Error(
				"This track is still connected to a run and cannot be deleted.",
			);
		}
		await ctx.db.delete(args.audioId);
		await ctx.scheduler.runAfter(0, internal.studio.r2.deleteObjects, {
			objectKeys: [audio.objectKey],
		});
		return null;
	},
});

