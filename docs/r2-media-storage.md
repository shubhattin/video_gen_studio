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
2. **Read / play** — `studioR2.getReadUrls` signs `GET` URLs; `useSignedMediaUrls` attaches them for `<video>` / `<img>`.
3. **Merge / download** — browser fetches signed R2 URLs directly (needs [CORS](./r2-cors.md)). If that fails, client falls back to Convex HTTP `GET /studio/media` (proxy). Prefer fixing CORS so Convex is not in the hot path.
4. **Deletes** — mutations schedule `studioR2.deleteObjects`.

## Checksums

AWS SDK v3 defaults can add `x-amz-checksum-mode=ENABLED` to signed GETs, which breaks browser `fetch`. The R2 client in `convex/lib/r2.ts` uses `requestChecksumCalculation` / `responseChecksumValidation`: `WHEN_REQUIRED`.

## Optional video processor

Continuation mode can extract terminal frames in the browser. Optionally set `VIDEO_PROCESSOR_*` so Convex calls `/api/extract-terminal-frame` on the deployed app instead. See `.env.example`.
