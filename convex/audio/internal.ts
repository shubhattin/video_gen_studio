import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import {
	audioParamsValidator,
	audioRunStatusValidator,
	audioScriptValidator,
	mediaMetaValidator,
} from "../schema";
import { assertCanAddRevision, requireRevision } from "../lib/revisions";

export const setAudioRunStatus = internalMutation({
	args: {
		runId: v.id("audioRuns"),
		status: audioRunStatusValidator,
		/** `null` clears the previous error. */
		lastError: v.optional(v.union(v.string(), v.null())),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Audio run not found.");
		}
		await ctx.db.patch(args.runId, {
			status: args.status,
			lastError:
				args.lastError === undefined
					? run.lastError
					: (args.lastError ?? undefined),
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const setAudioRunTitle = internalMutation({
	args: {
		runId: v.id("audioRuns"),
		title: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			return null;
		}
		const title = args.title.trim();
		if (!title) {
			return null;
		}
		await ctx.db.patch(args.runId, {
			title: title.slice(0, 90),
			updatedAt: Date.now(),
		});
		return null;
	},
});

/**
 * Commit a scripter turn. Without parentIndex this is write / regenerate:
 * every revision is replaced by a single root (fresh conversation). With
 * parentIndex it is a revise: the turn is appended and becomes active.
 */
export const commitAudioScriptRevision = internalMutation({
	args: {
		runId: v.id("audioRuns"),
		parentIndex: v.optional(v.number()),
		revisionPrompt: v.optional(v.string()),
		userMessage: v.string(),
		script: audioScriptValidator,
		scriptParamsUsed: audioParamsValidator,
		scriptModel: v.string(),
		/** Root only: resolved system prompt the conversation runs on. */
		scriptSystemPrompt: v.optional(v.string()),
		scriptSystemPromptTemplateId: v.optional(v.id("systemPromptTemplates")),
		/** Status to settle on (the run's pre-scripting status). */
		status: audioRunStatusValidator,
		warnings: v.optional(v.array(v.string())),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) {
			throw new Error("Audio run not found.");
		}
		const now = Date.now();
		const revision = {
			parentIndex: args.parentIndex,
			revisionPrompt: args.revisionPrompt,
			userMessage: args.userMessage,
			script: args.script,
			scriptParamsUsed: args.scriptParamsUsed,
			scriptModel: args.scriptModel,
			createdAt: now,
		};
		const isRevise = args.parentIndex !== undefined;
		const existing = run.scriptRevisions ?? [];
		if (isRevise) {
			requireRevision(existing, args.parentIndex!);
			assertCanAddRevision(existing);
		}
		const scriptRevisions = isRevise ? [...existing, revision] : [revision];
		await ctx.db.patch(args.runId, {
			scriptRevisions,
			activeScriptRevisionIndex: scriptRevisions.length - 1,
			...(isRevise
				? {}
				: {
						scriptSystemPrompt: args.scriptSystemPrompt,
						scriptSystemPromptTemplateId: args.scriptSystemPromptTemplateId,
					}),
			status: args.status,
			warnings: args.warnings,
			lastError: undefined,
			updatedAt: now,
		});
		return null;
	},
});

/** Store a finished take and mark the run completed. */
export const insertGalleryAudio = internalMutation({
	args: {
		runId: v.id("audioRuns"),
		objectKey: v.string(),
		meta: mediaMetaValidator,
		audioParams: audioParamsValidator,
		prompt: v.string(),
		/** Guided runs: script revision the take was generated from. */
		scriptRevisionIndex: v.optional(v.number()),
		outputText: v.optional(v.string()),
		referenceImageCount: v.optional(v.number()),
		openRouterGenerationId: v.optional(v.string()),
		actualCostUsd: v.optional(v.number()),
		timeTakenMs: v.optional(v.number()),
		warnings: v.optional(v.array(v.string())),
	},
	returns: v.id("galleryAudios"),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		const now = Date.now();
		const audioId = await ctx.db.insert("galleryAudios", {
			objectKey: args.objectKey,
			meta: args.meta,
			audioParams: args.audioParams,
			prompt: args.prompt,
			scriptRevisionIndex: args.scriptRevisionIndex,
			outputText: args.outputText,
			referenceImageCount: args.referenceImageCount,
			openRouterGenerationId: args.openRouterGenerationId,
			actualCostUsd: args.actualCostUsd,
			timeTakenMs: args.timeTakenMs,
			warnings: args.warnings,
			// Run deleted mid-generation → keep the take as an abandoned file.
			audioRunId: run ? args.runId : undefined,
			createdAt: now,
		});
		if (run) {
			await ctx.db.patch(args.runId, {
				status: "completed",
				warnings: args.warnings,
				lastError: undefined,
				updatedAt: now,
			});
		}
		return audioId;
	},
});
