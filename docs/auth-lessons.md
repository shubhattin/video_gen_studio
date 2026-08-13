# Auth integration lessons

What went wrong after a correct plan. Use with [auth-convex.md](./auth-convex.md).

The design was never the problem: external Better Auth, RS256 JWT into `ConvexProviderWithAuth`, `customJwt` in `auth.config.ts`, admin-only public functions, no `@convex-dev/auth`. Failures were env, TLS, typecheck, and when queries fire.

## Do not over-scope the token

Early drafts added per-app `aud` (`urn:…:video`) and a custom token route. That would have broken every other app on the same Better Auth server. Keep default `iss`/`aud` = Better Auth base URL. Scope in Convex with `requireAdmin`, not a new audience, until a second trust boundary exists.

JWKS is one public key set. Scope is the JWT `aud` claim, not a per-app JWKS.

## Convex Cloud is not your laptop

Hosted Convex cannot fetch `http://localhost:5188`. JWKS must be a public HTTPS URL **or** a data URI.

Issuer and JWKS URL can differ. Local JWT `iss` is `http://localhost:5188`; Convex fetches JWKS from a tunnel. Do **not** derive `jwks` as `` `${issuer}/api/auth/jwks` `` — that points Convex at localhost.

`BETTER_AUTH_ISSUER` / `JWKS_ENDPOINT` live on the **Convex dashboard**, not in Vite. Unset issuer → “no providers configured”. Empty `?? ""` can deploy a blank provider and look the same.

## Typecheck can deploy a broken auth config

Convex `dev` default `--typecheck=try` still pushes when `tsc` fails.

- Root `tsconfig` `"types": ["vite/client"]` hides Node `process` → `TS2591` in `auth.config.ts`.
- Fix: `convex/tsconfig.json` `"types": ["node"]`, exclude `convex/` from the root tsconfig.
- After Node types, `process.env.X` is `string | undefined`. Use `process.env.X!` (Convex substitutes the name at deploy). Keep the exact `process.env.BETTER_AUTH_ISSUER` spelling so substitution works.

Do not treat “Convex functions ready” as “auth.config is valid”.

## Curl ≠ Convex can fetch JWKS

Error: `Could not fetch JWKS … error sending request for url`.

Convex uses rustls. Curl/OpenSSL accept `_` under `*.domain`. rustls does not (`better_auth_local_dev…` vs `*.shubhattin.in`). Python `ssl` reproduces the hostname mismatch.

Fix: hyphenated tunnel hostname, or JWKS as `data:text/plain;charset=utf-8;base64,…` (refresh with curl + `bunx convex env set` — see [auth-convex.md](./auth-convex.md)). Better Auth must issue **RS256** (not default EdDSA). Changing `alg` requires a new key in the `jwks` table, not only a config edit. Prod Vercel custom domains do not need the data URI.

## Queries race the JWT

Better Auth session ≠ Convex identity. `AuthGate` letting an admin through still lets `useQuery` run with `getUserIdentity() === null` → `Not authenticated.`

Hiding JSX with `Activity` does not skip hooks in the **parent** route. Use `Authenticated` / `AuthLoading` / `Unauthenticated` so studio pages mount only after Convex accepts the token. Memoize `fetchAccessToken` (`useCallback` + `useMemo`) or `setAuth` re-runs every render.

## Media proxy

`GET /studio/media` with `Access-Control-Allow-Origin: *` is public once you know `runId` + `objectKey`. Require Bearer + `requireAdmin`; CORS origin = `VIDEO_APP_ORIGIN`. `<video src>` still uses presigned R2; the proxy is fetch/FFmpeg fallback only.

## Skills trap

The bundled `convex-auth` skill installs `@convex-dev/auth`. This app must not. Prefer Convex **custom JWT** docs + `convex-env` + [auth debug](https://docs.convex.dev/auth/debug.md) (`getUserIdentity` null, dashboard Authentication providers, JWT `iss`/`aud` vs config).
