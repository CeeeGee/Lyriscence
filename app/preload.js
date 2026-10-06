const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  onMedia: cb => ipcRenderer.on('media', (_, d) => cb(d)),
  getLyrics: q => ipcRenderer.invoke('lyrics', q),
  cmd: c => ipcRenderer.send('media-cmd', c),          // 'toggle' | 'next' | 'prev'
  win: a => ipcRenderer.send('win-action', a),         // 'close' | 'min' | 'max'
  resize: (w, h) => ipcRenderer.send('win-resize', { w, h }),
  onMood: cb => ipcRenderer.on('mood', (_, h) => cb(h)),   // hue (0-360) worked out from the lyrics
  onMax: cb => ipcRenderer.on('maxstate', (_, s) => cb(s)),
});
