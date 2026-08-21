# R2 media storage

Studio media (reference images, generated videos, continuity frames) lives in **private Cloudflare R2**. Convex stores `objectKey` strings on **shared gallery** tables (`galleryImages`, `galleryVideos`); browsers receive short-lived **presigned URLs**.

Runs only *attach* gallery IDs. Deleting a run or removing an image from a run unlinks text/plan data — it does **not** delete R2 objects. Hard-delete from the gallery (or `wipeAllStudioData`) is what removes files.

## Env (Convex only)

Set on the Convex deployment (not `VITE_*`, not required on Vercel for normal playback):

- `CLOUDFLARE_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

## Object key layout

```
studio/gallery/images/<id>.<ext>
studio/gallery/videos/<id>.<ext>
studio/gallery/frames/<id>.<ext>
```

## Client flow

1. **Upload** — Convex action returns a presigned `PUT` URL → browser uploads directly to R2 → finalize action inserts a `galleryImages` row and attaches it to the run.
2. **Read / play** — `studio.r2.getReadUrls` signs `GET` URLs for keys that exist in the gallery; `useSignedMediaUrls` attaches them for `<video>` / `<img>`.
3. **Merge / download** — browser fetches signed R2 URLs directly (needs [CORS](./r2-cors.md)). If that fails, client falls back to Convex HTTP `GET /studio/media?objectKey=…` with a Better Auth bearer JWT ([auth](./auth-convex.md)). Prefer fixing CORS so Convex is not in the hot path. `VIDEO_APP_ORIGIN` must match the app origin.
4. **Deletes** — run delete does not schedule R2 deletes. Gallery hard-delete and `wipeAllStudioData` schedule `studio.r2.deleteObjects`.

## Wipe (dev / prod)

All media lives in the `galleryImages` / `galleryVideos` tables and runs reference them with strict
`v.id("galleryImages")` ids (`firstFrameImageId` / `lastFrameImageId` / `extraReferenceImageIds`).
The old embedded-media fields, client-generated `img_*` id fallbacks, and the one-time
`migrateLegacyStudioMedia` migration have been removed — the wipe below was run before that change.

To start over:

1. Call admin mutation `studio.mutations.wipeAllStudioData` on **dev**.
2. Deploy the new functions.
3. Repeat on **prod**.

Wipe clears runs, plans, composition rows, gallery tables, catalog cache, and the corresponding R2 objects. `GET /studio/media` allows any `studio/…` key that exists in the gallery.

## Checksums

AWS SDK v3 defaults can add `x-amz-checksum-mode=ENABLED` to signed GETs, which breaks browser `fetch`. The R2 client in `convex/lib/r2.ts` uses `requestChecksumCalculation` / `responseChecksumValidation`: `WHEN_REQUIRED`.

## Continuity frames (browser only)

Continuation compositions pause after each mid-clip so the **browser** extracts the terminal frame with WASM FFmpeg and uploads it to R2 as a gallery image (`source: terminal_frame`). The next clip starts only after that handoff. If the client goes offline (or the tab closes), generation stays paused until the studio page is open again.
