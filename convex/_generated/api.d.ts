/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_modelCatalog from "../lib/modelCatalog.js";
import type * as lib_openrouterVideo from "../lib/openrouterVideo.js";
import type * as lib_plannerPrompt from "../lib/plannerPrompt.js";
import type * as lib_providers from "../lib/providers.js";
import type * as lib_r2 from "../lib/r2.js";
import type * as lib_schemas from "../lib/schemas.js";
import type * as lib_videoAdapters from "../lib/videoAdapters.js";
import type * as lib_videoPlanMarkdown from "../lib/videoPlanMarkdown.js";
import type * as studio_actions from "../studio/actions.js";
import type * as studio_internal from "../studio/internal.js";
import type * as studio_mutations from "../studio/mutations.js";
import type * as studio_queries from "../studio/queries.js";
import type * as studio_r2 from "../studio/r2.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/modelCatalog": typeof lib_modelCatalog;
  "lib/openrouterVideo": typeof lib_openrouterVideo;
  "lib/plannerPrompt": typeof lib_plannerPrompt;
  "lib/providers": typeof lib_providers;
  "lib/r2": typeof lib_r2;
  "lib/schemas": typeof lib_schemas;
  "lib/videoAdapters": typeof lib_videoAdapters;
  "lib/videoPlanMarkdown": typeof lib_videoPlanMarkdown;
  "studio/actions": typeof studio_actions;
  "studio/internal": typeof studio_internal;
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
