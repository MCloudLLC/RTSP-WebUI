/**
 * Weather + location lookup via Open-Meteo (free, no API key required).
 *
 * Outbound calls go to api.open-meteo.com / geocoding-api.open-meteo.com.
 * Results are cached in-memory so many viewers share a single fetch and we
 * stay well within the free tier. Everything is best-effort: callers should
 * treat failures as "no weather" rather than errors that block the UI.
 */

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const FETCH_TIMEOUT_MS = 8000;

const cache = new Map(); // key -> { ts, data }

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Search place names. Returns a short list of { label, latitude, longitude }.
 * @param {string} query
 */
export async function searchLocation(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const url = `${GEO_URL}?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
  const json = await fetchJson(url);
  return (json.results || []).map((r) => ({
    label: [r.name, r.admin1, r.country_code].filter(Boolean).join(', '),
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

/**
 * Current conditions for a coordinate. Cached per (lat, lon, unit).
 * @param {number} latitude
 * @param {number} longitude
 * @param {'celsius'|'fahrenheit'} [unit]
 */
export async function getCurrentWeather(latitude, longitude, unit = 'celsius') {
  const tempUnit = unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const key = `${latitude},${longitude},${tempUnit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;

  const url =
    `${FORECAST_URL}?latitude=${encodeURIComponent(latitude)}` +
    `&longitude=${encodeURIComponent(longitude)}` +
    `&current=temperature_2m,weather_code,is_day&temperature_unit=${tempUnit}&timezone=auto`;
  const json = await fetchJson(url);
  const cur = json.current || {};
  const isDay = cur.is_day !== 0;
  const data = {
    temperature: typeof cur.temperature_2m === 'number' ? Math.round(cur.temperature_2m) : null,
    unit: tempUnit === 'fahrenheit' ? '°F' : '°C',
    code: cur.weather_code ?? null,
    isDay,
    description: describeWeather(cur.weather_code),
    icon: weatherIcon(cur.weather_code, isDay),
  };
  cache.set(key, { ts: Date.now(), data });
  return data;
}

// WMO weather interpretation codes -> short text + emoji.
// https://open-meteo.com/en/docs (Weather variable documentation)
function describeWeather(code) {
  const map = {
    0: 'Clear',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Rime fog',
    51: 'Light drizzle',
    53: 'Drizzle',
    55: 'Heavy drizzle',
    56: 'Freezing drizzle',
    57: 'Freezing drizzle',
    61: 'Light rain',
    63: 'Rain',
    65: 'Heavy rain',
    66: 'Freezing rain',
    67: 'Freezing rain',
    71: 'Light snow',
    73: 'Snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Rain showers',
    81: 'Rain showers',
    82: 'Violent showers',
    85: 'Snow showers',
    86: 'Snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm',
    99: 'Thunderstorm',
  };
  return map[code] || 'Unknown';
}

function weatherIcon(code, isDay) {
  if (code === 0 || code === 1) return isDay ? '☀️' : '🌙';
  if (code === 2) return isDay ? '⛅' : '☁️';
  if (code === 3 || code === 45 || code === 48) return '☁️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌧️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}
