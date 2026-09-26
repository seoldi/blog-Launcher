'use strict'
const { app, shell, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { BrowserManager } = require('./browser.js')
const { NaverInput } = require('./naver-input.js')

const browserMgr = new BrowserManager()
let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#F5F0E8',
    title: '설디 블로그 런처',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.loadFile(path.join(__dirname, '../../src/renderer/index.html'))
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await browserMgr.close()
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC: 브라우저 제어 ─────────────────────────────────────────

ipcMain.handle('browser:launch', async () => {
  try {
    await browserMgr.launch()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('browser:close', async () => {
  try {
    await browserMgr.close()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('browser:status', () => ({
  running: browserMgr.isRunning(),
}))

// ── IPC: 네이버 에디터 입력 ────────────────────────────────────

ipcMain.handle('naver:input', async (event, { blogId, draft, imagePaths }) => {
  const send = (type, payload) => {
    event.sender.send('naver:progress', { type, ...payload })
  }

  try {
    send('log', { level: 'info', msg: '브라우저 연결 중...' })
    const page = await browserMgr.getEditorPage(blogId)
    send('log', { level: 'ok', msg: '에디터 페이지 준비됨 ✓' })

    const input = new NaverInput(page, send)
    await input.run(draft, imagePaths)

    send('log', { level: 'ok', msg: '✅ 입력 완료 — 내용 확인 후 직접 발행하세요' })
    return { ok: true }
  } catch (e) {
    send('log', { level: 'error', msg: `오류: ${e.message}` })
    return { ok: false, error: e.message }
  }
})
