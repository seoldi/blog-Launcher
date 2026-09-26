'use strict'
const { spawn } = require('child_process')
const path = require('path')
const { homedir } = require('os')
const { existsSync } = require('fs')
const puppeteer = require('puppeteer-core')

const DEBUG_PORT = 9222
const PROFILE_DIR = path.join(homedir(), '.blog-launcher', 'chrome-profile')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].filter(Boolean)

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p
  }
  throw new Error(
    'Chrome을 찾지 못했습니다.\n환경변수 CHROME_PATH에 chrome.exe 경로를 지정해주세요.'
  )
}

class BrowserManager {
  constructor() {
    this.browser = null
    this.chromeProc = null
  }

  isRunning() { return !!this.browser }

  async launch() {
    if (this.browser) return this.browser

    const chromePath = findChrome()

    this.chromeProc = spawn(chromePath, [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      'https://www.naver.com',
    ])

    this.chromeProc.on('exit', () => {
      this.browser = null
      this.chromeProc = null
    })

    await this._waitForDebugger(10000)

    this.browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
      defaultViewport: null,
    })

    return this.browser
  }

  async close() {
    if (this.browser) {
      try { await this.browser.disconnect() } catch {}
      this.browser = null
    }
    if (this.chromeProc) {
      this.chromeProc.kill()
      this.chromeProc = null
    }
  }

  async getEditorPage(blogId) {
    const browser = await this.launch()
    const pages = await browser.pages()

    let page = pages.find(p => p.url().includes('PostWriteForm'))
    if (page) {
      await page.bringToFront()
      return page
    }

    page = await browser.newPage()
    await page.goto(
      `https://blog.naver.com/PostWriteForm.naver?blogId=${blogId}`,
      { waitUntil: 'domcontentloaded', timeout: 15000 }
    )
    await new Promise(r => setTimeout(r, 3000))
    return page
  }

  async _waitForDebugger(timeout) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
        if (res.ok) return
      } catch {}
      await new Promise(r => setTimeout(r, 300))
    }
    throw new Error('Chrome 디버거 연결 시간 초과')
  }
}

module.exports = { BrowserManager }
