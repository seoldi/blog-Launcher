'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  launchBrowser: (opts) => ipcRenderer.invoke('browser:launch', opts),
  closeBrowser:  () => ipcRenderer.invoke('browser:close'),
  browserStatus: () => ipcRenderer.invoke('browser:status'),
  inputContent:  (data) => ipcRenderer.invoke('naver:input', data),
  onProgress: (callback) => {
    ipcRenderer.on('naver:progress', (_event, data) => callback(data))
  },
  offProgress: () => {
    ipcRenderer.removeAllListeners('naver:progress')
  },
})
