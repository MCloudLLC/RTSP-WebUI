import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * Minimal single-shared-password auth.
 *
 * A successful login issues a signed, time-limited token stored in an
 * httpOnly cookie. Tokens are stateless: `<expiryMs>.<hmac>`.
 */

const COOKIE_NAME = 'rtsp_session';
// Effectively "stay signed in until you log out" for a home-network app. The
// browser may still cap the cookie's own lifetime (Chrome clamps to ~400 days),
// after which the user logs in once more. Override with SESSION_TTL_DAYS.
const DEFAULT_TTL_MS = 3650 * 24 * 60 * 60 * 1000; // ~10 years

export function createAuth({ password, secret, ttlMs = DEFAULT_TTL_MS }) {
  if (!secret) {
    // Ephemeral secret: sessions invalidate on restart, which is acceptable.
    secret = randomBytes(32).toString('hex');
  }
  const authDisabled = !password;

  function sign(expiry) {
    const mac = createHmac('sha256', secret).update(String(expiry)).digest('hex');
    return `${expiry}.${mac}`;
  }

  function issueToken() {
    return sign(Date.now() + ttlMs);
  }

  function verifyToken(token) {
    if (!token || typeof token !== 'string') return false;
    const dot = token.indexOf('.');
    if (dot === -1) return false;
    const expiry = token.slice(0, dot);
    const mac = token.slice(dot + 1);
    const expected = createHmac('sha256', secret).update(expiry).digest('hex');
    if (!safeEqualHex(mac, expected)) return false;
    return Number(expiry) > Date.now();
  }

  function checkPassword(candidate) {
    if (authDisabled) return true;
    if (typeof candidate !== 'string') return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(password);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  function isAuthenticated(request) {
    if (authDisabled) return true;
    return verifyToken(request.cookies?.[COOKIE_NAME]);
  }

  return {
    cookieName: COOKIE_NAME,
    authDisabled,
    ttlMs,
    issueToken,
    verifyToken,
    checkPassword,
    isAuthenticated,
  };
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}
