# Auth and Convex infra

Studio identity lives in **Better Auth** (`tsc-users`), not in this repo. Convex only verifies RS256 JWTs. Do **not** install `@convex-dev/auth`.

```
Browser cookie → GET {VITE_BETTER_AUTH_URL}/api/auth/token → JWT
     → Convex websocket / HTTP Bearer
     → auth.config.ts (iss, aud, JWKS URL, RS256)
     → requireAdmin()  (role === "admin")
```

UI gate: `useJwtSession` / `getJwtSession`. A valid token proves login; `role` in the payload is the admin check. No `useSession`. Convex still confirms the JWT on the websocket. Implementation: `src/lib/jwt-session.ts`, `src/hooks/use-jwt-session.ts`, `src/components/auth-gate.tsx`.

## Env split

| Where | Vars | Used by |
| --- | --- | --- |
| Vite / `.env.local` | `VITE_CONVEX_URL`, `VITE_BETTER_AUTH_URL` | Browser only |
| Convex dashboard | `BETTER_AUTH_ISSUER`, `JWKS_ENDPOINT`, `VIDEO_APP_ORIGIN` | `auth.config.ts` + HTTP CORS |

`BETTER_AUTH_ISSUER` must equal JWT `iss` **and** `aud` (Better Auth base URL). `VITE_BETTER_AUTH_URL` should be that same origin so the browser fetches tokens that match.

`JWKS_ENDPOINT` is always a **public HTTPS URL** — Better Auth serves keys at `{issuer}/api/auth/jwks`. Convex Cloud fetches it itself and picks up key rotation on the next fetch. Do **not** paste JWKS JSON or a `data:` URI into env.

| Deployment | `BETTER_AUTH_ISSUER` / browser auth URL | `JWKS_ENDPOINT` | `VIDEO_APP_ORIGIN` |
| --- | --- | --- | --- |
| Local Convex dev | Better Auth origin that matches JWT `iss`/`aud` | `{that origin}/api/auth/jwks` (public HTTPS) | `http://localhost:3000` |
| Prod | Production Better Auth origin (Vercel custom domain) | `{that origin}/api/auth/jwks` | `https://video.thesanskritchannel.org` (no trailing slash) |

## JWKS URL requirements

Convex Cloud GETs `JWKS_ENDPOINT` itself. That is not your Vercel video app, and not curl on your laptop.

- Use a **normal public hostname** (hyphens/dots, no `_`) with a matching TLS cert. Underscores in tunnel labels (`better_auth_local_dev…`) fail Convex rustls even when curl works — use a hyphenated host or a real custom domain.
- Prefer the **production custom domain**, not `*.vercel.app` preview URLs, in `BETTER_AUTH_ISSUER` and `JWKS_ENDPOINT`. Preview hosts and Deployment Protection will 401 Convex.
- `/api/auth/jwks` must be **public** (no Vercel Authentication / SSO in front of it). If Convex gets HTTP 401/403, the dashboard will show JWKS fetch failed.
- Algorithm is **RS256** only. Issuer/audience must match the Better Auth origin that minted the token.

## What is guarded

Public Convex queries / mutations / actions (`studio/queries.ts`, `studio/mutations.ts`, `studio/actions.ts`, `studio/r2.ts`) and `GET /studio/media` call `requireAdmin`. Internals and scheduled clip generation stay unguarded (no user JWT on that path). There is no per-run ownership: any admin can see any run.

`/studio/media` is a CORS fallback for `fetch` / FFmpeg, not `<video src>`. It requires `Authorization: Bearer`. See [R2 media storage](./r2-media-storage.md).
