import { validateRtspUrl } from '../streamUrl.js';

/**
 * Config export/import. Import is treated as UNTRUSTED: every camera URL is
 * re-validated and invalid cameras are rejected so a malicious file cannot
 * inject non-rtsp go2rtc sources.
 */
export default async function configIoRoutes(fastify) {
  const { store, go2rtc } = fastify;

  fastify.get('/api/config/export', async (request, reply) => {
    reply.header('Content-Disposition', 'attachment; filename="rtsp-webui-config.json"');
    reply.type('application/json');
    // Export does not contain secrets (password/secret live in env).
    return store.get();
  });

  fastify.post('/api/config/import', async (request, reply) => {
    const incoming = request.body;
    if (!incoming || typeof incoming !== 'object') {
      reply.code(400);
      return { error: 'Body must be a config object' };
    }

    const cameras = Array.isArray(incoming.cameras) ? incoming.cameras : [];
    const errors = [];
    cameras.forEach((cam, i) => {
      const main = validateRtspUrl(cam?.mainUrl);
      if (!main.ok) errors.push(`cameras[${i}].mainUrl: ${main.error}`);
      if (cam?.subUrl) {
        const sub = validateRtspUrl(cam.subUrl);
        if (!sub.ok) errors.push(`cameras[${i}].subUrl: ${sub.error}`);
      }
    });
    if (errors.length) {
      reply.code(400);
      return { error: 'Invalid config', details: errors };
    }

    const data = await store.replace(incoming);
    await go2rtc.generateYaml(data);
    await go2rtc.reconcile(data);
    return data;
  });
}
