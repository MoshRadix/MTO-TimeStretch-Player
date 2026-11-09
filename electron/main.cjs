const { app, BrowserWindow, dialog, globalShortcut, ipcMain, protocol } = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
const path = require('node:path');

let mainWindow;
let lastAudioPath = null;
let selectedAudioId = null;
let savedPosition = 0;
let playbackWrite = Promise.resolve();
const defaults = { playPause: 'Alt+Space', seekBackward: 'Alt+Left', seekForward: 'Alt+Right', speedDown: 'Alt+Down', speedUp: 'Alt+Up', pitchDown: 'Ctrl+Alt+Left', pitchUp: 'Ctrl+Alt+Right' };
let shortcuts = { ...defaults };

function audioUrl() {
  selectedAudioId = randomUUID();
  return `mto-audio://selected/${selectedAudioId}`;
}

protocol.registerSchemesAsPrivileged([{ scheme: 'mto-audio', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

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
  mainWindow = new BrowserWindow({ width: 1440, height: 980, minWidth: 1040, minHeight: 720, backgroundColor: '#0c1014', title: 'MTO TimeStretch', icon: path.join(__dirname, app.isPackaged ? '../web-dist/mto-icon.png' : '../public/mto-icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    autoplayPolicy: 'no-user-gesture-required' });
  if (!app.isPackaged) mainWindow.loadURL('http://127.0.0.1:5173');
  else mainWindow.loadFile(path.join(__dirname, '../web-dist/index.html'));
}
ipcMain.handle('audio:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Open audio', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['mp3', 'wav'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  lastAudioPath = filePath; savedPosition = 0; savePlaybackState(0);
  const stat = await fs.stat(filePath);
  return { name: path.basename(filePath), path: filePath, url: audioUrl(), size: stat.size };
});
ipcMain.handle('audio:restore', async () => {
  if (!lastAudioPath) return null;
  try {
    const filePath = lastAudioPath;
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return { name: path.basename(filePath), path: filePath, url: audioUrl(), size: stat.size, position: savedPosition };
  } catch { lastAudioPath = null; savedPosition = 0; return null; }
});
ipcMain.handle('audio:read-chunk', async (_event, { filePath, offset, length }) => {
  if (filePath !== lastAudioPath) throw new Error('Audio file is no longer selected');
  const start = Math.max(0, Number(offset) || 0);
  const requested = Math.min(8 * 1024 * 1024, Math.max(1, Number(length) || 1));
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(requested);
    const { bytesRead } = await handle.read(buffer, 0, requested, start);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead);
  } finally { await handle.close(); }
});
ipcMain.on('playback:position', (_event, position) => { savePlaybackState(position); });
ipcMain.handle('settings:get', async () => { await loadSettings(); return shortcuts; });
ipcMain.handle('settings:save', async (_event, value) => {
  shortcuts = { ...defaults, ...value };
  await fs.writeFile(settingsPath(), JSON.stringify({ shortcuts }, null, 2), 'utf8');
  registerShortcuts(shortcuts);
  return shortcuts;
});
app.whenReady().then(async () => {
  protocol.handle('mto-audio', async (request) => {
    try {
      const requestId = new URL(request.url).pathname.slice(1);
      if (!lastAudioPath || !selectedAudioId || requestId !== selectedAudioId) return new Response(null, { status: 404 });
      const filePath = lastAudioPath;
      const stat = await fs.stat(filePath);
      const range = request.headers.get('range');
      let start = 0; let end = stat.size - 1; let status = 200;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
        if (!match || (!match[1] && !match[2])) {
          return new Response(null, { status: 416, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${stat.size}` } });
        }
        if (match[1]) {
          start = Number(match[1]);
          end = match[2] ? Number(match[2]) : end;
        } else {
          const suffixLength = Number(match[2]);
          if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
            return new Response(null, { status: 416, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${stat.size}` } });
          }
          start = Math.max(0, stat.size - suffixLength);
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= stat.size || start > end) {
          return new Response(null, { status: 416, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${stat.size}` } });
        }
        end = Math.min(end, stat.size - 1);
        status = 206;
      }
      const stream = createReadStream(filePath, { start, end });
      const headers = {
        'Content-Type': path.extname(filePath).toLowerCase() === '.wav' ? 'audio/wav' : 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Length': String(end - start + 1)
      };
      if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      return new Response(Readable.toWeb(stream), { status, headers });
    } catch (error) {
      console.error('Could not stream selected audio:', error);
      return new Response(null, { status: error.code === 'ENOENT' ? 404 : 500 });
    }
  });
  await Promise.all([loadSettings(), loadPlaybackState()]); createWindow(); registerShortcuts(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
let waitingForPlaybackSave = false;
app.on('before-quit', (event) => {
  if (waitingForPlaybackSave) return;
  waitingForPlaybackSave = true;
  event.preventDefault();
  playbackWrite.finally(() => app.quit());
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
