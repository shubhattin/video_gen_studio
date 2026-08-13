# Auth and Convex infra

Studio identity lives in **Better Auth** (`tsc-users`), not in this repo. Convex only verifies RS256 JWTs. Do **not** install `@convex-dev/auth`.

```
Browser cookie → GET {VITE_BETTER_AUTH_URL}/api/auth/token → JWT
     → Convex websocket / HTTP Bearer
     → auth.config.ts (iss, aud, JWKS, RS256)
     → requireAdmin()  (role === "admin")
```

UI gate: Google session + `role === "admin"`, then wait until Convex accepts the token (`Authenticated` / `AuthLoading`). Implementation: `src/components/auth-gate.tsx`, `src/hooks/use-convex-auth.ts`, `convex/auth.config.ts`, `convex/lib/auth.ts`.

## Env split

| Where | Vars | Used by |
| --- | --- | --- |
| Vite / `.env.local` | `VITE_CONVEX_URL`, `VITE_BETTER_AUTH_URL` | Browser only |
| Convex dashboard | `BETTER_AUTH_ISSUER`, `JWKS_ENDPOINT`, `VIDEO_APP_ORIGIN` | `auth.config.ts` + HTTP CORS |

`BETTER_AUTH_ISSUER` must equal JWT `iss` **and** `aud` (Better Auth base URL). `VITE_BETTER_AUTH_URL` should be that same origin so the browser fetches tokens that match.

| Deployment | `BETTER_AUTH_ISSUER` / browser auth URL | `JWKS_ENDPOINT` | `VIDEO_APP_ORIGIN` |
| --- | --- | --- | --- |
| Local Convex dev | `http://localhost:5188` | Data URI (see below) or a hyphenated public host | `http://localhost:3000` |
| Prod | Production Better Auth origin (Vercel custom domain) | `{that origin}/api/auth/jwks` | `https://video.thesanskritchannel.org` (no trailing slash) |

## Production / Vercel

A Vercel-hosted Better Auth URL **does** work for Convex JWKS fetch, as long as it is a normal public hostname (hyphens/dots, no `_`) with a matching TLS cert.

Convex Cloud GETs `{origin}/api/auth/jwks` itself. That is not your Vercel video app, and not curl on your laptop.

Caveats:

- Use the **production custom domain**, not `*.vercel.app` preview URLs, in `BETTER_AUTH_ISSUER` and `JWKS_ENDPOINT`. Preview hosts and Deployment Protection will 401 Convex.
- `/api/auth/jwks` must be **public** (no Vercel Authentication / SSO in front of it). If Convex gets HTTP 401/403, the dashboard will show JWKS fetch failed.
- Prod should use the **HTTPS JWKS URL**, not a data URI. Convex will pick up key rotation on its next fetch.
- Algorithm is **RS256** only. Issuer/audience must be the production Better Auth origin, not `localhost`.
- The underscore TLS failure is a **local tunnel** problem (`better_auth_local_dev…` vs `*.domain`). It does not apply to `auth.example.com` on Vercel.

## Local JWKS data URI (dev only)

Local tunnel hostnames with `_` fail Convex rustls even when curl works. Dev workaround: put the JWKS JSON in `JWKS_ENDPOINT` as a data URI so Convex never fetches.

Refresh this whenever Better Auth rotates keys (new `kid` in `/api/auth/jwks`), or tokens start failing with JWKS / signature errors.

From the video repo, against the **dev** deployment in `.env.local` (`CONVEX_DEPLOYMENT=dev:…`):

```bash
# 1. Confirm the JWKS looks like RS256 (curl is fine here — you are only copying JSON)
curl -sS --fail "https://YOUR_TUNNEL_OR_AUTH_ORIGIN/api/auth/jwks"

# 2. Encode and set on the Convex *dev* deployment (bunx, not npx)
JWKS_URL="https://YOUR_TUNNEL_OR_AUTH_ORIGIN/api/auth/jwks"
JWKS=$(curl -sS --fail "$JWKS_URL")
B64=$(printf '%s' "$JWKS" | base64 -w0)   # macOS: base64 | tr -d '\n'
bunx convex env set JWKS_ENDPOINT "data:text/plain;charset=utf-8;base64,${B64}"

# 3. Confirm
bunx convex env get JWKS_ENDPOINT | head -c 80; echo
```

Leave `BETTER_AUTH_ISSUER=http://localhost:5188` so it still matches the JWT `iss`/`aud`. `convex env set` applies to the deployment in `.env.local`; do not pass `--prod` unless you intend to change production.

If `bunx convex dev` is running, wait for it to pick up the env (auth config is substituted at push). Then refresh the studio.

Do **not** commit the data URI. It is dashboard env only.

## What is guarded

Public Convex queries / mutations / actions (`studio.ts`, `studioActions.ts`, `studioR2.ts`) and `GET /studio/media` call `requireAdmin`. Internals and scheduled clip generation stay unguarded (no user JWT on that path). There is no per-run ownership: any admin can see any run.

`/studio/media` is a CORS fallback for `fetch` / FFmpeg, not `<video src>`. It requires `Authorization: Bearer`. See [R2 media storage](./r2-media-storage.md).
