'use strict';

const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

/**
 * Electron wrapper.
 *
 * Runs the Fastify server (which itself spawns a bundled go2rtc binary) as a
 * child process bound to localhost, then loads the UI. No ports are exposed to
 * the network; everything is 127.0.0.1.
 */

const PORT = 8765;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let serverProc = null;

function resourcePath(...p) {
  // Packaged: resources/bin; dev: repo ../bin
  const packaged = path.join(process.resourcesPath || '', ...p);
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', ...p);
}

function go2rtcBinaryPath() {
  const name = process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc';
  return resourcePath('bin', name);
}

function startServer() {
  const serverEntry = path.join(__dirname, '..', 'server', 'src', 'index.js');
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    HOST: '127.0.0.1',
    PORT: String(PORT),
    DATA_DIR: dataDir,
    STATIC_DIR: path.join(__dirname, '..', 'web', 'dist'),
    GO2RTC_BIN: go2rtcBinaryPath(),
    GO2RTC_API_URL: 'http://127.0.0.1:1984',
    GO2RTC_API_LISTEN: '127.0.0.1:1984',
    GO2RTC_WEBRTC_LISTEN: '127.0.0.1:8555',
    GO2RTC_WEBRTC_CANDIDATE: '127.0.0.1:8555',
    // Local desktop use: no password by default.
    APP_PASSWORD: process.env.APP_PASSWORD || '',
  };

  serverProc = spawn(process.execPath, [serverEntry], { env, stdio: 'inherit' });
  serverProc.on('exit', (code) => {
    console.error(`server exited with code ${code}`);
    serverProc = null;
  });
}

function waitForServer(retries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http
        .get(`${BASE_URL}/api/health`, (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else retry(n);
        })
        .on('error', () => retry(n));
    };
    const retry = (n) => {
      if (n <= 0) return reject(new Error('server did not start'));
      setTimeout(() => attempt(n - 1), 500);
    };
    attempt(retries);
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#020617',
    title: 'RTSP WebUI',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // Open external links in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  try {
    await waitForServer();
    await win.loadURL(BASE_URL);
  } catch (err) {
    win.loadURL(
      'data:text/html,' +
        encodeURIComponent(`<h1 style="font-family:sans-serif">Failed to start: ${err.message}</h1>`),
    );
  }
}

app.whenReady().then(() => {
  startServer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function shutdown() {
  if (serverProc) {
    // SIGTERM lets the server stop its go2rtc child and close cleanly.
    serverProc.kill();
    serverProc = null;
  }
}

// This is a single-window, local-server utility: there is no reason to keep the
// Electron process (and the backend it spawned) alive once the window is closed.
// Quit on every platform, including macOS, so `npm run desktop` actually exits.
app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', shutdown);

// If the Electron process itself is signalled (e.g. Ctrl+C on `npm run desktop`),
// tear down the spawned server and its go2rtc child before exiting.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    shutdown();
    app.quit();
  });
}
