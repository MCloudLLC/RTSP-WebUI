import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * JSON-file backed application configuration store.
 *
 * Shape:
 * {
 *   version: 1,
 *   settings: { title, gridColumns },
 *   cameras: [ { id, name, mainUrl, subUrl, enabled, order } ]
 * }
 *
 * The shared password and signing secret are intentionally kept out of this
 * file (they live in environment variables) so exported config never leaks
 * credentials.
 */

const CONFIG_VERSION = 1;

function defaultDashboard() {
  return {
    layout: 'grid', // 'grid' | 'spotlight'
    gridSize: 'auto', // 'auto' | 1..6 (columns)
    fit: 'cover', // 'cover' | 'contain'
    gap: 'md', // 'sm' | 'md' | 'lg'
    showLabels: true,
    widgets: defaultWidgets(),
  };
}

function defaultWidgets() {
  return {
    clock: true,
    weather: {
      enabled: false,
      latitude: null,
      longitude: null,
      label: '',
      unit: 'celsius', // 'celsius' | 'fahrenheit'
    },
  };
}

function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    settings: {
      title: 'RTSP WebUI',
      gridColumns: 3,
      dashboard: defaultDashboard(),
    },
    cameras: [],
  };
}

export class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = defaultConfig();
  }

  async load() {
    if (existsSync(this.filePath)) {
      try {
        const raw = await readFile(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = this.#normalize(parsed);
      } catch (err) {
        throw new Error(`Failed to read config at ${this.filePath}: ${err.message}`);
      }
    } else {
      await this.save();
    }
    return this.data;
  }

  async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  get() {
    return this.data;
  }

  getSettings() {
    return this.data.settings;
  }

  async updateSettings(patch) {
    const clean = sanitizeSettings(patch);
    const dashboard = clean.dashboard
      ? mergeDashboard(this.data.settings.dashboard, clean.dashboard)
      : this.data.settings.dashboard;
    this.data.settings = {
      ...this.data.settings,
      ...clean,
      dashboard,
    };
    await this.save();
    return this.data.settings;
  }

  listCameras() {
    return [...this.data.cameras].sort((a, b) => a.order - b.order);
  }

  getCamera(id) {
    return this.data.cameras.find((c) => c.id === id) || null;
  }

  async addCamera(input) {
    const camera = sanitizeCamera({
      id: randomUUID(),
      order: this.data.cameras.length,
      enabled: true,
      ...input,
    });
    this.data.cameras.push(camera);
    await this.save();
    return camera;
  }

  async updateCamera(id, patch) {
    const idx = this.data.cameras.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    const merged = sanitizeCamera({ ...this.data.cameras[idx], ...patch, id });
    this.data.cameras[idx] = merged;
    await this.save();
    return merged;
  }

  async removeCamera(id) {
    const before = this.data.cameras.length;
    this.data.cameras = this.data.cameras.filter((c) => c.id !== id);
    const removed = this.data.cameras.length !== before;
    if (removed) await this.save();
    return removed;
  }

  /** Replace the entire config (used by import). Returns normalized data. */
  async replace(rawConfig) {
    this.data = this.#normalize(rawConfig);
    await this.save();
    return this.data;
  }

  #normalize(parsed) {
    const base = defaultConfig();
    const settings = { ...base.settings, ...sanitizeSettings(parsed?.settings) };
    settings.dashboard = mergeDashboard(
      base.settings.dashboard,
      sanitizeSettings(parsed?.settings).dashboard || {},
    );
    // Migrate legacy exports that only had gridColumns and no dashboard block.
    if (!parsed?.settings?.dashboard && parsed?.settings?.gridColumns != null) {
      const n = Number(parsed.settings.gridColumns);
      if (Number.isFinite(n)) settings.dashboard.gridSize = Math.min(6, Math.max(1, Math.round(n)));
    }
    const cameras = Array.isArray(parsed?.cameras)
      ? parsed.cameras.map((c, i) =>
          sanitizeCamera({
            id: c.id || randomUUID(),
            order: Number.isFinite(c.order) ? c.order : i,
            enabled: c.enabled !== false,
            ...c,
          }),
        )
      : [];
    return { version: CONFIG_VERSION, settings, cameras };
  }
}

function sanitizeSettings(patch = {}) {
  const out = {};
  if (typeof patch.title === 'string') out.title = patch.title.slice(0, 120);
  if (patch.gridColumns != null) {
    const n = Number(patch.gridColumns);
    if (Number.isFinite(n)) out.gridColumns = Math.min(6, Math.max(1, Math.round(n)));
  }
  if (patch.dashboard != null && typeof patch.dashboard === 'object') {
    out.dashboard = sanitizeDashboard(patch.dashboard);
  }
  return out;
}

function sanitizeDashboard(patch = {}) {
  const out = {};
  if (patch.layout === 'grid' || patch.layout === 'spotlight') out.layout = patch.layout;
  if (patch.gridSize != null) {
    if (patch.gridSize === 'auto') {
      out.gridSize = 'auto';
    } else {
      const n = Number(patch.gridSize);
      if (Number.isFinite(n)) out.gridSize = Math.min(6, Math.max(1, Math.round(n)));
    }
  }
  if (patch.fit === 'cover' || patch.fit === 'contain') out.fit = patch.fit;
  if (['sm', 'md', 'lg'].includes(patch.gap)) out.gap = patch.gap;
  if (patch.showLabels != null) out.showLabels = patch.showLabels !== false;
  if (patch.widgets != null && typeof patch.widgets === 'object') {
    out.widgets = sanitizeWidgets(patch.widgets);
  }
  return out;
}

function sanitizeWidgets(patch = {}) {
  const out = {};
  if (patch.clock != null) out.clock = patch.clock !== false;
  if (patch.weather != null && typeof patch.weather === 'object') {
    const w = patch.weather;
    const weather = {};
    if (w.enabled != null) weather.enabled = w.enabled !== false;
    if (w.latitude === null || w.latitude === '') {
      weather.latitude = null;
    } else if (w.latitude != null) {
      const n = Number(w.latitude);
      if (Number.isFinite(n) && n >= -90 && n <= 90) weather.latitude = n;
    }
    if (w.longitude === null || w.longitude === '') {
      weather.longitude = null;
    } else if (w.longitude != null) {
      const n = Number(w.longitude);
      if (Number.isFinite(n) && n >= -180 && n <= 180) weather.longitude = n;
    }
    if (typeof w.label === 'string') weather.label = w.label.slice(0, 80);
    if (w.unit === 'celsius' || w.unit === 'fahrenheit') weather.unit = w.unit;
    out.weather = weather;
  }
  return out;
}

/** Merge a sanitized dashboard patch onto an existing dashboard (deep for widgets). */
function mergeDashboard(base = {}, patch = {}) {
  const out = { ...base, ...patch };
  if (patch.widgets) {
    out.widgets = { ...base.widgets, ...patch.widgets };
    if (patch.widgets.weather) {
      out.widgets.weather = { ...base.widgets?.weather, ...patch.widgets.weather };
    }
  }
  return out;
}

function sanitizeCamera(input = {}) {
  return {
    id: String(input.id),
    name: String(input.name || 'Camera').slice(0, 120),
    mainUrl: String(input.mainUrl || '').trim(),
    subUrl: String(input.subUrl || '').trim(),
    enabled: input.enabled !== false,
    order: Number.isFinite(input.order) ? input.order : 0,
  };
}
