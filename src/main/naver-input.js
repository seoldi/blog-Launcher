'use strict'
const { clipboard, nativeImage } = require('electron')

const SLEEP = ms => new Promise(r => setTimeout(r, ms))

class NaverInput {
  constructor(page, log) {
    this.page = page
    this.log = log
  }

  async run(draft, imagePaths = []) {
    const { titles, body, tags } = draft
    const title = Array.isArray(titles) ? titles[0] : titles

    this.log('log', { level: 'info', msg: '에디터 프레임 탐색 중...' })
    const frames = await this._findEditorFrames()
    this.log('log', { level: 'ok', msg: '에디터 프레임 확인 ✓' })

    this.log('log', { level: 'info', msg: '템플릿 적용 중...' })
    await this._applyTemplate()
    this.log('log', { level: 'ok', msg: '설디그래픽스 템플릿 적용 ✓' })

    this.log('log', { level: 'info', msg: '제목 입력 중...' })
    await this._inputTitle(frames, title)
    await SLEEP(400)

    const paras = body.split(/\n+/).map(p => p.trim()).filter(Boolean)
    const m     = imagePaths.length

    // 이미지를 단락 사이에 균등 분배
    // 이미지 i는 paras[floor((i+1)*n/(m+1))] 뒤에 삽입
    const insertAfterPara = imagePaths.map((_, i) =>
      Math.floor((i + 1) * paras.length / (m + 1))
    )

    // 본문 맨 위로 이동 — 템플릿 기존 내용 위에 초안 삽입
    await this._goToBodyStart(frames)

    if (paras.length > 0) {
      for (let p = 0; p < paras.length; p++) {
        if (p > 0) {
          await this.page.keyboard.press('Enter')
          await SLEEP(200)
        }
        await this._typeInBody(frames, paras[p])
        await SLEEP(200)

        for (let i = 0; i < m; i++) {
          if (insertAfterPara[i] === p) {
            this.log('log', { level: 'info', msg: `이미지 삽입 중 (${i + 1}/${m})` })
            await this.page.keyboard.press('Enter')
            await SLEEP(200)
            await this._insertImage(frames, imagePaths[i])
            this.log('log', { level: 'ok', msg: `  이미지 ${i + 1} ✓` })
          }
        }
      }
    } else {
      // 본문 없이 이미지만 있는 경우
      for (let i = 0; i < m; i++) {
        this.log('log', { level: 'info', msg: `이미지 삽입 중 (${i + 1}/${m})` })
        if (i > 0) {
          await this.page.keyboard.press('Enter')
          await SLEEP(200)
        }
        await this._insertImage(frames, imagePaths[i])
        this.log('log', { level: 'ok', msg: `  이미지 ${i + 1} ✓` })
      }
    }

    // 초안과 템플릿 내용 사이 여백
    await this.page.keyboard.press('Enter')
    await SLEEP(200)

    if (tags?.length) {
      this.log('log', { level: 'info', msg: '태그 입력 중...' })
      await this._inputTags(tags)
    }
  }

  // 모든 프레임(메인 + iframe)에서 텍스트로 요소를 찾아 클릭
  async _clickByText(text, { timeout = 3000, exact = false } = {}) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      for (const frame of this.page.frames()) {
        const clicked = await frame.evaluate((txt, exactMatch) => {
          const norm = s => s.trim().replace(/\s+/g, '')
          const el = Array.from(document.querySelectorAll('button, [role="tab"], li, a, span, div, p'))
            .find(e => exactMatch
              ? norm(e.textContent) === norm(txt)
              : e.textContent.includes(txt)
            )
          if (el) { el.click(); return true }
          return false
        }, text, exact).catch(() => false)
        if (clicked) return true
      }
      await SLEEP(300)
    }
    return false
  }

  async _applyTemplate() {
    // 우측상단 템플릿 버튼 클릭
    const templateClicked = await this.page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('button, [role="button"], a, span'))
        .find(e => {
          const txt = e.textContent.trim()
          return txt === '템플릿' || e.getAttribute('aria-label') === '템플릿' || e.title === '템플릿'
        })
      if (el) { el.click(); return true }
      return false
    })
    if (!templateClicked) throw new Error('템플릿 버튼을 찾지 못했습니다')
    await SLEEP(1000)

    // '내 템플릿' 탭 클릭 — 모든 프레임 순회, 공백 정규화
    const myTabClicked = await this._clickByText('내 템플릿', { timeout: 4000, exact: true })
    if (!myTabClicked) throw new Error('내 템플릿 탭을 찾지 못했습니다')
    await SLEEP(800)

    // '설디그래픽스' 템플릿 항목 클릭 — 모든 프레임 순회
    const templateApplied = await this._clickByText('설디그래픽스', { timeout: 4000, exact: false })
    if (!templateApplied) throw new Error('설디그래픽스 템플릿 항목을 찾지 못했습니다')
    await SLEEP(800)

    // 적용 확인 다이얼로그 처리 (뜨는 경우에만)
    await this._clickByText('적용', { timeout: 1500, exact: true }).catch(() => {})
    await SLEEP(1000)
  }

  async _findEditorFrames(retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) {
        this.log('log', { level: 'warn', msg: `프레임 재탐색 (${attempt + 1}/${retries})...` })
        await SLEEP(1500)
      }

      const allFrames = this.page.frames()
      let titleFrame = null
      let bodyFrame  = null

      for (const frame of allFrames) {
        try {
          if (!titleFrame) {
            const hasTitleEl = await frame.evaluate(() =>
              !!(document.querySelector('.se-title-text') ||
                 document.querySelector('[data-ce-name="title"]'))
            ).catch(() => false)
            if (hasTitleEl) titleFrame = frame
          }

          if (!bodyFrame) {
            const isBody = await frame.evaluate(() =>
              document.body?.contentEditable === 'true' || document.designMode === 'on'
            ).catch(() => false)
            if (isBody) bodyFrame = frame
          }
        } catch {}
      }

      if (titleFrame && bodyFrame) return { titleFrame, bodyFrame }
    }
    throw new Error('SE3 에디터 프레임을 찾지 못했습니다. 블로그 쓰기 페이지가 열려 있는지 확인하세요.')
  }

  async _inputTitle({ titleFrame }, title) {
    const el = (await titleFrame.$('.se-title-text')) ||
               (await titleFrame.$('[data-ce-name="title"]'))
    if (!el) throw new Error('제목 요소 없음')
    await el.click({ clickCount: 3 })  // 트리플클릭 → 기존 텍스트 전체 선택
    await SLEEP(100)
    await this.page.keyboard.type(title, { delay: 12 })
  }

  async _goToBodyStart({ bodyFrame }) {
    await bodyFrame.evaluate(() => {
      document.body.focus()
      try {
        const range = document.createRange()
        range.selectNodeContents(document.body)
        range.collapse(true) // 맨 앞으로
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
      } catch {}
    })
    await SLEEP(100)
    // Ctrl+Home 으로 본문 최상단 확정
    await this.page.keyboard.down('Control')
    await this.page.keyboard.press('Home')
    await this.page.keyboard.up('Control')
    await SLEEP(200)
  }

  async _typeInBody({ bodyFrame }, text) {
    const parts = text.split(/(\*\*[^*]+\*\*)/)
    for (const part of parts) {
      if (!part) continue
      if (part.startsWith('**') && part.endsWith('**')) {
        const bold = part.slice(2, -2)
        await this.page.keyboard.down('Control')
        await this.page.keyboard.press('b')
        await this.page.keyboard.up('Control')
        await SLEEP(50)
        await this.page.keyboard.type(bold, { delay: 8 })
        await this.page.keyboard.down('Control')
        await this.page.keyboard.press('b')
        await this.page.keyboard.up('Control')
        await SLEEP(50)
      } else {
        await this.page.keyboard.type(part, { delay: 8 })
      }
    }
  }

  async _insertImage({ bodyFrame }, imageData) {
    if (!imageData) {
      this.log('log', { level: 'warn', msg: '이미지 데이터 없음' })
      return
    }
    const ni = imageData.startsWith('data:')
      ? nativeImage.createFromDataURL(imageData)
      : nativeImage.createFromPath(imageData)
    if (ni.isEmpty()) {
      this.log('log', { level: 'warn', msg: '이미지 로드 실패' })
      return
    }
    clipboard.writeImage(ni)
    await SLEEP(200)

    // click() 없이 focus()만 — 커서 위치 유지
    await bodyFrame.evaluate(() => document.body.focus())
    await SLEEP(100)
    await this.page.keyboard.down('Control')
    await this.page.keyboard.press('v')
    await this.page.keyboard.up('Control')
    await SLEEP(1500)
  }

  async _inputTags(tags) {
    try {
      // 발행 버튼 클릭 → 발행 패널 열기
      const publishBtn = await this.page.waitForSelector(
        '.publish_btn, .btn_publish, [class*="publish"]:not([class*="cancel"]):not([class*="close"]):not([class*="prev"]), button[data-log-actionid*="publish"]',
        { timeout: 4000 }
      )
      await publishBtn.click()
      await SLEEP(800)

      // 발행 패널 내 태그 입력창
      const tagInput = await this.page.waitForSelector(
        '.se-tag-input input, input[placeholder*="태그"], input[class*="tag"], .wrap_tag input, .tag_input input',
        { timeout: 4000 }
      )
      for (const tag of tags) {
        await tagInput.click()
        await tagInput.type(tag, { delay: 20 })
        await this.page.keyboard.press('Enter')
        await SLEEP(300)
      }
      this.log('log', { level: 'ok', msg: `태그 ${tags.length}개 입력 ✓ — 발행 패널 확인 후 직접 발행하세요` })
    } catch (e) {
      this.log('log', { level: 'warn', msg: `태그 입력 건너뜀: ${e.message}` })
    }
  }
}

module.exports = { NaverInput }
