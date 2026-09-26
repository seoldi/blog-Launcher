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

    // 이미지를 단락 사이에 균등 분배
    // 이미지 i는 paras[floor((i+1)*n/(m+1))] 뒤에 삽입
    const insertAfterPara = imagePaths.map((_, i) =>
      Math.floor((i + 1) * paras.length / (m + 1))
    )

    await this._enterBody(frames)

    if (paras.length > 0) {
      for (let p = 0; p < paras.length; p++) {
        if (p > 0) await this._enterBody(frames)
        await this._typeInBody(frames, paras[p])
        await SLEEP(200)

        for (let i = 0; i < m; i++) {
          if (insertAfterPara[i] === p) {
            this.log('log', { level: 'info', msg: `이미지 삽입 중 (${i + 1}/${m})` })
            await this._enterBody(frames)
            await this._insertImage(frames, imagePaths[i])
            this.log('log', { level: 'ok', msg: `  이미지 ${i + 1} ✓` })
          }
        }
      }
    } else {
      // 본문 없이 이미지만 있는 경우
      for (let i = 0; i < m; i++) {
        this.log('log', { level: 'info', msg: `이미지 삽입 중 (${i + 1}/${m})` })
        if (i > 0) await this._enterBody(frames)
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

  async _inputTitle({ titleFrame }, title) {
    const el = (await titleFrame.$('.se-title-text')) ||
               (await titleFrame.$('[data-ce-name="title"]'))
    if (!el) throw new Error('제목 요소 없음')
    await el.click({ clickCount: 3 })  // 트리플클릭 → 기존 텍스트 전체 선택
    await SLEEP(100)
    await this.page.keyboard.type(title, { delay: 12 })
  }

  async _enterBody({ bodyFrame }) {
    await bodyFrame.evaluate(() => {
      document.body.click()
      document.body.focus()
    })
    await SLEEP(100)
    await this.page.keyboard.press('Enter')
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

    await bodyFrame.evaluate(() => {
      document.body.click()
      document.body.focus()
    })
    await SLEEP(200)
    await this.page.keyboard.down('Control')
    await this.page.keyboard.press('v')
    await this.page.keyboard.up('Control')
    await SLEEP(1500)
  }

  async _inputTags(tags) {
    try {
      const tagInput = await this.page.waitForSelector(
        '.se-tag-input input, input[placeholder*="태그"], input[class*="tag"]',
        { timeout: 3000 }
      )
      for (const tag of tags) {
        await tagInput.click()
        await tagInput.type(tag, { delay: 20 })
        await this.page.keyboard.press('Enter')
        await SLEEP(200)
      }
    } catch {
      this.log('log', { level: 'warn', msg: '태그 영역을 찾지 못해 건너뜀' })
    }
  }
}

module.exports = { NaverInput }
