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

Local example: issuer `http://localhost:5188`, JWKS on a public hostname Convex Cloud can TLS-verify (or a data URI). Prod: issuer = production Better Auth URL; `VIDEO_APP_ORIGIN` = `https://video.thesanskritchannel.org` (no trailing slash).

## JWKS fetch (Convex Cloud, not your laptop)

Convex fetches `JWKS_ENDPOINT` with rustls. Curl succeeding locally is not enough.

- Hostname must be a valid DNS label (**hyphens**, not underscores). `better_auth_local_dev.example.com` fails wildcard cert match (`*.example.com`); `better-auth-local-dev.example.com` works.
- Workaround: set `JWKS_ENDPOINT` to a data URI  
  `data:text/plain;charset=utf-8;base64,<jwks json>`  
  Refresh it if Better Auth rotates keys.

Algorithm is **RS256** only.

## What is guarded

Public Convex queries / mutations / actions (`studio.ts`, `studioActions.ts`, `studioR2.ts`) and `GET /studio/media` call `requireAdmin`. Internals and scheduled clip generation stay unguarded (no user JWT on that path). There is no per-run ownership: any admin can see any run.

`/studio/media` is a CORS fallback for `fetch` / FFmpeg, not `<video src>`. It requires `Authorization: Bearer`. See [R2 media storage](./r2-media-storage.md).
