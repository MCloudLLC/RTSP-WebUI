import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { stringify as yamlStringify } from 'yaml';
import { buildSource, streamNames, validateRtspUrl } from './streamUrl.js';

/**
 * Parse a go2rtc webrtc listen address (e.g. ":8555" or "127.0.0.1:8555")
 * into a port number.
 */
export function webrtcPort(listen, fallback = 8555) {
  const m = /:(\d+)\s*$/.exec(String(listen || ''));
  return m ? Number(m[1]) : fallback;
}

/**
 * Auto-detect usable LAN WebRTC candidates from the host's network interfaces.
 * Returns an array of "ip:port" strings for every non-internal IPv4 address,
 * plus loopback so same-machine access works.
 *
 * This works for desktop/bare-metal and host-networked Docker. In bridge-mode
 * Docker the server only sees its container IP, so an explicit
 * GO2RTC_WEBRTC_CANDIDATE is still required for LAN access there.
 */
export function detectLocalCandidates(port) {
  const out = [`127.0.0.1:${port}`];
  const ifaces = networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`${a.address}:${port}`);
    }
  }
  return out;
}

/** Normalize a candidate input (string, comma/space list, or array) to an array. */
export function normalizeCandidates(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[\s,]+/);
  return list.map((s) => String(s).trim()).filter(Boolean);
}

/**
 * go2rtc integration.
 *
 * The app's JSON config is the single source of truth. We deterministically
 * generate a go2rtc.yaml (used for go2rtc cold start) AND push live changes via
 * go2rtc's REST API. Because both derive from the same config they cannot drift.
 */
export class Go2rtc {
  /**
   * @param {object} opts
   * @param {string} opts.apiUrl    Base URL of go2rtc API, e.g. http://go2rtc:1984
   * @param {string} opts.yamlPath  Where to write the generated go2rtc.yaml
   * @param {string} [opts.apiListen]      go2rtc api listen address (yaml)
   * @param {string} [opts.webrtcListen]   go2rtc webrtc listen address (yaml)
   * @param {string|string[]} [opts.webrtcCandidate] Public/LAN candidate(s)
   *   "host:port" for WebRTC. Accepts a single value, a comma/space separated
   *   list, or an array. When empty, no candidates are advertised.
   * @param {import('pino').Logger} [opts.log]
   */
  constructor({ apiUrl, yamlPath, apiListen, webrtcListen, webrtcCandidate, binPath, log }) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.yamlPath = yamlPath;
    this.apiListen = apiListen || ':1984';
    this.webrtcListen = webrtcListen || ':8555';
    this.webrtcCandidates = normalizeCandidates(webrtcCandidate);
    this.binPath = binPath || '';
    this.proc = null;
    this.log = log || console;
  }

  /**
   * Optionally spawn a local go2rtc process (used for Electron / bare-metal).
   * In Docker, go2rtc runs as its own container and binPath is unset.
   */
  startProcess() {
    if (!this.binPath || this.proc) return;
    this.log.info?.(`Spawning go2rtc: ${this.binPath} -config ${this.yamlPath}`);
    this.proc = spawn(this.binPath, ['-config', this.yamlPath], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    this.proc.on('exit', (code) => {
      this.log.warn?.(`go2rtc process exited with code ${code}`);
      this.proc = null;
    });
    this.proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        this.log.error?.(
          `go2rtc binary not found at ${this.binPath}. ` +
          'Run scripts/download-go2rtc.sh (or scripts/download-go2rtc.ps1 on Windows) to install it.',
        );
      } else {
        this.log.error?.(`Failed to start go2rtc: ${err.message}`);
      }
      this.proc = null;
    });
  }

  stopProcess() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }

  /** Compute the desired set of go2rtc streams from app config. */
  desiredStreams(config) {
    const streams = {};
    for (const cam of config.cameras) {
      if (cam.enabled === false) continue;
      const names = streamNames(cam.id);
      if (validateRtspUrl(cam.mainUrl).ok) {
        streams[names.main] = buildSource(cam.mainUrl);
      }
      if (cam.subUrl && validateRtspUrl(cam.subUrl).ok) {
        // Grid view: drop audio to save client bandwidth/CPU.
        streams[names.sub] = buildSource(cam.subUrl, { videoOnly: true });
      }
    }
    return streams;
  }

  /** Generate go2rtc.yaml deterministically from app config. */
  async generateYaml(config) {
    const sources = this.desiredStreams(config);
    // go2rtc expects each stream value to be a list of sources.
    const streams = {};
    for (const [name, src] of Object.entries(sources)) streams[name] = [src];

    const doc = {
      log: { level: 'info' },
      api: { listen: this.apiListen },
      rtsp: { listen: ':8554' },
      webrtc: {
        listen: this.webrtcListen,
        ...(this.webrtcCandidates.length ? { candidates: this.webrtcCandidates } : {}),
      },
      streams,
    };

    await mkdir(dirname(this.yamlPath), { recursive: true });
    await writeFile(this.yamlPath, yamlStringify(doc), 'utf8');
    return doc;
  }

  async #api(path, init) {
    const res = await fetch(`${this.apiUrl}${path}`, init);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`go2rtc ${init?.method || 'GET'} ${path} -> ${res.status} ${body}`);
    }
    return res;
  }

  async getStreams() {
    try {
      const res = await this.#api('/api/streams');
      return await res.json();
    } catch (err) {
      this.log.warn?.(`go2rtc getStreams failed: ${err.message}`);
      return {};
    }
  }

  async putStream(name, source) {
    const qs = new URLSearchParams({ name, src: source });
    await this.#api(`/api/streams?${qs.toString()}`, { method: 'PUT' });
  }

  async deleteStream(name) {
    const qs = new URLSearchParams({ src: name });
    try {
      await this.#api(`/api/streams?${qs.toString()}`, { method: 'DELETE' });
    } catch (err) {
      // Deleting a non-existent stream is fine.
      this.log.debug?.(`go2rtc deleteStream(${name}) ignored: ${err.message}`);
    }
  }

  /** Re-create the streams for a single camera (delete old, add current). */
  async syncCamera(camera) {
    const names = streamNames(camera.id);
    await this.deleteStream(names.main);
    await this.deleteStream(names.sub);
    if (camera.enabled === false) return;
    if (validateRtspUrl(camera.mainUrl).ok) {
      await this.putStream(names.main, buildSource(camera.mainUrl));
    }
    if (camera.subUrl && validateRtspUrl(camera.subUrl).ok) {
      await this.putStream(names.sub, buildSource(camera.subUrl, { videoOnly: true }));
    }
  }

  async removeCamera(cameraId) {
    const names = streamNames(cameraId);
    await this.deleteStream(names.main);
    await this.deleteStream(names.sub);
  }

  /**
   * Make go2rtc's live stream set match the desired config. Adds missing
   * streams and removes stale cam_* streams. Safe to run on startup.
   */
  async reconcile(config) {
    const desired = this.desiredStreams(config);
    const current = await this.getStreams();
    const currentNames = new Set(Object.keys(current || {}));

    for (const [name, src] of Object.entries(desired)) {
      if (!currentNames.has(name)) {
        try {
          await this.putStream(name, src);
        } catch (err) {
          this.log.warn?.(`go2rtc reconcile put ${name} failed: ${err.message}`);
        }
      }
    }
    for (const name of currentNames) {
      if (name.startsWith('cam_') && !(name in desired)) {
        await this.deleteStream(name);
      }
    }
  }

  /** Best-effort readiness probe. */
  async ping() {
    try {
      await this.#api('/api/streams');
      return true;
    } catch {
      return false;
    }
  }
}
