import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const emptyForm = { name: '', mainUrl: '', subUrl: '', enabled: true };

const DEFAULT_WIDGETS = {
  clock: true,
  weather: { enabled: false, latitude: null, longitude: null, label: '', unit: 'celsius' },
};

export default function Settings() {
  const [cameras, setCameras] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [widgets, setWidgets] = useState(DEFAULT_WIDGETS);
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    const cams = await api.listCameras();
    setCameras(cams);
  };

  useEffect(() => {
    load();
    api
      .getSettings()
      .then((s) => setWidgets({ ...DEFAULT_WIDGETS, ...(s.dashboard?.widgets || {}) }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.updateCamera(editingId, form);
        setNotice('Camera updated');
      } else {
        await api.addCamera(form);
        setNotice('Camera added');
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err.details ? `${err.message}: ${err.details.join(', ')}` : err.message);
    }
  };

  const edit = (cam) => {
    setEditingId(cam.id);
    setForm({ name: cam.name, mainUrl: cam.mainUrl, subUrl: cam.subUrl, enabled: cam.enabled });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (cam) => {
    if (!confirm(`Delete "${cam.name}"?`)) return;
    await api.deleteCamera(cam.id);
    if (editingId === cam.id) resetForm();
    await load();
    setNotice('Camera deleted');
  };

  const toggleEnabled = async (cam) => {
    await api.updateCamera(cam.id, { enabled: !cam.enabled });
    await load();
    setNotice(cam.enabled ? 'Camera disabled' : 'Camera enabled');
  };

  const onImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      await api.importConfig(JSON.parse(text));
      setNotice('Config imported');
      await load();
      const s = await api.getSettings();
      setWidgets({ ...DEFAULT_WIDGETS, ...(s.dashboard?.widgets || {}) });
    } catch (err) {
      setError(err.details ? `${err.message}: ${err.details.join(', ')}` : err.message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveWidgets = async (next) => {
    setWidgets(next);
    try {
      await api.updateSettings({ dashboard: { widgets: next } });
      setNotice('Widgets saved');
    } catch (err) {
      setError(err.message);
    }
  };

  const setClock = (on) => saveWidgets({ ...widgets, clock: on });
  const setWeather = (patch) =>
    saveWidgets({ ...widgets, weather: { ...widgets.weather, ...patch } });

  const searchPlace = async () => {
    const q = placeQuery.trim();
    if (q.length < 2) return;
    setSearching(true);
    setError('');
    try {
      const results = await api.searchWeatherLocation(q);
      setPlaceResults(Array.isArray(results) ? results : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const choosePlace = (place) => {
    setWeather({ latitude: place.latitude, longitude: place.longitude, label: place.label });
    setPlaceResults([]);
    setPlaceQuery('');
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 sm:p-6">
      {/* Camera form */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-white">
          {editingId ? 'Edit camera' : 'Add camera'}
        </h2>
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <Field label="Name">
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Front door"
              className={inputCls}
            />
          </Field>
          <Field label="Main stream URL" hint="High quality — used in fullscreen">
            <input
              required
              value={form.mainUrl}
              onChange={(e) => setForm({ ...form, mainUrl: e.target.value })}
              placeholder="rtsp://user:pass@192.168.1.50:554/stream1"
              className={inputCls}
            />
          </Field>
          <Field label="Sub stream URL" hint="Low quality — used in the grid (optional)">
            <input
              value={form.subUrl}
              onChange={(e) => setForm({ ...form, subUrl: e.target.value })}
              placeholder="rtsp://user:pass@192.168.1.50:554/stream2"
              className={inputCls}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Enabled
          </label>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
            >
              {editingId ? 'Save changes' : 'Add camera'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      {/* Camera list */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-white">Cameras ({cameras.length})</h2>
        <div className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          {cameras.length === 0 && (
            <p className="p-4 text-sm text-slate-500">No cameras yet.</p>
          )}
          {cameras.map((cam) => (
            <div key={cam.id} className="flex items-center gap-3 p-3">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  cam.enabled ? 'bg-emerald-500' : 'bg-slate-600'
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{cam.name}</p>
                <p className="truncate text-xs text-slate-500">{cam.mainUrl}</p>
              </div>
              <button onClick={() => toggleEnabled(cam)} className={smallBtn}>
                {cam.enabled ? 'Disable' : 'Enable'}
              </button>
              <button onClick={() => edit(cam)} className={smallBtn}>
                Edit
              </button>
              <button
                onClick={() => remove(cam)}
                className="rounded-md px-2.5 py-1 text-xs text-rose-400 hover:bg-rose-500/10"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Widgets */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-white">Dashboard widgets</h2>
        <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={widgets.clock !== false}
              onChange={(e) => setClock(e.target.checked)}
            />
            Show clock (time &amp; date)
          </label>

          <div className="border-t border-slate-800 pt-4">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={widgets.weather?.enabled === true}
                onChange={(e) => setWeather({ enabled: e.target.checked })}
              />
              Show weather
            </label>

            {widgets.weather?.enabled && (
              <div className="mt-3 space-y-3 pl-6">
                <div>
                  <span className="mb-1 block text-xs text-slate-500">Location</span>
                  <p className="mb-2 text-sm text-slate-200">
                    {widgets.weather.label ? (
                      widgets.weather.label
                    ) : (
                      <span className="text-slate-500">Not set — search for a city below</span>
                    )}
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={placeQuery}
                      onChange={(e) => setPlaceQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchPlace())}
                      placeholder="City name, e.g. Austin"
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={searchPlace}
                      disabled={searching}
                      className="shrink-0 rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                    >
                      {searching ? 'Searching…' : 'Search'}
                    </button>
                  </div>
                  {placeResults.length > 0 && (
                    <ul className="mt-2 divide-y divide-slate-800 overflow-hidden rounded-md border border-slate-800">
                      {placeResults.map((p, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            onClick={() => choosePlace(p)}
                            className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                          >
                            {p.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <span className="mb-1 block text-xs text-slate-500">Units</span>
                  <div className="flex overflow-hidden rounded-md border border-slate-700">
                    {[
                      ['celsius', '°C'],
                      ['fahrenheit', '°F'],
                    ].map(([val, text]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setWeather({ unit: val })}
                        className={`px-3 py-1.5 text-xs font-medium transition ${
                          (widgets.weather.unit || 'celsius') === val
                            ? 'bg-sky-600 text-white'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Weather is provided by Open-Meteo and refreshes every 10 minutes.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Layout + config */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Dashboard layout</h3>
          <p className="text-sm text-slate-400">
            Layout, grid size, fit and spacing are configured live from the toolbar on the{' '}
            <Link to="/" className="text-sky-400 hover:underline">
              Live
            </Link>{' '}
            view. Your choices are saved automatically.
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Configuration</h3>
          <p className="mb-3 text-xs text-slate-500">
            Export or import all cameras and settings (no passwords included).
          </p>
          <div className="flex gap-2">
            <a
              href={api.exportConfigUrl}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
            >
              Export
            </a>
            <button onClick={() => fileRef.current?.click()} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800">
              Import
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              onChange={onImport}
              className="hidden"
            />
          </div>
        </div>
      </section>

      {notice && (
        <p className="fixed bottom-4 right-4 rounded-md bg-emerald-600 px-4 py-2 text-sm text-white shadow-lg">
          {notice}
        </p>
      )}
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500';
const smallBtn =
  'rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800';

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="mb-1 block text-sm text-slate-300">
        {label}
        {hint && <span className="ml-2 text-xs text-slate-500">{hint}</span>}
      </label>
      {children}
    </div>
  );
}
