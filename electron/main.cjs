const { app, BrowserWindow, dialog, globalShortcut, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

let mainWindow;
let lastAudioPath = null;
let savedPosition = 0;
let playbackWrite = Promise.resolve();
const defaults = { playPause: 'Alt+Space', seekBackward: 'Alt+Left', seekForward: 'Alt+Right', speedDown: 'Alt+Down', speedUp: 'Alt+Up', pitchDown: 'Ctrl+Alt+Left', pitchUp: 'Ctrl+Alt+Right' };
let shortcuts = { ...defaults };

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function playbackPath() { return path.join(app.getPath('userData'), 'last-playback.json'); }
async function loadPlaybackState() {
  try {
    const saved = JSON.parse(await fs.readFile(playbackPath(), 'utf8'));
    if (typeof saved.path === 'string') lastAudioPath = saved.path;
    if (Number.isFinite(saved.position) && saved.position >= 0) savedPosition = saved.position;
  } catch { lastAudioPath = null; savedPosition = 0; }
}
function savePlaybackState(position = savedPosition) {
  if (!lastAudioPath) return;
  savedPosition = Number.isFinite(position) ? Math.max(0, position) : 0;
  const snapshot = JSON.stringify({ path: lastAudioPath, position: savedPosition });
  playbackWrite = playbackWrite.then(() => fs.writeFile(playbackPath(), snapshot, 'utf8')).catch((error) => console.error('Could not save playback position:', error));
}
async function loadSettings() {
  try {
    const saved = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
    const previous = saved.shortcuts || {};
    if (!previous.seekBackward && previous.pitchDown === 'Alt+Left') previous.pitchDown = defaults.pitchDown;
    if (!previous.seekForward && previous.pitchUp === 'Alt+Right') previous.pitchUp = defaults.pitchUp;
    shortcuts = { ...defaults, ...previous };
  } catch { shortcuts = { ...defaults }; }
}
function registerShortcuts(next = shortcuts) {
  globalShortcut.unregisterAll();
  shortcuts = { ...defaults, ...next };
  const actions = { playPause: 'toggle-play', seekBackward: 'seek-backward', seekForward: 'seek-forward', speedDown: 'speed-down', speedUp: 'speed-up', pitchDown: 'pitch-down', pitchUp: 'pitch-up' };
  for (const [key, accelerator] of Object.entries(shortcuts)) {
    try { if (accelerator) globalShortcut.register(accelerator, () => mainWindow?.webContents.send('global-action', actions[key])); } catch {}
  }
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 980, minWidth: 1040, minHeight: 720, backgroundColor: '#0c1014', title: 'MTO TimeStretch', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  if (!app.isPackaged) mainWindow.loadURL('http://127.0.0.1:5173');
  else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
}
ipcMain.handle('audio:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Open audio', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['mp3', 'wav'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  lastAudioPath = filePath; savedPosition = 0; savePlaybackState(0);
  return { name: path.basename(filePath), path: filePath, bytes: await fs.readFile(filePath) };
});
ipcMain.handle('audio:restore', async () => {
  if (!lastAudioPath) return null;
  try {
    const filePath = lastAudioPath;
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return { name: path.basename(filePath), path: filePath, bytes: await fs.readFile(filePath), position: savedPosition };
  } catch { lastAudioPath = null; savedPosition = 0; return null; }
});
ipcMain.on('playback:position', (_event, position) => { savePlaybackState(position); });
ipcMain.handle('settings:get', async () => { await loadSettings(); return shortcuts; });
ipcMain.handle('settings:save', async (_event, value) => {
  shortcuts = { ...defaults, ...value };
  await fs.writeFile(settingsPath(), JSON.stringify({ shortcuts }, null, 2), 'utf8');
  registerShortcuts(shortcuts);
  return shortcuts;
});
app.whenReady().then(async () => { await Promise.all([loadSettings(), loadPlaybackState()]); createWindow(); registerShortcuts(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
let waitingForPlaybackSave = false;
app.on('before-quit', (event) => {
  if (waitingForPlaybackSave) return;
  waitingForPlaybackSave = true;
  event.preventDefault();
  playbackWrite.finally(() => app.quit());
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
