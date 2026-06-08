import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import httpProxy from '@fastify/http-proxy';

import { ConfigStore } from './config.js';
import { createAuth } from './auth.js';
import { Go2rtc } from './go2rtc.js';
import cameraRoutes from './routes/cameras.js';
import settingsRoutes from './routes/settings.js';
import configIoRoutes from './routes/configIO.js';
import weatherRoutes from './routes/weather.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || resolve(__dirname, '..', 'data');
const CONFIG_PATH = process.env.CONFIG_PATH || join(DATA_DIR, 'config.json');
const GO2RTC_YAML_PATH = process.env.GO2RTC_YAML_PATH || join(DATA_DIR, 'go2rtc.yaml');
const GO2RTC_API_URL = process.env.GO2RTC_API_URL || 'http://127.0.0.1:1984';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS) || 3650; // ~10 years
const SESSION_SECRET_PATH = process.env.SESSION_SECRET_PATH || join(DATA_DIR, 'session.secret');

/**
 * Resolve the cookie-signing secret. Prefer an explicit SESSION_SECRET env var;
 * otherwise generate one once and persist it next to the config so sessions
 * survive restarts (i.e. users stay logged in). Kept out of config.json so it
 * never leaks through config export/import.
 */
function resolveSessionSecret(log) {
  if (SESSION_SECRET) return SESSION_SECRET;
  try {
    if (existsSync(SESSION_SECRET_PATH)) {
      const existing = readFileSync(SESSION_SECRET_PATH, 'utf8').trim();
      if (existing) return existing;
    }
    const secret = randomBytes(32).toString('hex');
    mkdirSync(dirname(SESSION_SECRET_PATH), { recursive: true });
    writeFileSync(SESSION_SECRET_PATH, secret, { mode: 0o600 });
    log?.info('Generated a persistent session secret (sessions survive restarts).');
    return secret;
  } catch (err) {
    log?.warn(
      `Could not persist a session secret (${err.message}); logins will reset on restart. ` +
        'Set SESSION_SECRET to a fixed value to avoid this.'
    );
    return randomBytes(32).toString('hex');
  }
}

function resolveStaticDir() {
  if (process.env.STATIC_DIR) return process.env.STATIC_DIR;
  const candidates = [
    resolve(__dirname, '..', 'public'), // bundled in Docker image
    resolve(__dirname, '..', '..', 'web', 'dist'), // dev/monorepo
  ];
  return candidates.find((p) => existsSync(p)) || candidates[0];
}

async function main() {
  const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL || 'info' },
    bodyLimit: 5 * 1024 * 1024,
  });

  const store = new ConfigStore(CONFIG_PATH);
  await store.load();

  const auth = createAuth({
    password: APP_PASSWORD,
    secret: resolveSessionSecret(fastify.log),
    ttlMs: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  });

  const go2rtc = new Go2rtc({
    apiUrl: GO2RTC_API_URL,
    yamlPath: GO2RTC_YAML_PATH,
    apiListen: process.env.GO2RTC_API_LISTEN || ':1984',
    webrtcListen: process.env.GO2RTC_WEBRTC_LISTEN || ':8555',
    webrtcCandidate: process.env.GO2RTC_WEBRTC_CANDIDATE || '',
    binPath: process.env.GO2RTC_BIN || '',
    log: fastify.log,
  });

  fastify.decorate('store', store);
  fastify.decorate('auth', auth);
  fastify.decorate('go2rtc', go2rtc);

  await fastify.register(cookie);

  // ---- Auth gate for the API (login/status excluded) -----------------------
  const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/auth/status', '/api/health']);
  fastify.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const path = request.url.split('?')[0];
    if (PUBLIC_PATHS.has(path)) return;
    if (!auth.isAuthenticated(request)) {
      reply.code(401).send({ error: 'Authentication required' });
    }
  });

  // ---- Auth routes ---------------------------------------------------------
  fastify.get('/api/health', async () => ({ ok: true }));

  fastify.get('/api/auth/status', async (request) => ({
    authRequired: !auth.authDisabled,
    authenticated: auth.isAuthenticated(request),
  }));

  fastify.post('/api/auth/login', async (request, reply) => {
    const { password } = request.body || {};
    if (!auth.checkPassword(password)) {
      reply.code(401);
      return { error: 'Invalid password' };
    }
    reply.setCookie(auth.cookieName, auth.issueToken(), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(auth.ttlMs / 1000),
    });
    return { ok: true };
  });

  fastify.post('/api/auth/logout', async (request, reply) => {
    reply.clearCookie(auth.cookieName, { path: '/' });
    return { ok: true };
  });

  // ---- Feature routes ------------------------------------------------------
  await fastify.register(cameraRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(configIoRoutes);
  await fastify.register(weatherRoutes);

  // ---- go2rtc reverse proxy (API + WebRTC signaling websocket) -------------
  // Browser connects to /go2rtc/api/ws?src=<stream>; auth is enforced on both
  // the HTTP requests and the websocket upgrade so go2rtc's 1984 port never
  // needs to be exposed.
  await fastify.register(httpProxy, {
    upstream: GO2RTC_API_URL,
    prefix: '/go2rtc',
    rewritePrefix: '',
    websocket: true,
    preHandler: (request, reply, done) => {
      if (!auth.isAuthenticated(request)) {
        reply.code(401).send({ error: 'Authentication required' });
        return;
      }
      done();
    },
    wsServerOptions: {
      verifyClient: (info, cb) => {
        if (auth.authDisabled) return cb(true);
        const raw = info.req.headers.cookie || '';
        const token = parseCookie(raw)[auth.cookieName];
        return cb(auth.verifyToken(token));
      },
    },
  });

  // ---- Static SPA ----------------------------------------------------------
  const staticDir = resolveStaticDir();
  if (existsSync(staticDir)) {
    await fastify.register(fastifyStatic, { root: staticDir, wildcard: false });
    // SPA fallback for client-side routes.
    fastify.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/go2rtc/')) {
        reply.code(404).send({ error: 'Not found' });
        return;
      }
      reply.sendFile('index.html');
    });
  } else {
    fastify.log.warn(`Static dir not found at ${staticDir}; UI will not be served`);
  }

  // ---- Bootstrap go2rtc ----------------------------------------------------
  try {
    await go2rtc.generateYaml(store.get());
  } catch (err) {
    fastify.log.error(`Failed to generate go2rtc.yaml: ${err.message}`);
  }
  go2rtc.startProcess();
  reconcileWithRetry(go2rtc, store, fastify.log);

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      go2rtc.stopProcess();
      fastify.close().finally(() => process.exit(0));
    });
  }

  await fastify.listen({ port: PORT, host: HOST });
  if (auth.authDisabled) {
    fastify.log.warn('APP_PASSWORD is not set: authentication is DISABLED.');
  }
}

/** Retry reconcile because go2rtc may start slightly after the backend. */
function reconcileWithRetry(go2rtc, store, log, attempt = 0) {
  go2rtc
    .ping()
    .then(async (up) => {
      if (up) {
        await go2rtc.reconcile(store.get());
        log.info('go2rtc reconciled');
      } else if (attempt < 30) {
        setTimeout(() => reconcileWithRetry(go2rtc, store, log, attempt + 1), 2000);
      } else {
        log.warn('go2rtc not reachable; streams not reconciled');
      }
    })
    .catch((err) => log.warn(`go2rtc reconcile error: ${err.message}`));
}

function parseCookie(header) {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
