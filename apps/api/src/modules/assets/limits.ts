/** Per-workspace limits (D-038). Checked when an intent is created and again when it completes. */
export const WORKSPACE_QUOTA = {
  maxBytes: 2 * 1024 * 1024 * 1024,
  maxAssets: 500,
  maxOpenIntents: 20,
} as const;

/** How long a signed upload URL stays valid. */
export const UPLOAD_TTL_SECONDS = 10 * 60;
/** Signed media URLs live this long; `exp` is rounded up to a bucket so browsers can cache them. */
export const MEDIA_URL_TTL_SECONDS = 15 * 60;
export const MEDIA_EXP_BUCKET_SECONDS = 5 * 60;
/** Unfinished uploads older than this are removed by the sweeper. */
export const STALE_INTENT_SECONDS = 60 * 60;
