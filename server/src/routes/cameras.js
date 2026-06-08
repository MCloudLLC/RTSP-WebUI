import { assertRtspUrl, streamNames } from '../streamUrl.js';

/**
 * Camera CRUD. Mutations validate RTSP URLs and keep go2rtc in sync.
 * Exposed (decorated) on fastify: `store` (ConfigStore), `go2rtc` (Go2rtc).
 */
export default async function cameraRoutes(fastify) {
  const { store, go2rtc } = fastify;

  // go2rtc may be temporarily unreachable (e.g. still starting). The app's
  // JSON config is the source of truth, so we always regenerate the yaml and
  // best-effort push to go2rtc without failing the request; the startup
  // reconcile loop converges any missed changes.
  async function syncGo2rtc(fn) {
    try {
      await go2rtc.generateYaml(store.get());
    } catch (err) {
      fastify.log.warn(`generateYaml failed: ${err.message}`);
    }
    try {
      await fn();
    } catch (err) {
      fastify.log.warn(`go2rtc sync failed: ${err.message}`);
    }
  }

  function toClient(cam) {
    const names = streamNames(cam.id);
    return {
      id: cam.id,
      name: cam.name,
      mainUrl: cam.mainUrl,
      subUrl: cam.subUrl,
      enabled: cam.enabled,
      order: cam.order,
      streams: {
        main: names.main,
        sub: cam.subUrl ? names.sub : null,
      },
    };
  }

  function validateBody(body, { partial = false } = {}) {
    const out = {};
    if (body.name != null) out.name = String(body.name);
    if (body.mainUrl != null || !partial) {
      out.mainUrl = assertRtspUrl(body.mainUrl, 'mainUrl');
    }
    if (body.subUrl != null && String(body.subUrl).trim() !== '') {
      out.subUrl = assertRtspUrl(body.subUrl, 'subUrl');
    } else if (body.subUrl != null) {
      out.subUrl = '';
    }
    if (body.enabled != null) out.enabled = body.enabled !== false;
    if (body.order != null) out.order = Number(body.order);
    return out;
  }

  fastify.get('/api/cameras', async () => store.listCameras().map(toClient));

  fastify.post('/api/cameras', async (request, reply) => {
    const input = validateBody(request.body || {});
    const cam = await store.addCamera(input);
    await syncGo2rtc(() => go2rtc.syncCamera(cam));
    reply.code(201);
    return toClient(cam);
  });

  fastify.put('/api/cameras/:id', async (request, reply) => {
    const { id } = request.params;
    if (!store.getCamera(id)) {
      reply.code(404);
      return { error: 'Camera not found' };
    }
    const patch = validateBody(request.body || {}, { partial: true });
    const cam = await store.updateCamera(id, patch);
    await syncGo2rtc(() => go2rtc.syncCamera(cam));
    return toClient(cam);
  });

  fastify.delete('/api/cameras/:id', async (request, reply) => {
    const { id } = request.params;
    const removed = await store.removeCamera(id);
    if (!removed) {
      reply.code(404);
      return { error: 'Camera not found' };
    }
    await syncGo2rtc(() => go2rtc.removeCamera(id));
    reply.code(204);
    return null;
  });

  // Persist a new ordering: body = { order: [id1, id2, ...] }
  fastify.put('/api/cameras-order', async (request) => {
    const order = Array.isArray(request.body?.order) ? request.body.order : [];
    let i = 0;
    for (const id of order) {
      if (store.getCamera(id)) await store.updateCamera(id, { order: i++ });
    }
    return store.listCameras().map(toClient);
  });
}
