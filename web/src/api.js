/** Tiny fetch wrapper for the backend API. */

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body != null) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, {
    ...options,
    headers,
  });
  if (res.status === 401) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.details = data?.details;
    throw err;
  }
  return data;
}

export const api = {
  authStatus: () => request('/api/auth/status'),
  login: (password) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  getSettings: () => request('/api/settings'),
  updateSettings: (patch) =>
    request('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  getWeather: () => request('/api/weather'),
  searchWeatherLocation: (q) => request(`/api/weather/search?q=${encodeURIComponent(q)}`),

  listCameras: () => request('/api/cameras'),
  addCamera: (cam) =>
    request('/api/cameras', { method: 'POST', body: JSON.stringify(cam) }),
  updateCamera: (id, patch) =>
    request(`/api/cameras/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteCamera: (id) => request(`/api/cameras/${id}`, { method: 'DELETE' }),
  reorderCameras: (ids) =>
    request('/api/cameras-order', { method: 'PUT', body: JSON.stringify({ order: ids }) }),

  exportConfigUrl: '/api/config/export',
  importConfig: (config) =>
    request('/api/config/import', { method: 'POST', body: JSON.stringify(config) }),
};
