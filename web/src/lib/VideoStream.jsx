import { useEffect, useRef } from 'react';
import { VideoRTC } from './video-rtc.js';

// Register the go2rtc web component once.
if (typeof window !== 'undefined' && !customElements.get('video-stream')) {
  customElements.define('video-stream', class extends VideoRTC {});
}

// Watchdog thresholds. A tile that has produced frames but freezes for STALL_MS,
// or never produces a first frame within STARTUP_MS, is rebuilt automatically so
// the user never has to reload the whole page to recover one black tile.
const STALL_MS = 12000;
const STARTUP_MS = 25000;
const WATCHDOG_INTERVAL_MS = 3000;

/**
 * Tear down and rebuild a single stream in place.
 *
 * `ondisconnect()` closes both the WebSocket and the PeerConnection and marks
 * the states CLOSED. We then reconnect on a short timer rather than immediately:
 * the old socket's `close` event fires asynchronously and would otherwise run
 * the component's `onclose()` against the freshly opened socket, tearing it down
 * again. Deferring lets that stale event resolve (and be ignored, since the
 * state is already CLOSED) before we open the new connection.
 */
function forceReconnect(el) {
  if (!el) return;
  if (el.reconnectTID) {
    clearTimeout(el.reconnectTID);
    el.reconnectTID = 0;
  }
  try {
    el.ondisconnect();
  } catch {
    return;
  }
  el._restartTID = setTimeout(() => {
    el._restartTID = 0;
    try {
      if (el.isConnected) el.onconnect();
    } catch {
      /* element torn down */
    }
  }, 250);
}

/**
 * Thin React wrapper around the go2rtc <video-stream> web component.
 *
 * Unmounting tears down the connection (disconnectedCallback), which is how we
 * stop hidden/offscreen streams instead of merely hiding them.
 *
 * @param {object} props
 * @param {string} props.streamName  go2rtc stream name to play.
 * @param {string} [props.mode]      go2rtc playback modes, in priority order.
 *   Use `mse` for grid tiles (one WebSocket each, scales to many cameras) and
 *   `webrtc,mse` for the single focused stream where latency matters.
 * @param {'cover'|'contain'} [props.fit] object-fit for the inner <video>.
 * @param {number} [props.startDelay]  ms to wait before connecting, used to
 *   stagger a wall of tiles so they don't all open sockets in one burst.
 */
export default function VideoStream({
  streamName,
  mode = 'webrtc,mse',
  fit = 'cover',
  className,
  startDelay = 0,
}) {
  const ref = useRef(null);

  // Connect (staggered) and tear down on unmount / stream change.
  useEffect(() => {
    const el = ref.current;
    if (!el || !streamName) return;
    el.mode = mode;
    el.background = false;
    // src setter builds a ws:// URL from location.origin -> goes through our
    // authenticated /go2rtc proxy.
    const wsPath = `/go2rtc/api/ws?src=${encodeURIComponent(streamName)}`;
    let timer = 0;
    if (startDelay > 0) {
      timer = setTimeout(() => {
        el.src = wsPath;
      }, startDelay);
    } else {
      el.src = wsPath;
    }
    return () => {
      if (timer) clearTimeout(timer);
      if (el._restartTID) {
        clearTimeout(el._restartTID);
        el._restartTID = 0;
      }
      try {
        el.src = '';
        el.ondisconnect?.();
      } catch {
        /* element already torn down */
      }
    };
  }, [streamName, mode, startDelay]);

  // Self-healing watchdog: rebuild a frozen or stuck tile without a page reload.
  useEffect(() => {
    const el = ref.current;
    if (!el || !streamName) return;
    let lastTime = -1;
    let lastProgress = Date.now();
    const id = setInterval(() => {
      const v = el.video;
      if (!v) return;
      // WebRTC closes the WebSocket once it wins, so check both transports.
      const active = el.wsState === WebSocket.OPEN || el.pcState === WebSocket.OPEN;
      // Don't fight the component's tab/visibility teardown or a pending restart.
      if (
        !active ||
        el.disconnectTID ||
        el._restartTID ||
        (typeof document !== 'undefined' && document.visibilityState !== 'visible')
      ) {
        lastProgress = Date.now();
        lastTime = -1;
        return;
      }
      // A visible, active stream that unexpectedly paused: try to resume first.
      if (v.paused) el.play?.();
      const playing = v.readyState >= 2 && !v.paused && v.currentTime !== lastTime;
      if (playing) {
        lastTime = v.currentTime;
        lastProgress = Date.now();
        return;
      }
      const limit = v.readyState >= 2 ? STALL_MS : STARTUP_MS;
      if (Date.now() - lastProgress > limit) {
        lastProgress = Date.now();
        lastTime = -1;
        forceReconnect(el);
      }
    }, WATCHDOG_INTERVAL_MS);
    return () => clearInterval(id);
  }, [streamName]);

  // The inner <video> is created in the element's connectedCallback; style it
  // once it exists. Live feeds are always muted (no audio UI) and never show
  // native controls (seek/volume are meaningless for a live, possibly silent
  // stream) — the app draws its own minimal overlay instead.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      if (!el.video) return false;
      el.video.controls = false;
      el.video.style.objectFit = fit;
      el.video.muted = true;
      return true;
    };
    if (!apply()) {
      const id = setInterval(() => apply() && clearInterval(id), 50);
      return () => clearInterval(id);
    }
  }, [fit]);

  return <video-stream ref={ref} class={className} style={{ display: 'block' }} />;
}
