'use strict'
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Electron 32+에서 File.path가 제거되어 webUtils로 경로를 얻음
  getPathForFile: (file) => webUtils.getPathForFile(file),
  launchBrowser: () => ipcRenderer.invoke('browser:launch'),
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
