// Stages a self-contained copy of the server (source + production node_modules)
// into desktop/staging/server so electron-builder can ship it as extraResources.
//
// Why: the server runs as a separate Node process (ELECTRON_RUN_AS_NODE) and is
// ESM, so it cannot be loaded from inside the app.asar archive. Its runtime
// dependencies are also hoisted to the workspace root, so they must be installed
// in isolation and copied alongside the server source.

import { execSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, '..');
const repoRoot = resolve(desktopDir, '..');

const serverDir = join(repoRoot, 'server');
const stagingServer = join(desktopDir, 'staging', 'server');

function log(msg) {
    console.log(`[prepare-resources] ${msg}`);
}

// 1. Reset staging directory.
rmSync(join(desktopDir, 'staging'), { recursive: true, force: true });
mkdirSync(stagingServer, { recursive: true });

// 2. Copy server source + package manifest.
log('copying server source');
cpSync(join(serverDir, 'src'), join(stagingServer, 'src'), { recursive: true });
copyFileSync(join(serverDir, 'package.json'), join(stagingServer, 'package.json'));

// 3. Install production dependencies in an isolated temp dir (outside the
//    workspace) so npm does not treat them as workspace packages, then copy
//    the resulting node_modules into the staged server.
log('installing production dependencies');
const tmp = mkdtempSync(join(tmpdir(), 'rtsp-webui-server-'));
try {
    copyFileSync(join(serverDir, 'package.json'), join(tmp, 'package.json'));
    execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock', {
        cwd: tmp,
        stdio: 'inherit',
    });
    cpSync(join(tmp, 'node_modules'), join(stagingServer, 'node_modules'), { recursive: true });
} finally {
    rmSync(tmp, { recursive: true, force: true });
}

log(`staged server at ${stagingServer}`);
