export default async function settingsRoutes(fastify) {
  const { store } = fastify;

  fastify.get('/api/settings', async () => store.getSettings());

  fastify.put('/api/settings', async (request) => {
    return store.updateSettings(request.body || {});
  });
}
