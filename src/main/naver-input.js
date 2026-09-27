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

    this.log('log', { level: 'info', msg: '제목 입력 중...' })
    await this._inputTitle(frames, title)
    await SLEEP(400)

    const paras = body.split(/\n+/).map(p => p.trim()).filter(Boolean)
    const m     = imagePaths.length

    const insertAfterPara = imagePaths.map((_, i) =>
      Math.floor((i + 1) * paras.length / (m + 1))
    )

    this.log('log', { level: 'info', msg: '본문 영역 진입 중...' })
    await this._focusBody(frames)
    await SLEEP(300)

    if (paras.length > 0) {
      for (let p = 0; p < paras.length; p++) {
        if (p > 0) await this._insertParagraph(frames)
        await this._typeInBody(frames, paras[p])
        await SLEEP(150)

        for (let i = 0; i < m; i++) {
          if (insertAfterPara[i] === p) {
            this.log('log', { level: 'info', msg: `이미지 삽입 중 (${i + 1}/${m})` })
            await this._insertParagraph(frames)
            await this._insertImage(frames, imagePaths[i])
            this.log('log', { level: 'ok', msg: `  이미지 ${i + 1} ✓` })
          }
        }
      }
    } else {
      for (let i = 0; i < m; i++) {
        this.log('log', { level: 'info', msg: `이미지 삽입 중 (${i + 1}/${m})` })
        if (i > 0) await this._insertParagraph(frames)
        await this._insertImage(frames, imagePaths[i])
        this.log('log', { level: 'ok', msg: `  이미지 ${i + 1} ✓` })
      }
    }

    if (tags?.length) {
      this.log('log', { level: 'info', msg: '태그 입력 중...' })
      await this._inputTags(tags)
    }
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

  // execCommand 기반 제목 입력 — CDP 키보드/좌표 불필요
  async _inputTitle({ titleFrame }, title) {
    const ok = await titleFrame.evaluate((t) => {
      const el = document.querySelector('.se-title-text') ||
                 document.querySelector('[data-ce-name="title"]')
      if (!el) return false
      el.focus()
      // 기존 내용 전체 선택 후 새 제목으로 교체
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      document.execCommand('insertText', false, t)
      return true
    }, title)
    if (!ok) throw new Error('제목 요소 없음')
  }

  // execCommand 기반 본문 포커스 — Selection API로 커서를 본문 앞에 배치
  async _focusBody({ titleFrame, bodyFrame }) {
    const isSameFrame = titleFrame === bodyFrame

    if (isSameFrame) {
      // 같은 프레임: 제목 요소 다음 형제(본문 첫 단락)에 포커스
      await titleFrame.evaluate(() => {
        const titleEl = document.querySelector('.se-title-text') ||
                        document.querySelector('[data-ce-name="title"]')
        const bodyEl = titleEl?.nextElementSibling || document.body
        bodyEl.focus()
        try {
          const range = document.createRange()
          range.setStart(bodyEl, 0)
          range.collapse(true)
          const sel = window.getSelection()
          sel.removeAllRanges()
          sel.addRange(range)
        } catch {}
      })
    } else {
      // 별개 프레임: bodyFrame에 직접 포커스
      await bodyFrame.evaluate(() => {
        document.body.focus()
        try {
          const range = document.createRange()
          range.setStart(document.body, 0)
          range.collapse(true)
          const sel = window.getSelection()
          sel.removeAllRanges()
          sel.addRange(range)
        } catch {}
      })
    }
  }

  // execCommand로 단락 삽입
  async _insertParagraph({ bodyFrame }) {
    await bodyFrame.evaluate(() => {
      document.execCommand('insertParagraph', false, null)
    })
    await SLEEP(100)
  }

  // execCommand 기반 본문 타이핑 — 볼드(**text**) 포함
  async _typeInBody({ bodyFrame }, text) {
    const parts = text.split(/(\*\*[^*]+\*\*)/)
    for (const part of parts) {
      if (!part) continue
      if (part.startsWith('**') && part.endsWith('**')) {
        const bold = part.slice(2, -2)
        await bodyFrame.evaluate((t) => {
          document.execCommand('bold', false, null)
          document.execCommand('insertText', false, t)
          document.execCommand('bold', false, null)
        }, bold)
      } else {
        await bodyFrame.evaluate((t) => {
          document.execCommand('insertText', false, t)
        }, part)
      }
      await SLEEP(30)
    }
  }

  // 이미지 삽입 — 클립보드 붙여넣기 (CDP 필요: body frame 중앙 클릭)
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

    // 이미지 붙여넣기는 CDP Ctrl+V 필요 → body frame 중앙을 클릭해 CDP 포커스 확보
    await this._cdpFocusBody(bodyFrame)
    await SLEEP(150)
    await this.page.keyboard.down('Control')
    await this.page.keyboard.press('v')
    await this.page.keyboard.up('Control')
    await SLEEP(1500)
  }

  // 이미지 붙여넣기 전용 CDP 포커스 — body frame 중앙 클릭
  async _cdpFocusBody(bodyFrame, ctx = this.page) {
    const handles = await ctx.$$('iframe, frame').catch(() => [])
    for (const handle of handles) {
      try {
        const frame = await handle.contentFrame()
        if (!frame) continue
        if (frame === bodyFrame) {
          const box = await handle.boundingBox()
          if (box) {
            // 중앙 클릭 — 제목 영역(상단)을 피함
            await this.page.mouse.click(
              box.x + box.width / 2,
              box.y + box.height / 2
            )
            return true
          }
        }
        if (await this._cdpFocusBody(bodyFrame, frame)) return true
      } catch {}
    }
    return false
  }

  async _inputTags(tags) {
    try {
      const publishBtn = await this.page.waitForSelector(
        '.publish_btn, .btn_publish, [class*="publish"]:not([class*="cancel"]):not([class*="close"]):not([class*="prev"]), button[data-log-actionid*="publish"]',
        { timeout: 4000 }
      )
      await publishBtn.click()
      await SLEEP(800)

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
