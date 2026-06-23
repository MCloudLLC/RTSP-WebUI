import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import VideoStream from '../lib/VideoStream.jsx';

const GAP = { sm: 'gap-1 p-1', md: 'gap-2 p-2', lg: 'gap-4 p-4' };
const GAP_INNER = { sm: 'gap-1', md: 'gap-2', lg: 'gap-4' };

const DEFAULT_PREFS = {
  layout: 'grid',
  gridSize: 'auto',
  spotlightPosition: 'bottom',
  fit: 'cover',
  gap: 'md',
  showLabels: true,
  widgets: {
    clock: true,
    weather: { enabled: false, latitude: null, longitude: null, label: '', unit: 'celsius' },
  },
};

// Cameras hidden from the dashboard are a per-browser view filter (kept in
// localStorage). They are never disabled server-side, so their go2rtc streams
// stay up and other viewers are unaffected.
const HIDDEN_STORAGE_KEY = 'rtsp-webui:dashboard:hiddenCameras';

function loadHiddenIds() {
  try {
    const raw = localStorage.getItem(HIDDEN_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveHiddenIds(ids) {
  try {
    localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore storage errors (quota, private mode); the filter just won't persist.
  }
}

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
  const [hiddenIds, setHiddenIds] = useState(() => loadHiddenIds());
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

  useEffect(() => {
    saveHiddenIds(hiddenIds);
  }, [hiddenIds]);

  const visibleCameras = cameras.filter((c) => !hiddenIds.has(c.id));

  const setCameraVisible = (id, visible) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const showAllCameras = () => setHiddenIds(new Set());
  const hideAllCameras = () => setHiddenIds(new Set(cameras.map((c) => c.id)));

  const savePrefs = (patch) => {
    setPrefs((p) => ({ ...p, ...patch }));
    api
      .updateSettings({ dashboard: patch })
      .then(() => setToast('View saved'))
      .catch(() => setToast('Could not save'));
  };

  // Reordering happens on the visible subset; rebuild the full order so hidden
  // cameras keep their slots before persisting the complete ordering.
  const persistOrder = (nextVisible) => {
    const visibleSet = new Set(nextVisible.map((c) => c.id));
    let vi = 0;
    const next = cameras.map((c) => (visibleSet.has(c.id) ? nextVisible[vi++] : c));
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
    return <Fullscreen camera={active} onClose={() => setActive(null)} />;
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        prefs={prefs}
        onChange={savePrefs}
        cameras={cameras}
        visibleCount={visibleCameras.length}
        hiddenIds={hiddenIds}
        onToggleCamera={setCameraVisible}
        onShowAll={showAllCameras}
        onHideAll={hideAllCameras}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {visibleCameras.length === 0 ? (
          <NoneVisible onShowAll={showAllCameras} />
        ) : prefs.layout === 'spotlight' ? (
          <Spotlight
            cameras={visibleCameras}
            prefs={prefs}
            spotlightId={spotlightId ?? visibleCameras[0].id}
            onSpotlight={setSpotlightId}
            onFullscreen={setActive}
          />
        ) : (
          <Grid cameras={visibleCameras} prefs={prefs} onReorder={persistOrder} onOpen={setActive} />
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

function NoneVisible({ onShowAll }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-slate-400">All cameras are hidden from this device.</p>
      <button
        onClick={onShowAll}
        className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
      >
        Show all cameras
      </button>
    </div>
  );
}

function Toolbar({
  prefs,
  onChange,
  cameras,
  visibleCount,
  hiddenIds,
  onToggleCamera,
  onShowAll,
  onHideAll,
}) {
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
      {prefs.layout === 'spotlight' && (
        <Segment
          label="Thumbs"
          value={prefs.spotlightPosition}
          onChange={(v) => onChange({ spotlightPosition: v })}
          options={[
            ['bottom', 'Bottom'],
            ['left', 'Left'],
            ['right', 'Right'],
            ['l', 'L'],
          ]}
        />
      )}
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
            ['5', '5×'],
            ['6', '6×'],
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
            Drag tiles to reorder · {visibleCount} of {cameras.length} shown
          </span>
        )}
        <CameraSelector
          cameras={cameras}
          visibleCount={visibleCount}
          hiddenIds={hiddenIds}
          onToggle={onToggleCamera}
          onShowAll={onShowAll}
          onHideAll={onHideAll}
        />
        {prefs.widgets?.clock !== false && <ClockWidget />}
        {prefs.widgets?.weather?.enabled && <WeatherWidget weather={prefs.widgets.weather} />}
      </div>
    </div>
  );
}

function CameraSelector({ cameras, visibleCount, hiddenIds, onToggle, onShowAll, onHideAll }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
          open
            ? 'bg-slate-700 text-white'
            : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
        }`}
        title="Choose which cameras appear on this device"
        aria-haspopup="true"
        aria-expanded={open}
      >
        Cameras
        <span className="tabular-nums text-slate-400">
          {visibleCount}/{cameras.length}
        </span>
        <span className="text-[10px] leading-none">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-60 rounded-md border border-slate-700 bg-slate-900 p-2 shadow-xl">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-xs font-medium text-slate-400">Show on this device</span>
            <div className="flex gap-1">
              <button
                onClick={onShowAll}
                className="rounded px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
              >
                All
              </button>
              <button
                onClick={onHideAll}
                className="rounded px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
              >
                None
              </button>
            </div>
          </div>
          <ul className="max-h-72 space-y-0.5 overflow-auto">
            {cameras.map((cam) => (
              <li key={cam.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-200 hover:bg-slate-800">
                  <input
                    type="checkbox"
                    checked={!hiddenIds.has(cam.id)}
                    onChange={(e) => onToggle(cam.id, e.target.checked)}
                    className="shrink-0 accent-sky-500"
                  />
                  <span className="truncate">{cam.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
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

function SpotlightPrimary({ camera, prefs, onFullscreen, className = '', style }) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-slate-800 bg-black ${className}`}
      style={style}
    >
      <VideoStream
        key={camera.id}
        streamName={camera.streams.main}
        mode="webrtc,mse"
        fit={prefs.fit}
        className="absolute inset-0 h-full w-full"
      />
      <div className="pointer-events-none absolute left-0 right-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-2">
        {prefs.showLabels ? (
          <span className="text-sm font-medium text-white">{camera.name}</span>
        ) : (
          <span />
        )}
        <button
          onClick={() => onFullscreen(camera)}
          className="pointer-events-auto rounded-md bg-white/10 px-2.5 py-1 text-xs text-white backdrop-blur hover:bg-white/20"
          title="Fullscreen"
        >
          ⛶ Fullscreen
        </button>
      </div>
    </div>
  );
}

function SpotlightThumb({ camera, index, showLabels, onSpotlight, orientation = 'strip' }) {
  // Keep each thumbnail a 16:9 card and shrink it along the track's free axis so
  // any number of thumbnails fit without scrolling. cover-crop (never stretch)
  // handles the slight aspect drift once they start shrinking.
  const sizing =
    orientation === 'rail'
      ? 'w-full aspect-video shrink min-h-0'
      : 'h-full aspect-video shrink min-w-0';
  return (
    <button
      onClick={() => onSpotlight(camera.id)}
      className={`group relative ${sizing} max-h-full max-w-full overflow-hidden rounded-md border border-slate-800 bg-black hover:border-sky-500`}
      title={`Spotlight ${camera.name}`}
    >
      <VideoStream
        streamName={camera.streams.sub || camera.streams.main}
        mode="mse"
        startDelay={index * 150}
        fit="cover"
        className="absolute inset-0 h-full w-full"
      />
      {showLabels && (
        <span className="pointer-events-none absolute bottom-0 left-0 right-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 py-0.5 text-left text-[11px] font-medium text-white">
          {camera.name}
        </span>
      )}
    </button>
  );
}

// Spotlight: one large camera plus thumbnails of the rest. The thumbnails can
// sit along the bottom, either side, or wrap the spotlight in an L; every
// arrangement flexes its thumbnails to fit so nothing scrolls. PrimaryPane/Thumb
// are module-level (stable identity) so re-renders don't remount the streams.
function Spotlight({ cameras, prefs, spotlightId, onSpotlight, onFullscreen }) {
  const primary = cameras.find((c) => c.id === spotlightId) || cameras[0];
  const others = cameras.filter((c) => c.id !== primary.id);
  const position = ['bottom', 'left', 'right', 'l'].includes(prefs.spotlightPosition)
    ? prefs.spotlightPosition
    : 'bottom';

  const primaryPane = (extra = {}) => (
    <SpotlightPrimary camera={primary} prefs={prefs} onFullscreen={onFullscreen} {...extra} />
  );
  const thumb = (cam, index, orientation) => (
    <SpotlightThumb
      key={cam.id}
      camera={cam}
      index={index}
      orientation={orientation}
      showLabels={prefs.showLabels}
      onSpotlight={onSpotlight}
    />
  );

  if (others.length === 0) {
    return (
      <div className={`flex h-full items-center justify-center ${GAP[prefs.gap]}`}>
        {primaryPane({ className: 'aspect-video h-full max-w-full' })}
      </div>
    );
  }

  if (position === 'right' || position === 'left') {
    const thumbRail = (
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center ${GAP_INNER[prefs.gap]}`}
      >
        {others.map((cam, i) => thumb(cam, i, 'rail'))}
      </div>
    );

    return (
      <div className={`flex h-full flex-row ${GAP[prefs.gap]}`}>
        {position === 'left' && thumbRail}
        {primaryPane({ className: 'aspect-video h-full max-w-[80%] shrink-0' })}
        {position === 'right' && thumbRail}
      </div>
    );
  }

  if (position === 'l') {
    const half = Math.ceil(others.length / 2);

    return (
      <div className={`flex h-full flex-col ${GAP[prefs.gap]}`}>
        <div className={`flex min-h-0 flex-1 flex-row ${GAP_INNER[prefs.gap]}`}>
          {primaryPane({ className: 'aspect-video h-full max-w-[80%] shrink-0' })}
          <div
            className={`flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center ${GAP_INNER[prefs.gap]}`}
          >
            {others.slice(0, half).map((cam, i) => thumb(cam, i, 'rail'))}
          </div>
        </div>
        <div
          className={`flex min-h-0 shrink-0 basis-1/4 flex-row items-center justify-center ${GAP_INNER[prefs.gap]}`}
        >
          {others.slice(half).map((cam, i) => thumb(cam, half + i, 'strip'))}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col ${GAP[prefs.gap]}`}>
      {primaryPane({ className: 'min-h-0 flex-1' })}
      <div className={`flex h-28 shrink-0 items-center justify-center ${GAP_INNER[prefs.gap]}`}>
        {others.map((cam, i) => thumb(cam, i, 'strip'))}
      </div>
    </div>
  );
}

// A focused (fullscreen) camera always letterboxes (object-fit: contain) so the
// whole frame is visible; the Fill/Fit toggle only governs the grid/spotlight
// layouts where cropping to even tiles is desirable.
function Fullscreen({ camera, onClose }) {
  return (
    <div className="relative h-full bg-black">
      <VideoStream
        streamName={camera.streams.main}
        mode="webrtc,mse"
        fit="contain"
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
