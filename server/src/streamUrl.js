/**
 * RTSP URL validation and go2rtc source construction.
 *
 * Security: go2rtc supports powerful source types (exec:, ffmpeg:, http, etc.)
 * that would turn user-supplied config into a command-execution / SSRF surface.
 * We therefore accept ONLY rtsp:// and rtsps:// URLs and reject anything with
 * shell metacharacters or control characters. This applies to camera CRUD and
 * to imported config, which is treated as untrusted.
 */

const ALLOWED_SCHEMES = new Set(['rtsp:', 'rtsps:']);

// Characters that could be abused if the string is ever interpolated into a
// shell, an ffmpeg/exec source, or a YAML/HTTP context.
const FORBIDDEN_CHARS = /[\s`$;&|<>\\"'\n\r\t]/;

/**
 * Validate an RTSP(S) URL. Returns { ok: true, url } or { ok: false, error }.
 */
export function validateRtspUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, error: 'URL is required' };
  }
  if (value.length > 2048) {
    return { ok: false, error: 'URL is too long' };
  }
  if (FORBIDDEN_CHARS.test(value)) {
    return { ok: false, error: 'URL contains forbidden characters' };
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: 'URL is malformed' };
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, error: 'Only rtsp:// and rtsps:// URLs are allowed' };
  }
  if (!parsed.hostname) {
    return { ok: false, error: 'URL must include a host' };
  }
  return { ok: true, url: value };
}

/** Throwing variant for convenience in request handlers. */
export function assertRtspUrl(value, field = 'url') {
  const res = validateRtspUrl(value);
  if (!res.ok) {
    const err = new Error(`Invalid ${field}: ${res.error}`);
    err.statusCode = 400;
    throw err;
  }
  return res.url;
}

/**
 * Build a go2rtc source string from a validated RTSP URL.
 * `videoOnly` appends go2rtc's media filter to drop audio (used for grid
 * sub-streams to save client bandwidth/CPU).
 */
export function buildSource(url, { videoOnly = false } = {}) {
  const safe = assertRtspUrl(url, 'stream url');
  return videoOnly ? `${safe}#media=video` : safe;
}

/** Deterministic go2rtc stream names for a camera. */
export function streamNames(cameraId) {
  return {
    main: `cam_${cameraId}`,
    sub: `cam_${cameraId}_sub`,
  };
}
