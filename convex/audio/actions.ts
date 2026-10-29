"use node";

import { generateText, type ModelMessage, Output } from "ai";
import type { FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import Handlebars from "handlebars";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { action, type ActionCtx, internalAction } from "../_generated/server";
import {
	AUDIO_MODEL_PROFILES,
	AUDIO_SCRIPT_MODEL_ID,
	type AudioParams,
	resolveAudioParams,
} from "../lib/audioCatalog";
import {
	AUDIO_USER_PROMPT_TEMPLATE,
	type AudioScriptOutput,
	audioScriptOutputSchema,
	buildAudioProviderPrompt,
	buildAudioScripterSystemPrompt,
} from "../lib/audioPrompt";
import { requireAdmin } from "../lib/auth";
import {
	assertCanAddRevision,
	buildRevisionUserMessage,
	cleanRevisionPrompt,
	requireRevision,
	revisionChain,
} from "../lib/revisions";
import {
	LLM_NO_REASONING_LEVEL,
	LLM_REASONING_LEVEL,
	TITLE_MODEL_ID,
} from "../lib/modelCatalog";
import { generateOpenRouterAudio } from "../lib/openrouterAudio";
import { getOpenRouterApiKey, openRouterChatModel } from "../lib/providers";
import {
	buildStudioObjectKey,
	createPresignedGetUrl,
	putObjectBytes,
} from "../lib/r2";

const SCRIPTER_TIMEOUT_MS = 4 * 60 * 1000;
/** Keep the request body sane — Lyria takes inline base64 images. */
const MAX_INLINE_IMAGE_BYTES = 7 * 1024 * 1024;

const renderScripterPrompt = Handlebars.compile(AUDIO_USER_PROMPT_TEMPLATE, {
	noEscape: true,
	strict: false,
});

async function loadRun(
	ctx: ActionCtx,
	runId: Id<"audioRuns">,
): Promise<Doc<"audioRuns">> {
	const run: Doc<"audioRuns"> | null = await ctx.runQuery(
		internal.audio.queries.getAudioRunDoc,
		{ runId },
	);
	if (!run) {
		throw new Error("Run not found.");
	}
	return run;
}

/** Status to settle on once an in-flight step ends. */
function settledStatus(previous: Doc<"audioRuns">["status"]) {
	return previous === "completed" ? "completed" : "draft";
}

function errorMessage(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s.`)),
			ms,
		);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── Guided: write / revise the song script ─────────────────────────────

type ScriptRevision = NonNullable<Doc<"audioRuns">["scriptRevisions"]>[number];

type ScripterTurn =
	| { kind: "regenerate" }
	| { kind: "revise"; baseIndex: number; request: string };

/** A revision as the assistant turn the scripter would have returned. */
function revisionAsScriptOutput(revision: ScriptRevision): AudioScriptOutput {
	return {
		title: revision.script.title,
		styleDirection: revision.script.styleDirection,
		lyrics: revision.script.lyrics,
		pronunciationNotes: revision.script.pronunciationNotes ?? null,
	};
}

/**
 * One scripter turn. Regenerate starts a fresh conversation from the run's
 * current brief and template. Revise continues the conversation that
 * produced `baseIndex` (edited scripts as the assistant turns) and appends.
 */
async function runScripterTurn(
	ctx: ActionCtx,
	runId: Id<"audioRuns">,
	turn: ScripterTurn,
): Promise<void> {
	const run = await loadRun(ctx, runId);
	if (run.mode !== "guided") {
		throw new Error("Only guided runs have a song script.");
	}
	if (run.status === "scripting" || run.status === "generating") {
		throw new Error("Run is busy. Wait for the current step to finish.");
	}
	const revisions = run.scriptRevisions ?? [];
	const instructions = run.customInstructions?.trim();
	if (turn.kind === "revise") {
		requireRevision(revisions, turn.baseIndex);
		assertCanAddRevision(revisions);
	} else {
		if (!instructions) {
			throw new Error("Write instructions before generating a script.");
		}
		if (!run.promptSelection) {
			throw new Error("Select a system prompt template before writing a script.");
		}
	}

	const params = resolveAudioParams(run.audioParams);
	const profile =
		AUDIO_MODEL_PROFILES[params.modelId as keyof typeof AUDIO_MODEL_PROFILES];
	const previousStatus = run.status;

	await ctx.runMutation(internal.audio.internal.setAudioRunStatus, {
		runId,
		status: "scripting",
		lastError: null,
	});

	try {
		const imageCount = Math.min(
			run.referenceImageIds?.length ?? 0,
			profile.maxInputImages,
		);
		const basePromptFor = (used: AudioParams) => {
			const usedProfile =
				AUDIO_MODEL_PROFILES[used.modelId as keyof typeof AUDIO_MODEL_PROFILES] ??
				profile;
			return renderScripterPrompt({
				instructions: instructions ?? "",
				modelName: usedProfile.displayName,
				fixedDurationSeconds: usedProfile.fixedDurationSeconds,
				targetDurationSeconds: used.targetDurationSeconds,
				instrumental: used.instrumental === true,
				imageCount: imageCount > 0 ? imageCount : undefined,
			}).trim();
		};

		let resolved:
			| FunctionReturnType<typeof internal.audio.queries.resolveAudioPromptSelection>
			| undefined;
		let systemPrompt: string;
		let userMessage: string;
		const history: ModelMessage[] = [];
		if (turn.kind === "regenerate") {
			resolved = await ctx.runQuery(
				internal.audio.queries.resolveAudioPromptSelection,
				{ selection: run.promptSelection! },
			);
			systemPrompt = resolved.content;
			userMessage = basePromptFor(params);
		} else {
			// The conversation keeps the system prompt it started with.
			systemPrompt = run.scriptSystemPrompt ?? "";
			for (const index of revisionChain(revisions, turn.baseIndex)) {
				const revision = revisions[index]!;
				history.push(
					{
						role: "user",
						// Migrated roots have no stored turn — re-render it.
						content:
							revision.userMessage ?? basePromptFor(revision.scriptParamsUsed),
					},
					{
						role: "assistant",
						content: JSON.stringify(revisionAsScriptOutput(revision)),
					},
				);
			}
			userMessage = buildRevisionUserMessage({
				request: turn.request,
				subject: "song script",
				constraints: [
					`Model: ${profile.displayName}`,
					profile.fixedDurationSeconds
						? `Length: fixed at ${profile.fixedDurationSeconds} seconds by the model.`
						: params.targetDurationSeconds
							? `Target length: about ${params.targetDurationSeconds} seconds.`
							: "",
					params.instrumental
						? "Instrumental: Yes — no vocals, return empty lyrics"
						: "Instrumental: No — sung Sanskrit vocals",
				],
			});
		}

		const result = await withTimeout(
			generateText({
				model: openRouterChatModel(AUDIO_SCRIPT_MODEL_ID, LLM_REASONING_LEVEL),
				instructions: buildAudioScripterSystemPrompt(systemPrompt),
				messages: [...history, { role: "user", content: userMessage }],
				output: Output.object({ schema: audioScriptOutputSchema }),
			}),
			SCRIPTER_TIMEOUT_MS,
			turn.kind === "revise" ? "Script revision" : "Script generation",
		);
		const output = result.output;
		const warnings = (result.warnings ?? [])
			.map((warning) =>
				"message" in warning && warning.message
					? warning.message
					: "details" in warning && warning.details
						? warning.details
						: undefined,
			)
			.filter((value): value is string => Boolean(value));

		await ctx.runMutation(internal.audio.internal.commitAudioScriptRevision, {
			runId,
			parentIndex: turn.kind === "revise" ? turn.baseIndex : undefined,
			revisionPrompt: turn.kind === "revise" ? turn.request : undefined,
			userMessage,
			script: {
				title: output.title.trim(),
				styleDirection: output.styleDirection.trim(),
				lyrics: output.lyrics.trim(),
				pronunciationNotes: output.pronunciationNotes?.trim() || undefined,
			},
			scriptParamsUsed: params,
			scriptModel: AUDIO_SCRIPT_MODEL_ID,
			scriptSystemPrompt: resolved?.content,
			scriptSystemPromptTemplateId: resolved?.templateId,
			status: settledStatus(previousStatus),
			warnings: warnings.length > 0 ? warnings : undefined,
		});
	} catch (error) {
		await ctx.runMutation(internal.audio.internal.setAudioRunStatus, {
			runId,
			status: settledStatus(previousStatus),
			lastError: errorMessage(
				error,
				turn.kind === "revise" ? "Script revision failed." : "Script generation failed.",
			),
		});
		throw error;
	}
}

/** Write / regenerate: replaces every revision with a fresh root. */
export const scriptAudioRun = action({
	args: {
		runId: v.id("audioRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		await runScripterTurn(ctx, args.runId, { kind: "regenerate" });
		return null;
	},
});

/** Revise `baseRevisionIndex` with a follow-up instruction; appends a revision. */
export const reviseAudioScript = action({
	args: {
		runId: v.id("audioRuns"),
		baseRevisionIndex: v.number(),
		prompt: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		await runScripterTurn(ctx, args.runId, {
			kind: "revise",
			baseIndex: args.baseRevisionIndex,
			request: cleanRevisionPrompt(args.prompt),
		});
		return null;
	},
});

// ── Generate a take ─────────────────────────────────────────────────────

async function loadImageDataUrls(
	ctx: ActionCtx,
	runId: Id<"audioRuns">,
	max: number,
): Promise<{ urls: string[]; warnings: string[] }> {
	if (max <= 0) return { urls: [], warnings: [] };
	const images = await ctx.runQuery(internal.audio.queries.listAudioRunImages, {
		runId,
	});
	const warnings: string[] = [];
	if (images.length > max) {
		warnings.push(`Only the first ${max} reference images were sent.`);
	}
	const urls: string[] = [];
	for (const image of images.slice(0, max)) {
		const response = await fetch(
			await createPresignedGetUrl({ objectKey: image.objectKey }),
		);
		if (!response.ok) {
			warnings.push("A reference image could not be read and was skipped.");
			continue;
		}
		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
			warnings.push("A reference image over 7MB was skipped.");
			continue;
		}
		urls.push(`data:${image.mimeType};base64,${bytes.toString("base64")}`);
	}
	return { urls, warnings };
}

function resolveProviderPrompt(
	run: Doc<"audioRuns">,
	params: AudioParams,
	revisionIndex: number | undefined,
) {
	if (run.mode === "direct") {
		const prompt = run.prompt?.trim();
		if (!prompt) {
			throw new Error("Write a prompt before generating.");
		}
		return prompt;
	}
	if (!run.scriptRevisions?.length) {
		throw new Error("Write the song script before generating audio.");
	}
	if (revisionIndex === undefined) {
		throw new Error("Pick a script revision to generate from.");
	}
	return buildAudioProviderPrompt(
		requireRevision(run.scriptRevisions, revisionIndex).script,
		params,
	);
}

export const generateAudioForRun = action({
	args: {
		runId: v.id("audioRuns"),
		/** Guided runs: script revision the user confirmed in the Generate dialog. */
		scriptRevisionIndex: v.optional(v.number()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const run = await loadRun(ctx, args.runId);
		if (run.status === "scripting" || run.status === "generating") {
			throw new Error("Run is busy. Wait for the current step to finish.");
		}
		const params = resolveAudioParams(run.audioParams);
		const modelId = params.modelId as keyof typeof AUDIO_MODEL_PROFILES;
		const profile = AUDIO_MODEL_PROFILES[modelId];
		const scriptRevisionIndex =
			run.mode === "guided" ? args.scriptRevisionIndex : undefined;
		const prompt = resolveProviderPrompt(run, params, scriptRevisionIndex);

		await ctx.runMutation(internal.audio.internal.setAudioRunStatus, {
			runId: args.runId,
			status: "generating",
			lastError: null,
		});

		try {
			const images = await loadImageDataUrls(
				ctx,
				args.runId,
				profile.maxInputImages,
			);
			const startedAt = Date.now();
			const result = await generateOpenRouterAudio({
				apiKey: getOpenRouterApiKey(),
				modelId,
				prompt,
				imageDataUrls: images.urls,
			});
			const timeTakenMs = Date.now() - startedAt;

			const objectKey = buildStudioObjectKey({
				kind: "audios",
				mimeType: result.mimeType,
			});
			await putObjectBytes({
				objectKey,
				bytes: result.bytes,
				mimeType: result.mimeType,
			});
			await ctx.runMutation(internal.audio.internal.insertGalleryAudio, {
				runId: args.runId,
				objectKey,
				meta: {
					mimeType: result.mimeType,
					durationSeconds: result.durationSeconds,
					bytes: result.bytes.byteLength,
				},
				audioParams: params,
				prompt,
				scriptRevisionIndex,
				outputText: result.outputText,
				referenceImageCount: images.urls.length || undefined,
				openRouterGenerationId: result.generationId,
				actualCostUsd: result.costUsd,
				timeTakenMs,
				warnings: images.warnings.length > 0 ? images.warnings : undefined,
			});
		} catch (error) {
			await ctx.runMutation(internal.audio.internal.setAudioRunStatus, {
				runId: args.runId,
				status: "failed",
				lastError: errorMessage(error, "Audio generation failed."),
			});
			throw error;
		}
		return null;
	},
});

// ── Titles ──────────────────────────────────────────────────────────────

async function audioRunTitleGeneration(
	ctx: ActionCtx,
	args: { runId: Id<"audioRuns">; force?: boolean },
): Promise<string> {
	const run = await loadRun(ctx, args.runId);
	if (!args.force && run.title?.trim()) {
		return run.title;
	}
	const fallback = run.mode === "guided" ? "Sanskrit Song" : "Audio Run";
	const source =
		run.mode === "guided"
			? run.customInstructions?.trim()
				? `Song brief: ${run.customInstructions.trim().slice(0, 600)}`
				: ""
			: run.prompt?.trim()
				? `Audio prompt: ${run.prompt.trim().slice(0, 600)}`
				: "";
	if (!source) {
		return fallback;
	}
	try {
		const result = await generateText({
			model: openRouterChatModel(TITLE_MODEL_ID, LLM_NO_REASONING_LEVEL),
			instructions:
				"You write short, clear titles for music / audio generation runs (under 60 characters). No quotes, emoji, hashtags, or trailing punctuation.",
			prompt: `Write a short title for this run.\n\n${source}`,
		});
		const title =
			result.text.replace(/^["'`\s]+|["'`\s]+$/g, "").trim().slice(0, 90) ||
			fallback;
		await ctx.runMutation(internal.audio.internal.setAudioRunTitle, {
			runId: args.runId,
			title,
		});
		return title;
	} catch {
		return fallback;
	}
}

export const generateAudioRunTitle = action({
	args: {
		runId: v.id("audioRuns"),
		force: v.optional(v.boolean()),
	},
	returns: v.string(),
	handler: async (ctx, args): Promise<string> => {
		await requireAdmin(ctx);
		return await audioRunTitleGeneration(ctx, args);
	},
});

/** Scheduler-invoked from autosave (no user auth on scheduled calls). */
export const generateAudioRunTitleScheduled = internalAction({
	args: {
		runId: v.id("audioRuns"),
		force: v.optional(v.boolean()),
	},
	returns: v.string(),
	handler: async (ctx, args): Promise<string> => {
		return await audioRunTitleGeneration(ctx, args);
	},
});
