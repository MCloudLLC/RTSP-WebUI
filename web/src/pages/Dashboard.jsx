import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import VideoStream from '../lib/VideoStream.jsx';

const GAP = { sm: 'gap-1 p-1', md: 'gap-2 p-2', lg: 'gap-4 p-4' };

const DEFAULT_PREFS = {
  layout: 'grid',
  gridSize: 'auto',
  fit: 'cover',
  gap: 'md',
  showLabels: true,
  widgets: {
    clock: true,
    weather: { enabled: false, latitude: null, longitude: null, label: '', unit: 'celsius' },
  },
};

function autoColumns(n) {
  if (n <= 1) return 1;
  return Math.min(6, Math.ceil(Math.sqrt(n)));
}

export default function Dashboard() {
  const [cameras, setCameras] = useState([]);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null); // fullscreen camera
  const [spotlightId, setSpotlightId] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    Promise.all([api.listCameras(), api.getSettings()])
      .then(([cams, settings]) => {
        const enabled = cams.filter((c) => c.enabled);
        setCameras(enabled);
        setPrefs({ ...DEFAULT_PREFS, ...(settings.dashboard || {}) });
        setSpotlightId(enabled[0]?.id ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setActive(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const savePrefs = (patch) => {
    setPrefs((p) => ({ ...p, ...patch }));
    api
      .updateSettings({ dashboard: patch })
      .then(() => setToast('View saved'))
      .catch(() => setToast('Could not save'));
  };

  const persistOrder = (next) => {
    setCameras(next);
    api
      .reorderCameras(next.map((c) => c.id))
      .then(() => setToast('Order saved'))
      .catch(() => setToast('Could not save order'));
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading cameras…</div>;
  }

  if (cameras.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-slate-400">No cameras configured yet.</p>
        <Link
          to="/settings"
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
        >
          Add a camera
        </Link>
      </div>
    );
  }

  if (active) {
    return <Fullscreen camera={active} fit={prefs.fit} onClose={() => setActive(null)} />;
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar prefs={prefs} onChange={savePrefs} count={cameras.length} />
      <div className="min-h-0 flex-1 overflow-auto">
        {prefs.layout === 'spotlight' ? (
          <Spotlight
            cameras={cameras}
            prefs={prefs}
            spotlightId={spotlightId ?? cameras[0].id}
            onSpotlight={setSpotlightId}
            onFullscreen={setActive}
          />
        ) : (
          <Grid cameras={cameras} prefs={prefs} onReorder={persistOrder} onOpen={setActive} />
        )}
      </div>
      <Toast message={toast} />
    </div>
  );
}

function Toast({ message }) {
  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed bottom-4 right-4 rounded-md bg-slate-800 px-4 py-2 text-sm text-white shadow-lg ring-1 ring-white/10 transition-opacity duration-200 ${
        message ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {message || ''}
    </div>
  );
}

function Toolbar({ prefs, onChange, count }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800 bg-slate-900/80 px-3 py-2 text-sm">
      <Segment
        label="Layout"
        value={prefs.layout}
        onChange={(v) => onChange({ layout: v })}
        options={[
          ['grid', 'Grid'],
          ['spotlight', 'Spotlight'],
        ]}
      />
      {prefs.layout === 'grid' && (
        <Segment
          label="Size"
          value={String(prefs.gridSize)}
          onChange={(v) => onChange({ gridSize: v === 'auto' ? 'auto' : Number(v) })}
          options={[
            ['auto', 'Auto'],
            ['2', '2×'],
            ['3', '3×'],
            ['4', '4×'],
          ]}
        />
      )}
      <Segment
        label="Fit"
        value={prefs.fit}
        onChange={(v) => onChange({ fit: v })}
        options={[
          ['cover', 'Fill'],
          ['contain', 'Fit'],
        ]}
      />
      <Segment
        label="Gap"
        value={prefs.gap}
        onChange={(v) => onChange({ gap: v })}
        options={[
          ['sm', 'S'],
          ['md', 'M'],
          ['lg', 'L'],
        ]}
      />
      <button
        onClick={() => onChange({ showLabels: !prefs.showLabels })}
        className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
          prefs.showLabels
            ? 'bg-slate-700 text-white'
            : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
        }`}
      >
        Labels
      </button>
      <div className="ml-auto flex items-center gap-3">
        {prefs.layout === 'grid' && (
          <span className="hidden text-xs text-slate-500 lg:block">
            Drag tiles to reorder · {count} cameras
          </span>
        )}
        {prefs.widgets?.clock !== false && <ClockWidget />}
        {prefs.widgets?.weather?.enabled && <WeatherWidget weather={prefs.widgets.weather} />}
      </div>
    </div>
  );
}

function ClockWidget() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <div className="flex items-center gap-2 text-slate-200" title={now.toLocaleString()}>
      <span className="text-sm font-semibold tabular-nums">{time}</span>
      <span className="hidden text-xs text-slate-500 sm:block">{date}</span>
    </div>
  );
}

function WeatherWidget({ weather }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getWeather()
        .then((d) => !cancelled && setData(d))
        .catch(() => !cancelled && setData(null));
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [weather.latitude, weather.longitude, weather.unit, weather.enabled]);

  if (!data || data.temperature == null) return null;
  return (
    <div
      className="flex items-center gap-1.5 text-slate-200"
      title={`${data.description}${data.label ? ' · ' + data.label : ''}`}
    >
      <span className="text-base leading-none">{data.icon}</span>
      <span className="text-sm font-semibold tabular-nums">
        {data.temperature}
        {data.unit}
      </span>
      {data.label && <span className="hidden text-xs text-slate-500 md:block">{data.label}</span>}
    </div>
  );
}

function Segment({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="flex overflow-hidden rounded-md border border-slate-700">
        {options.map(([val, text]) => (
          <button
            key={val}
            onClick={() => onChange(val)}
            className={`px-2.5 py-1 text-xs font-medium transition ${
              value === val ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Grid({ cameras, prefs, onReorder, onOpen }) {
  const dragIndex = useRef(null);
  const didDrag = useRef(false);
  const [overIndex, setOverIndex] = useState(null);

  const columns = prefs.gridSize === 'auto' ? autoColumns(cameras.length) : prefs.gridSize;

  const onDrop = (target) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    setOverIndex(null);
    if (from == null || from === target) return;
    const next = [...cameras];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved);
    onReorder(next);
  };

  return (
    <div
      className={`grid ${GAP[prefs.gap]}`}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {cameras.map((cam, i) => (
        <div
          key={cam.id}
          draggable
          onDragStart={() => {
            dragIndex.current = i;
            didDrag.current = true;
          }}
          onDragEnd={() => {
            setTimeout(() => (didDrag.current = false), 0);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (overIndex !== i) setOverIndex(i);
          }}
          onDrop={() => onDrop(i)}
          onClick={() => {
            if (!didDrag.current) onOpen(cam);
          }}
          className={`group relative aspect-video cursor-pointer overflow-hidden rounded-lg border bg-black transition ${
            overIndex === i ? 'border-sky-500 ring-2 ring-sky-500/40' : 'border-slate-800'
          }`}
          title={`Open ${cam.name}`}
        >
          <VideoStream
            streamName={cam.streams.sub || cam.streams.main}
            mode="mse"
            startDelay={i * 150}
            fit={prefs.fit}
            className="absolute inset-0 h-full w-full"
          />
          {prefs.showLabels && (
            <span className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-left text-xs font-medium text-white">
              {cam.name}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Spotlight({ cameras, prefs, spotlightId, onSpotlight, onFullscreen }) {
  const primary = cameras.find((c) => c.id === spotlightId) || cameras[0];
  const others = cameras.filter((c) => c.id !== primary.id);

  return (
    <div className={`flex h-full flex-col ${GAP[prefs.gap]}`}>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-800 bg-black">
        <VideoStream
          key={primary.id}
          streamName={primary.streams.main}
          mode="webrtc,mse"
          fit={prefs.fit}
          className="absolute inset-0 h-full w-full"
        />
        <div className="pointer-events-none absolute left-0 right-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-2">
          {prefs.showLabels ? (
            <span className="text-sm font-medium text-white">{primary.name}</span>
          ) : (
            <span />
          )}
          <button
            onClick={() => onFullscreen(primary)}
            className="pointer-events-auto rounded-md bg-white/10 px-2.5 py-1 text-xs text-white backdrop-blur hover:bg-white/20"
            title="Fullscreen"
          >
            ⛶ Fullscreen
          </button>
        </div>
      </div>
      {others.length > 0 && (
        <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
          {others.map((cam, i) => (
            <button
              key={cam.id}
              onClick={() => onSpotlight(cam.id)}
              className="group relative aspect-video w-40 shrink-0 overflow-hidden rounded-md border border-slate-800 bg-black hover:border-sky-500"
              title={`Spotlight ${cam.name}`}
            >
              <VideoStream
                streamName={cam.streams.sub || cam.streams.main}
                mode="mse"
                startDelay={i * 150}
                fit="cover"
                className="absolute inset-0 h-full w-full"
              />
              {prefs.showLabels && (
                <span className="pointer-events-none absolute bottom-0 left-0 right-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 py-0.5 text-left text-[11px] font-medium text-white">
                  {cam.name}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Fullscreen({ camera, fit, onClose }) {
  return (
    <div className="relative h-full bg-black">
      <VideoStream
        streamName={camera.streams.main}
        mode="webrtc,mse"
        fit={fit === 'cover' ? 'cover' : 'contain'}
        className="h-full w-full"
      />
      <div className="absolute left-0 right-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-3">
        <span className="text-sm font-medium text-white">{camera.name}</span>
        <button
          onClick={onClose}
          className="rounded-md bg-white/10 px-3 py-1.5 text-sm text-white backdrop-blur hover:bg-white/20"
        >
          Close ✕
        </button>
      </div>
    </div>
  );
}
