# Composition player

Simple per-clip preview for composed runs.

- Fixed aspect-ratio stage (avoids layout shift when switching clips)
- Nav: `‹ |1| |2| ›` — jump to a clip; prev/next disabled at the ends
- Clip mode does **not** auto-advance when a clip ends
- **View full video** — merges clips in-browser (FFmpeg) into a `blob:` URL and plays it
- **Download merged MP4** — same merge path; reuses the cached blob if View/Download already ran
- Cache key is the set of clip `objectKey`s / URLs; changes when clips change

Implementation: `src/components/studio/composition/composition-clip-player.tsx`, `composition-result.tsx`, `src/lib/merge-composition-videos.ts`
