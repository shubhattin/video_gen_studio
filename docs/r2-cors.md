# R2 CORS setup

Browser requests to Cloudflare R2 (presigned `GET` / `PUT`) need a bucket CORS policy. Without it, merges, downloads, uploads, and canvas/ffmpeg continuity frames fail with “No `Access-Control-Allow-Origin`”.

Reference files in the repo:

- Dashboard paste format: [`scripts/r2-cors.dashboard.json`](../scripts/r2-cors.dashboard.json)
- Wrangler format: [`scripts/r2-cors.wrangler.json`](../scripts/r2-cors.wrangler.json)

## Recommended policy

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://YOUR_APP.vercel.app",
      "https://YOUR_CUSTOM_DOMAIN.com"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": [
      "ETag",
      "Content-Length",
      "Content-Type",
      "Content-Range",
      "Accept-Ranges"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

| Field | Why |
| --- | --- |
| `AllowedOrigins` | Exact app origins only. R2 does **not** support `*.vercel.app` wildcards. |
| `GET` / `HEAD` | Playback, merge fetch, downloads, continuity-frame load |
| `PUT` | Reference / terminal-frame uploads via presigned URLs |
| `AllowedHeaders: ["*"]` | Covers `Content-Type`, `Range`, and SDK quirks |
| `ExposeHeaders` | Lets JS read length / type / range for media tooling |

## Apply via dashboard

1. Cloudflare → **R2** → your bucket → **Settings**
2. **CORS Policy** → edit JSON → paste the policy → **Save**

## Apply via Wrangler

```bash
bunx wrangler r2 bucket cors set "$R2_BUCKET_NAME" --file scripts/r2-cors.wrangler.json
bunx wrangler r2 bucket cors list "$R2_BUCKET_NAME"
```

Add production origins to the JSON before shipping.

## Checklist if CORS still fails

1. Confirm the failing request’s `Origin` is listed exactly (scheme + host + port).
2. If the console also shows `403`/`401`, fix signing / expiry first — R2 often omits CORS headers on error responses, which looks like a CORS bug.
3. Presigned GETs must not require `x-amz-checksum-mode` from the browser (this project sets S3 checksum mode to `WHEN_REQUIRED` in `convex/lib/r2.ts`).
4. After changing CORS, hard-refresh the app (and retry with `cache: "no-store"` fetches if a stale `304` appears).

Official docs: [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
