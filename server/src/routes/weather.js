import { getCurrentWeather, searchLocation } from '../weather.js';

export default async function weatherRoutes(fastify) {
  const { store } = fastify;

  // Current conditions for the configured location. 204 when not configured.
  fastify.get('/api/weather', async (request, reply) => {
    const weather = store.getSettings().dashboard?.widgets?.weather;
    if (!weather?.enabled || weather.latitude == null || weather.longitude == null) {
      reply.code(204);
      return null;
    }
    try {
      const data = await getCurrentWeather(weather.latitude, weather.longitude, weather.unit);
      return { ...data, label: weather.label || '' };
    } catch (err) {
      fastify.log.warn(`weather fetch failed: ${err.message}`);
      reply.code(502);
      return { error: 'Weather service unavailable' };
    }
  });

  // Geocode a place name -> [{ label, latitude, longitude }].
  fastify.get('/api/weather/search', async (request, reply) => {
    const q = String(request.query?.q || '').trim();
    if (q.length < 2) return [];
    try {
      return await searchLocation(q);
    } catch (err) {
      fastify.log.warn(`location search failed: ${err.message}`);
      reply.code(502);
      return { error: 'Location search unavailable' };
    }
  });
}
