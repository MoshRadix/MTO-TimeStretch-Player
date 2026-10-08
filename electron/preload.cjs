const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mto', {
  openAudio: () => ipcRenderer.invoke('audio:open'),
  getShortcuts: () => ipcRenderer.invoke('settings:get'),
  saveShortcuts: (shortcuts) => ipcRenderer.invoke('settings:save', shortcuts),
  onGlobalAction: (callback) => { const handler = (_event, action) => callback(action); ipcRenderer.on('global-action', handler); return () => ipcRenderer.removeListener('global-action', handler); }
});
