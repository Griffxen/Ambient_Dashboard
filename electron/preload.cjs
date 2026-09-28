const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dashboard', {
  agenda: () => ipcRenderer.invoke('agenda:get'),
  memo: () => ipcRenderer.invoke('memo:get'),
  saveMemo: (lines) => ipcRenderer.invoke('memo:save', lines),
  lanMemo: () => ipcRenderer.invoke('memo:lan'),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  weather: () => ipcRenderer.invoke('weather:get'),
  telemetry: () => ipcRenderer.invoke('telemetry:get'),
  media: () => ipcRenderer.invoke('media:get'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onCommand: (callback) => { const listener = (_event, action) => callback(action); ipcRenderer.on('control:command', listener); return () => ipcRenderer.removeListener('control:command', listener); },
  onPresence: (callback) => { const show = (_event, value) => callback(value); const clear = (_event, id) => callback({ clear: true, id }); ipcRenderer.on('presence:show', show); ipcRenderer.on('presence:clear', clear); return () => { ipcRenderer.removeListener('presence:show', show); ipcRenderer.removeListener('presence:clear', clear); }; },
  publishState: (state) => ipcRenderer.invoke('control:state', state)
});
