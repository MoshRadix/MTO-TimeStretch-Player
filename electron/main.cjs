const { app, BrowserWindow, dialog, globalShortcut, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

let mainWindow;
const defaults = { playPause: 'Alt+Space', speedDown: 'Alt+Down', speedUp: 'Alt+Up', pitchDown: 'Alt+Left', pitchUp: 'Alt+Right' };
let shortcuts = { ...defaults };

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
async function loadSettings() {
  try { const saved = JSON.parse(await fs.readFile(settingsPath(), 'utf8')); shortcuts = { ...defaults, ...(saved.shortcuts || {}) }; } catch { shortcuts = { ...defaults }; }
}
function registerShortcuts(next = shortcuts) {
  globalShortcut.unregisterAll();
  shortcuts = { ...defaults, ...next };
  const actions = { playPause: 'toggle-play', speedDown: 'speed-down', speedUp: 'speed-up', pitchDown: 'pitch-down', pitchUp: 'pitch-up' };
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
  return { name: path.basename(filePath), path: filePath, bytes: await fs.readFile(filePath) };
});
ipcMain.handle('settings:get', async () => { await loadSettings(); return shortcuts; });
ipcMain.handle('settings:save', async (_event, value) => {
  shortcuts = { ...defaults, ...value };
  await fs.writeFile(settingsPath(), JSON.stringify({ shortcuts }, null, 2), 'utf8');
  registerShortcuts(shortcuts);
  return shortcuts;
});
app.whenReady().then(async () => { await loadSettings(); createWindow(); registerShortcuts(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
