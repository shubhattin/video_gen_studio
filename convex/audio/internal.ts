import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import {
	audioParamsValidator,
	audioRunStatusValidator,
	audioScriptValidator,
	mediaMetaValidator,
} from "../schema";

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

/** Overwrite the guided script with fresh scripter output. */
export const commitAudioScript = internalMutation({
	args: {
		runId: v.id("audioRuns"),
		script: audioScriptValidator,
		scriptParamsUsed: audioParamsValidator,
		scriptModel: v.string(),
		scriptSystemPrompt: v.string(),
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
		await ctx.db.patch(args.runId, {
			script: args.script,
			scriptParamsUsed: args.scriptParamsUsed,
			scriptModel: args.scriptModel,
			scriptSystemPrompt: args.scriptSystemPrompt,
			scriptSystemPromptTemplateId: args.scriptSystemPromptTemplateId,
			status: args.status,
			warnings: args.warnings,
			lastError: undefined,
			updatedAt: Date.now(),
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
