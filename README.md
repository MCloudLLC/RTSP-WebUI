# RTSP WebUI

A self-hosted, low-latency multi-camera RTSP viewer with a simple management
control panel. Built for watching many HD cameras at once **without** saturating
your network or adding video latency.

- **Low latency where it counts** — the focused/fullscreen camera uses WebRTC
  (sub-second on a good LAN); the grid uses MSE so it scales smoothly to many
  cameras at once.
- **Bandwidth-efficient** — [go2rtc](https://github.com/AlexxIT/go2rtc) connects
  to each camera **once** and fans the stream out to every viewer. The grid uses
  each camera's low-res **sub-stream** (video-only); fullscreen switches to the
  **main** stream and tears the grid streams down. Streams also pause when the
  browser tab is hidden.
- **Self-healing** — each tile has a watchdog that automatically rebuilds a
  frozen or black stream in place, so you never have to reload the whole page.
- **Codec passthrough** — H.264 is relayed without transcoding (near-zero CPU,
  no added latency).
- **Two ways to run** — a Docker web app for network-wide access, or an optional
  Electron desktop app that runs everything locally (no exposed ports).
- **Simple** — single shared password, JSON config with one-click
  export/import.

## Architecture

```
            ┌──────────────────────────── browser ────────────────────────────┐
            │  React SPA  ──  /api/* (control)   ──┐                           │
            │             ──  /go2rtc/api/ws (WebRTC signaling, proxied+auth) ─┼─┐
            └──────────────────────────────────────┼───────────────────────────┘ │
                                                    ▼                             │ WebRTC media
   ┌──────────────────────── app (Fastify) ───────────────────┐                  │ (UDP/TCP 8555,
   │ • serves SPA                                              │                  │  direct to go2rtc)
   │ • REST API: auth, camera CRUD, settings, config I/O       │   REST sync      │
   │ • reverse-proxies go2rtc API + WS (auth enforced)         │ ───────────────► │
   │ • app JSON is the single source of truth; generates       │                  ▼
   │   go2rtc.yaml deterministically                           │      ┌──────── go2rtc ────────┐
   └───────────────────────────────────────────────────────────┘      │ RTSP in → WebRTC out   │
                                                                       │ 1 conn/cam, fan-out    │
                                                                       └── cameras (RTSP) ──────┘
```

The go2rtc API port (1984) is **never** exposed; the browser reaches it only
through the app's authenticated `/go2rtc` proxy. Only the WebRTC media port
(8555) is published, because WebRTC media flows directly between the browser and
go2rtc (it cannot be proxied over the signaling websocket).

## Quick start (Docker)

Requirements: Docker + Docker Compose.

```bash
cp .env.example .env
# Edit .env: set APP_PASSWORD, SESSION_SECRET, and GO2RTC_WEBRTC_CANDIDATE
docker compose up -d --build
```

Open `http://<host>:8080` and sign in.

### Important: `GO2RTC_WEBRTC_CANDIDATE`

For WebRTC to work across the network you **must** set this to the Docker host's
LAN IP and the published WebRTC port, e.g. `192.168.1.10:8555`. Without it,
go2rtc may advertise unreachable container addresses and video will fail to
connect (signaling succeeds, but the picture never appears). Generate a session
secret with `openssl rand -hex 32`.

## Using the app

1. **Manage → Add camera.** Provide a name and the **Main stream URL**
   (`rtsp://user:pass@host:554/...`). Optionally add a **Sub stream URL** — most
   IP cameras expose a low-res second stream; this is used in the grid to save
   bandwidth. If omitted, the grid falls back to the main stream.
2. **Live.** A toolbar lets you customize the view (saved automatically):
   - **Layout** — *Grid* (even tiles) or *Spotlight* (one large camera + a
     thumbnail strip; click a thumbnail to promote it).
   - **Size** — *Auto* (best-fit columns) or a fixed 2×–6× grid.
   - **Thumbs** (Spotlight only) — arrange the other cameras' thumbnails along
     the *Bottom*, *Left*, *Right*, or in an *L* that wraps the spotlight. Every
     arrangement shrinks the thumbnails to fit on screen — no scrolling.
   - **Fit** — *Fill* (crop to tile) or *Fit* (letterbox, no crop).
   - **Gap** and **Labels** toggles for density.
   - **Cameras** — a checkbox dropdown to pick which cameras appear on the
     dashboard. This is a per-device view filter (remembered in your browser); it never
     disables a camera or affects other viewers. To permanently turn a camera
     off (and tear down its stream), use *Disable* under Manage instead.
   - **Drag any grid tile** to reorder cameras; the order is saved.
   Click a tile (or the Spotlight ⛶ button) for fullscreen. `Esc` closes it.
3. **Export / Import** under Manage save/restore all cameras and settings as a
   JSON file. Exports never contain the password or session secret.
4. **Widgets** (Manage → *Dashboard widgets*) add an optional **clock** and
   **weather** readout to the Live toolbar. For weather, search a city and pick
   °C/°F — data comes from [Open-Meteo](https://open-meteo.com) (free, no API
   key) and refreshes every 10 minutes. The server needs outbound internet for
   weather; if it's unavailable the widget simply hides itself.

> Only `rtsp://` and `rtsps://` URLs are accepted (validated on both camera
> entry and config import) to prevent injection of arbitrary go2rtc sources.

### Camera tips for smooth multi-stream viewing

- Make sure cameras output **H.264** (not H.265) for zero-transcode passthrough.
- Configure each camera's **sub-stream** to a low resolution / framerate — this
  is what the grid uses, and it is the biggest lever for bandwidth and client
  CPU when watching 6+ cameras.
- The grid plays sub-streams over **MSE** (one lightweight connection per tile),
  which is far more robust than running many WebRTC peer connections at once.
  WebRTC is reserved for the single focused/fullscreen camera where low latency
  matters most.
- If a tile freezes or goes black, it **recovers itself** within ~10–25s — no
  page reload needed. Frame drops are usually the camera's sub-stream framerate
  or a saturated uplink; lowering the sub-stream resolution/framerate helps most.

## Development

Requirements: Node.js 20+.

```bash
npm install --workspace server --workspace web --include-workspace-root
./scripts/download-go2rtc.sh            # puts the go2rtc binary in ./bin

# Terminal 1 — backend (spawns go2rtc locally)
GO2RTC_BIN="$PWD/bin/go2rtc" APP_PASSWORD=dev npm run dev:server

# Terminal 2 — Vite dev server with API/WS proxy to the backend
npm run dev:web
```

On **Windows** (PowerShell), use the `.ps1` script and `go2rtc.exe`:

```powershell
npm install --workspace server --workspace web --include-workspace-root
./scripts/download-go2rtc.ps1           # puts go2rtc.exe in .\bin

# Terminal 1 — backend (spawns go2rtc locally)
$env:GO2RTC_BIN = "$PWD\bin\go2rtc.exe"; $env:APP_PASSWORD = "dev"; npm run dev:server

# Terminal 2 — Vite dev server with API/WS proxy to the backend
npm run dev:web
```

Open `http://localhost:5173`.

### Production build (bare metal)

```bash
npm run build                          # builds web/dist
GO2RTC_BIN="$PWD/bin/go2rtc" APP_PASSWORD=secret npm start
# serves UI + API on http://localhost:8080
```

On **Windows** (PowerShell):

```powershell
npm run build
$env:GO2RTC_BIN = "$PWD\bin\go2rtc.exe"; $env:APP_PASSWORD = "secret"; npm start
```

## Desktop app (Electron)

The desktop app runs the backend and go2rtc on `127.0.0.1` only — nothing is
exposed to the network. Config export/import works the same as the web app, so
you can move setups between machines.

```bash
./scripts/download-go2rtc.sh           # bundles the go2rtc binary
                                       # (Windows: ./scripts/download-go2rtc.ps1)
npm run build                          # build the SPA
npm install --workspace desktop        # installs Electron
npm run desktop                        # launch
# package installers:  npm --workspace desktop run dist
```

By default the desktop app runs with **no password** (local use). Set
`APP_PASSWORD` in the environment to require one.

## Configuration reference

| Variable                  | Default                  | Description |
| ------------------------- | ------------------------ | ----------- |
| `APP_PASSWORD`            | *(empty)*                | Shared login password. Empty disables auth. |
| `SESSION_SECRET`          | *(auto, persisted)*      | Signs session cookies. Auto-generated and saved to `DATA_DIR/session.secret` if unset, so logins survive restarts. |
| `SESSION_TTL_DAYS`        | `3650`                   | How long a login stays valid (~10 years = "until you sign out"). |
| `PORT` / `HOST`           | `8080` / `0.0.0.0`       | Web server bind. |
| `DATA_DIR`                | `server/data`            | Where `config.json` + generated `go2rtc.yaml` live. |
| `GO2RTC_API_URL`          | `http://127.0.0.1:1984`  | go2rtc REST API location. |
| `GO2RTC_WEBRTC_LISTEN`    | `:8555`                  | go2rtc WebRTC listen (written to yaml). |
| `GO2RTC_WEBRTC_CANDIDATE` | *(empty)*                | LAN `host:port` advertised for WebRTC. **Set for Docker.** |
| `GO2RTC_BIN`              | *(empty)*                | Path to a go2rtc binary to spawn (desktop/bare-metal). Unset in Docker. |

## Security notes

- Keep the go2rtc API port (1984) unpublished; the app proxies it with auth.
- The WebRTC media port (8555) is reachable directly; on a LAN this is fine
  (ICE credentials are negotiated over authenticated signaling). Do not expose
  it to the internet without a VPN/TURN.
- Config import is treated as untrusted and re-validates every URL.

## Project layout

```
server/    Fastify backend (auth, camera CRUD, go2rtc sync, proxy, static SPA)
web/       React + Vite + Tailwind frontend (Login, Live grid, Manage)
desktop/   Electron wrapper (spawns server + go2rtc on localhost)
scripts/   helper scripts (download go2rtc)
Dockerfile, docker-compose.yml
```

## Credits

- [go2rtc](https://github.com/AlexxIT/go2rtc) (MIT) — streaming engine and the
  bundled `video-rtc.js` web component.
