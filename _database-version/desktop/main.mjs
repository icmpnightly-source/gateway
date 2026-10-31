// The desktop app: a window onto the engine, which runs in this same process.
//
// The window is only a view. Closing it leaves the gateway serving requests,
// with an icon in the tray to bring the window back or to quit for real.

import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, safeStorage, shell } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEngine } from './engine/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));

// A run that only proves the packaged app starts: own data folder, no window
// left open. Set by the build.
const SMOKE = process.env.KONGGATE_SMOKE === '1';
if (process.env.KONGGATE_USER_DATA) app.setPath('userData', path.resolve(process.env.KONGGATE_USER_DATA));

// The built UI ships inside the app; a checkout uses the frontend's own build.
const UI_DIR = [path.join(here, 'ui'), path.join(here, '..', 'frontend', 'dist')].find(existsSync);

const TEXTS = {
  uz: {
    open: "KongGate'ni ochish",
    quit: 'Chiqish',
    stillRunning: "KongGate ishlashda davom etmoqda. Shlyuzni to'xtatish uchun shu belgidan «Chiqish»ni tanlang.",
    failed: "KongGate ishga tushmadi",
    view: "Ko'rinish",
  },
  ru: {
    open: 'Открыть KongGate',
    quit: 'Выход',
    stillRunning: 'KongGate продолжает работать. Чтобы остановить шлюз, выберите «Выход» в меню этого значка.',
    failed: 'KongGate не запустился',
    view: 'Вид',
  },
};
const text = () => (app.getLocale().startsWith('ru') ? TEXTS.ru : TEXTS.uz);

let engine;
let window;
let tray;
let isQuitting = false;

function logFile() {
  const folder = app.getPath('userData');
  mkdirSync(folder, { recursive: true });
  return path.join(folder, 'konggate.log');
}

function report(error) {
  const line = `${new Date().toISOString()} ${error?.stack ?? error}\n`;
  try {
    appendFileSync(logFile(), line);
  } catch {
    // Nowhere to write: the app itself still works.
  }
  if (!app.isPackaged) console.error(error);
}

// Keeps the database password unreadable on disk for anyone but this Windows user.
const vault = {
  seal: (plain) =>
    safeStorage.isEncryptionAvailable()
      ? `os:${safeStorage.encryptString(plain).toString('base64')}`
      : `plain:${Buffer.from(plain, 'utf8').toString('base64')}`,
  open: (sealed) => (sealed.startsWith('os:') ? safeStorage.decryptString(Buffer.from(sealed.slice(3), 'base64')) : null),
};

function showWindow() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'KongGate',
    icon: path.join(here, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#f5f7fa',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  window.once('ready-to-show', () => {
    if (!SMOKE) window.show();
  });

  // The window shows the app and nothing else: links to other sites open in
  // the user's own browser.
  const isOwn = (url) => url.startsWith(`${engine.url}/`) || url.startsWith(engine.url.replace('127.0.0.1', 'localhost'));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !isOwn(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isOwn(url)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  // Closing the window is not stopping the gateway.
  window.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window.hide();
    tray?.displayBalloon?.({ title: 'KongGate', content: text().stillRunning, iconType: 'info' });
  });

  void window.loadURL(engine.url);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(here, 'assets', 'tray.png')));
  tray.setToolTip('KongGate');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: text().open, click: showWindow },
      { type: 'separator' },
      { label: text().quit, click: () => app.quit() },
    ]),
  );
  tray.on('click', showWindow);
}

function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'KongGate', submenu: [{ label: text().quit, accelerator: 'Ctrl+Q', click: () => app.quit() }] },
      { role: 'editMenu' },
      {
        label: text().view,
        submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }],
      },
    ]),
  );
}

// Starts, looks at what the window shows, says so, and leaves.
async function smokeTest() {
  const finish = (ok, details) => {
    console.log(JSON.stringify({ ok, ...details }));
    isQuitting = true;
    app.exit(ok ? 0 : 1);
  };

  window.webContents.once('did-fail-load', (_event, code, description) => finish(false, { error: `${code} ${description}` }));
  window.webContents.once('did-finish-load', async () => {
    try {
      // Give the page a moment to draw itself and ask for the status.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const seen = await window.webContents.executeJavaScript(
        `(async () => ({
           title: document.title,
           path: location.pathname,
           heading: document.querySelector('h3')?.textContent ?? null,
           status: await fetch('/api/status').then((response) => response.json()),
         }))()`,
      );
      finish(seen.title === 'KongGate' && typeof seen.status?.gateway?.port === 'number', seen);
    } catch (error) {
      finish(false, { error: String(error) });
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  // Already running: that copy shows its window instead.
  app.quit();
} else {
  app.on('second-instance', showWindow);
  process.on('uncaughtException', report);
  process.on('unhandledRejection', report);

  app.whenReady().then(async () => {
    try {
      engine = await startEngine({
        settingsFile: path.join(app.getPath('userData'), 'settings.json'),
        uiDir: UI_DIR,
        vault,
        version,
        report,
      });
    } catch (error) {
      report(error);
      dialog.showErrorBox(text().failed, String(error?.message ?? error));
      app.exit(1);
      return;
    }

    createMenu();
    createWindow();
    if (SMOKE) await smokeTest();
    else createTray();
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });
  // With its window hidden the app is still at work.
  app.on('window-all-closed', () => undefined);
  app.on('will-quit', (event) => {
    if (!engine) return;
    event.preventDefault();
    const stopping = engine;
    engine = undefined;
    stopping.stop().catch(report).finally(() => app.quit());
  });
}
