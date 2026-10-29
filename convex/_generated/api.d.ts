/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as audio_actions from "../audio/actions.js";
import type * as audio_internal from "../audio/internal.js";
import type * as audio_mutations from "../audio/mutations.js";
import type * as audio_queries from "../audio/queries.js";
import type * as http from "../http.js";
import type * as lib_appInfo from "../lib/appInfo.js";
import type * as lib_audioCatalog from "../lib/audioCatalog.js";
import type * as lib_audioPrompt from "../lib/audioPrompt.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_modelCatalog from "../lib/modelCatalog.js";
import type * as lib_openrouterAudio from "../lib/openrouterAudio.js";
import type * as lib_openrouterVideo from "../lib/openrouterVideo.js";
import type * as lib_plannerPrompt from "../lib/plannerPrompt.js";
import type * as lib_promptSummarizer from "../lib/promptSummarizer.js";
import type * as lib_prompts_audio_song from "../lib/prompts/audio_song.js";
import type * as lib_prompts_main_video_scene from "../lib/prompts/main_video_scene.js";
import type * as lib_prompts_scene_summary from "../lib/prompts/scene_summary.js";
import type * as lib_prompts_user_base_prompt from "../lib/prompts/user_base_prompt.js";
import type * as lib_providers from "../lib/providers.js";
import type * as lib_r2 from "../lib/r2.js";
import type * as lib_revisions from "../lib/revisions.js";
import type * as lib_schemas from "../lib/schemas.js";
import type * as lib_videoAdapters from "../lib/videoAdapters.js";
import type * as lib_videoPlanMarkdown from "../lib/videoPlanMarkdown.js";
import type * as studio_actions from "../studio/actions.js";
import type * as studio_internal from "../studio/internal.js";
import type * as studio_media from "../studio/media.js";
import type * as studio_mutations from "../studio/mutations.js";
import type * as studio_queries from "../studio/queries.js";
import type * as studio_r2 from "../studio/r2.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "audio/actions": typeof audio_actions;
  "audio/internal": typeof audio_internal;
  "audio/mutations": typeof audio_mutations;
  "audio/queries": typeof audio_queries;
  http: typeof http;
  "lib/appInfo": typeof lib_appInfo;
  "lib/audioCatalog": typeof lib_audioCatalog;
  "lib/audioPrompt": typeof lib_audioPrompt;
  "lib/auth": typeof lib_auth;
  "lib/modelCatalog": typeof lib_modelCatalog;
  "lib/openrouterAudio": typeof lib_openrouterAudio;
  "lib/openrouterVideo": typeof lib_openrouterVideo;
  "lib/plannerPrompt": typeof lib_plannerPrompt;
  "lib/promptSummarizer": typeof lib_promptSummarizer;
  "lib/prompts/audio_song": typeof lib_prompts_audio_song;
  "lib/prompts/main_video_scene": typeof lib_prompts_main_video_scene;
  "lib/prompts/scene_summary": typeof lib_prompts_scene_summary;
  "lib/prompts/user_base_prompt": typeof lib_prompts_user_base_prompt;
  "lib/providers": typeof lib_providers;
  "lib/r2": typeof lib_r2;
  "lib/revisions": typeof lib_revisions;
  "lib/schemas": typeof lib_schemas;
  "lib/videoAdapters": typeof lib_videoAdapters;
  "lib/videoPlanMarkdown": typeof lib_videoPlanMarkdown;
  "studio/actions": typeof studio_actions;
  "studio/internal": typeof studio_internal;
  "studio/media": typeof studio_media;
  "studio/mutations": typeof studio_mutations;
  "studio/queries": typeof studio_queries;
  "studio/r2": typeof studio_r2;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
