'use strict'
const { app, screen, shell, BrowserWindow, WebContentsView, ipcMain } = require('electron')
const path = require('path')
const { NaverInput } = require('./naver-input.js')

const LAUNCHER_W = 630
let mainWindow
let editorView = null   // WebContentsView for embedded Naver editor

// ── 윈도우 생성 ────────────────────────────────────────────────

function createWindow() {
  const { height } = screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    width: LAUNCHER_W,
    height,
    minWidth: LAUNCHER_W,
    minHeight: 600,
    x: 0,
    y: 0,
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── 내장 에디터 (WebContentsView) ──────────────────────────────

function getEditorBounds() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  return { x: LAUNCHER_W, y: 0, width: width - LAUNCHER_W, height }
}

function openEditor(blogId) {
  if (editorView && !editorView.webContents.isDestroyed()) return

  editorView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:naver',   // 로그인 세션 유지
    }
  })
  mainWindow.contentView.addChildView(editorView)

  // 메인 윈도우를 화면 전체로 확장
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  mainWindow.setBounds({ x: 0, y: 0, width, height })
  editorView.setBounds(getEditorBounds())

  const url = blogId
    ? `https://blog.naver.com/PostWriteForm.naver?blogId=${blogId}`
    : 'https://blog.naver.com'
  editorView.webContents.loadURL(url)
}

function closeEditor() {
  if (!editorView) return
  mainWindow.contentView.removeChildView(editorView)
  if (!editorView.webContents.isDestroyed()) editorView.webContents.destroy()
  editorView = null

  const { height } = screen.getPrimaryDisplay().workAreaSize
  mainWindow.setBounds({ x: 0, y: 0, width: LAUNCHER_W, height })
}

// ── IPC ────────────────────────────────────────────────────────

ipcMain.handle('browser:launch', async (_, { blogId } = {}) => {
  try {
    openEditor(blogId)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('browser:close', async () => {
  closeEditor()
  return { ok: true }
})

ipcMain.handle('browser:status', () => ({
  running: !!(editorView && !editorView.webContents.isDestroyed()),
}))

ipcMain.handle('naver:input', async (event, { blogId, draft, imagePaths }) => {
  const send = (type, payload) => event.sender.send('naver:progress', { type, ...payload })

  try {
    // 에디터가 없거나 에디터 페이지가 아니면 열기
    if (!editorView || editorView.webContents.isDestroyed()) {
      openEditor(blogId)
    }

    const wc = editorView.webContents
    const currentUrl = wc.getURL()
    if (!currentUrl.includes('PostWriteForm')) {
      wc.loadURL(`https://blog.naver.com/PostWriteForm.naver?blogId=${blogId}`)
    }

    // 에디터 페이지 로드 완료 대기
    send('log', { level: 'info', msg: '에디터 페이지 로드 중...' })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('에디터 로드 타임아웃 (15초)')), 15000)
      const onLoad = () => { clearTimeout(timer); resolve() }
      if (wc.isLoading()) {
        wc.once('did-finish-load', onLoad)
      } else {
        onLoad()
      }
    })
    await new Promise(r => setTimeout(r, 1500))  // SE3 렌더링 대기
    send('log', { level: 'ok', msg: '에디터 준비됨 ✓' })

    const input = new NaverInput(wc, send)
    await input.run(draft, imagePaths)

    send('log', { level: 'ok', msg: '✅ 입력 완료 — 내용 확인 후 직접 발행하세요' })
    return { ok: true }
  } catch (e) {
    send('log', { level: 'error', msg: `오류: ${e.message}` })
    return { ok: false, error: e.message }
  }
})
