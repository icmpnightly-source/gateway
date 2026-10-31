// The desktop app: a window onto the engine, which runs in this same process.
//
// The window is only a view. What closing it means is the user's choice: leave
// the gateway serving requests, with an icon in the tray to bring the window
// back, or quit altogether, which stops the gateway and frees its port.

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
const UI_DIR = [path.join(here, '..', 'frontend', 'dist'), path.join(here, 'ui')].find(existsSync);

// The most the engine is given to stop before the app leaves regardless.
const STOP_WITHIN_MS = 5000;

const TEXTS = {
  uz: {
    open: "KongGate'ni ochish",
    quit: 'Chiqish',
    stillRunning: "KongGate ishlashda davom etmoqda. Shlyuzni to'xtatish uchun shu belgidan «Chiqish»ni tanlang.",
    failed: "KongGate ishga tushmadi",
    view: "Ko'rinish",
    closeQuestion: 'Oyna yopilmoqda. Shlyuz ishlashda davom etsinmi?',
    closeDetail:
      "Fonda qoldirilsa, shlyuz so'rovlarni qabul qilishda davom etadi va porti band turadi; ilova soat yonidagi belgida qoladi.\n\nTo'liq chiqilsa, shlyuz to'xtaydi va porti bo'shaydi.",
    keepRunning: 'Fonda ishlasin',
    quitFully: "To'liq chiqish",
    cancel: 'Bekor qilish',
    remember: 'Shu tanlov eslab qolinsin',
  },
  ru: {
    open: 'Открыть KongGate',
    quit: 'Выход',
    stillRunning: 'KongGate продолжает работать. Чтобы остановить шлюз, выберите «Выход» в меню этого значка.',
    failed: 'KongGate не запустился',
    view: 'Вид',
    closeQuestion: 'Окно закрывается. Оставить шлюз работать?',
    closeDetail:
      'Если оставить в фоне, шлюз продолжит принимать запросы и его порт останется занят; приложение останется значком рядом с часами.\n\nЕсли выйти полностью, шлюз остановится и порт освободится.',
    keepRunning: 'Оставить в фоне',
    quitFully: 'Выйти полностью',
    cancel: 'Отмена',
    remember: 'Запомнить этот выбор',
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

// Keeps the secrets' values unreadable on disk for anyone but this Windows user.
const vault = {
  seal: (plain) =>
    safeStorage.isEncryptionAvailable()
      ? `os:${safeStorage.encryptString(plain).toString('base64')}`
      : `plain:${Buffer.from(plain, 'utf8').toString('base64')}`,
  open: (sealed) => (sealed.startsWith('os:') ? safeStorage.decryptString(Buffer.from(sealed.slice(3), 'base64')) : null),
};

/**
 * Stops the gateway, frees its ports and ends the program. Everything that
 * means "quit" comes here: the menus, the tray, the window's close button when
 * that is what it is set to, and the command line's "stop".
 */
async function quit() {
  if (isQuitting) return;
  isQuitting = true;

  // Gone at once, so that nobody takes a program on its way out for a running one.
  tray?.destroy();
  if (window && !window.isDestroyed()) window.hide();

  const stopping = engine;
  engine = undefined;
  try {
    await Promise.race([stopping?.stop(), new Promise((resolve) => setTimeout(resolve, STOP_WITHIN_MS))]);
  } catch (error) {
    report(error);
  }
  // Not app.quit(): asked for from inside its own quitting, that does nothing,
  // and the program would stay behind without a window.
  app.exit(0);
}

function showWindow() {
  if (isQuitting || !engine) return;
  // The window may be gone while the gateway is not.
  if (!window || window.isDestroyed()) return createWindow();

  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function stayInTray() {
  window.hide();
  tray?.displayBalloon?.({ title: 'KongGate', content: text().stillRunning, iconType: 'info' });
}

// The window's close button, the first time and until the answer is remembered.
async function askWhatClosingMeans() {
  const { response, checkboxChecked } = await dialog.showMessageBox(window, {
    type: 'question',
    title: 'KongGate',
    message: text().closeQuestion,
    detail: text().closeDetail,
    buttons: [text().keepRunning, text().quitFully, text().cancel],
    defaultId: 0,
    cancelId: 2,
    checkboxLabel: text().remember,
    noLink: true,
  });
  if (response === 2) return;

  const choice = response === 0 ? 'tray' : 'quit';
  if (checkboxChecked) await engine.rememberOnClose(choice).catch(report);
  if (choice === 'quit') await quit();
  else stayInTray();
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
  const { url: own } = engine;
  const isOwn = (url) => url.startsWith(`${own}/`) || url.startsWith(own.replace('127.0.0.1', 'localhost'));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !isOwn(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isOwn(url)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  // What the close button does is the user's to say (Settings, or the answer
  // remembered from the question below).
  window.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();

    const onClose = engine?.onClose() ?? 'quit';
    if (onClose === 'quit') void quit();
    else if (onClose === 'tray') stayInTray();
    else void askWhatClosingMeans().catch(report);
  });

  void window.loadURL(own);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(here, 'assets', 'tray.png')));
  tray.setToolTip('KongGate');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: text().open, click: showWindow },
      { type: 'separator' },
      { label: text().quit, click: () => void quit() },
    ]),
  );
  tray.on('click', showWindow);
}

function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'KongGate', submenu: [{ label: text().quit, accelerator: 'Ctrl+Q', click: () => void quit() }] },
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
        dataFile: path.join(app.getPath('userData'), 'data.json'),
        uiDir: UI_DIR,
        vault,
        version,
        report,
        // "konggate stop", typed in a terminal.
        quit: () => void quit(),
        // The screens offer the choice of what closing the window does.
        hasWindow: true,
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

  // With its window hidden the app is still at work.
  app.on('window-all-closed', () => undefined);
  // Quitting asked for by something other than the app's own menus (Windows
  // shutting down, say) takes the same road.
  app.on('before-quit', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    void quit();
  });
}
