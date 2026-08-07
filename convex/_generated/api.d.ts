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
import type * as lib_modelCatalog from "../lib/modelCatalog.js";
import type * as lib_openrouterVideo from "../lib/openrouterVideo.js";
import type * as lib_providers from "../lib/providers.js";
import type * as lib_schemas from "../lib/schemas.js";
import type * as lib_videoAdapters from "../lib/videoAdapters.js";
import type * as studio from "../studio.js";
import type * as studioActions from "../studioActions.js";
import type * as studioInternal from "../studioInternal.js";
import type * as studioQueries from "../studioQueries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  http: typeof http;
  "lib/modelCatalog": typeof lib_modelCatalog;
  "lib/openrouterVideo": typeof lib_openrouterVideo;
  "lib/providers": typeof lib_providers;
  "lib/schemas": typeof lib_schemas;
  "lib/videoAdapters": typeof lib_videoAdapters;
  studio: typeof studio;
  studioActions: typeof studioActions;
  studioInternal: typeof studioInternal;
  studioQueries: typeof studioQueries;
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
