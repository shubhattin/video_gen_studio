# R2 media storage

Studio media (reference images, generated videos, continuity frames) lives in **private Cloudflare R2**. Convex stores `objectKey` strings; browsers receive short-lived **presigned URLs**.

## Env (Convex only)

Set on the Convex deployment (not `VITE_*`, not required on Vercel for normal playback):

- `CLOUDFLARE_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

## Object key layout

```
studio/runs/<runId>/refs/<id>.<ext>
studio/runs/<runId>/videos/<id>.<ext>
studio/runs/<runId>/frames/<id>.<ext>
```

## Client flow

1. **Upload** — Convex action returns a presigned `PUT` URL → browser uploads directly to R2 → finalize action verifies the object.
2. **Read / play** — `studio.r2.getReadUrls` signs `GET` URLs; `useSignedMediaUrls` attaches them for `<video>` / `<img>`.
3. **Merge / download** — browser fetches signed R2 URLs directly (needs [CORS](./r2-cors.md)). If that fails, client falls back to Convex HTTP `GET /studio/media` with a Better Auth bearer JWT ([auth](./auth-convex.md)). Prefer fixing CORS so Convex is not in the hot path. `VIDEO_APP_ORIGIN` must match the app origin.
4. **Deletes** — mutations schedule `studio.r2.deleteObjects`.

## Checksums

AWS SDK v3 defaults can add `x-amz-checksum-mode=ENABLED` to signed GETs, which breaks browser `fetch`. The R2 client in `convex/lib/r2.ts` uses `requestChecksumCalculation` / `responseChecksumValidation`: `WHEN_REQUIRED`.

## Continuity frames (browser only)

Continuation compositions pause after each mid-clip so the **browser** extracts the terminal frame with WASM FFmpeg and uploads it to R2. The next clip starts only after that handoff. If the client goes offline (or the tab closes), generation stays paused until the studio page is open again.
