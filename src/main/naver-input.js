'use strict'
const { clipboard, nativeImage } = require('electron')

const SLEEP = ms => new Promise(r => setTimeout(r, ms))

class NaverInput {
  constructor(webContents, log) {
    this.wc  = webContents
    this.log = log
  }

  async run(draft, imagePaths = []) {
    const { titles, body, tags } = draft
    const title = Array.isArray(titles) ? titles[0] : titles

    this.log('log', { level: 'info', msg: '에디터 프레임 탐색 중...' })
    const { titleFrame, bodyFrame } = await this._findEditorFrames()
    this.log('log', { level: 'ok', msg: '에디터 프레임 확인 ✓' })

    this.log('log', { level: 'info', msg: '제목 입력 중...' })
    await this._inputTitle(titleFrame, title)
    await SLEEP(300)

    const paras = body.split(/\n+/).map(p => p.trim()).filter(Boolean)
    const m     = imagePaths.length
    const insertAfterPara = imagePaths.map((_, i) =>
      Math.floor((i + 1) * paras.length / (m + 1))
    )

    this.log('log', { level: 'info', msg: '본문 영역 진입 중...' })
    await this._focusBody(titleFrame, bodyFrame)
    await SLEEP(200)

    if (paras.length > 0) {
      for (let p = 0; p < paras.length; p++) {
        if (p > 0) {
          await bodyFrame.executeJavaScript(`document.execCommand('insertParagraph', false, null)`)
          await SLEEP(80)
        }
        await this._typeText(bodyFrame, paras[p])
        await SLEEP(80)

        for (let i = 0; i < m; i++) {
          if (insertAfterPara[i] === p) {
            this.log('log', { level: 'info', msg: `이미지 삽입 중 (${i + 1}/${m})` })
            await bodyFrame.executeJavaScript(`document.execCommand('insertParagraph', false, null)`)
            await SLEEP(80)
            await this._insertImage(bodyFrame, imagePaths[i])
            this.log('log', { level: 'ok', msg: `  이미지 ${i + 1} ✓` })
          }
        }
      }
    } else {
      for (let i = 0; i < m; i++) {
        this.log('log', { level: 'info', msg: `이미지 삽입 중 (${i + 1}/${m})` })
        if (i > 0) {
          await bodyFrame.executeJavaScript(`document.execCommand('insertParagraph', false, null)`)
          await SLEEP(80)
        }
        await this._insertImage(bodyFrame, imagePaths[i])
        this.log('log', { level: 'ok', msg: `  이미지 ${i + 1} ✓` })
      }
    }

    if (tags?.length) {
      this.log('log', { level: 'info', msg: '태그 입력 중...' })
      await this._inputTags(tags)
    }
  }

  // WebFrameMain API로 모든 프레임 탐색
  async _findEditorFrames(retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) {
        this.log('log', { level: 'warn', msg: `프레임 재탐색 (${attempt + 1}/${retries})...` })
        await SLEEP(1500)
      }

      const frames = this.wc.mainFrame.framesInSubtree
      let titleFrame = null
      let bodyFrame  = null

      for (const frame of frames) {
        try {
          if (!titleFrame) {
            const has = await frame.executeJavaScript(
              `!!(document.querySelector('.se-title-text') || document.querySelector('[data-ce-name="title"]'))`
            ).catch(() => false)
            if (has) titleFrame = frame
          }
          if (!bodyFrame) {
            const is = await frame.executeJavaScript(
              `document.body?.contentEditable === 'true' || document.designMode === 'on'`
            ).catch(() => false)
            if (is) bodyFrame = frame
          }
        } catch {}
        if (titleFrame && bodyFrame) break
      }

      if (titleFrame && bodyFrame) return { titleFrame, bodyFrame }
    }
    throw new Error('SE3 에디터 프레임을 찾지 못했습니다')
  }

  // execCommand 기반 제목 입력 — frame.executeJavaScript로 JS 직접 실행
  async _inputTitle(titleFrame, title) {
    const ok = await titleFrame.executeJavaScript(`
      (function() {
        const el = document.querySelector('.se-title-text') ||
                   document.querySelector('[data-ce-name="title"]')
        if (!el) return false
        el.focus()
        const range = document.createRange()
        range.selectNodeContents(el)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
        document.execCommand('insertText', false, ${JSON.stringify(title)})
        return true
      })()
    `)
    if (!ok) throw new Error('제목 요소 없음')
  }

  // 본문 포커스 — titleFrame/bodyFrame 동일 여부 분기
  async _focusBody(titleFrame, bodyFrame) {
    if (titleFrame === bodyFrame) {
      // 같은 프레임: 제목 요소 다음 형제에 포커스
      await bodyFrame.executeJavaScript(`
        (function() {
          const title = document.querySelector('.se-title-text') ||
                        document.querySelector('[data-ce-name="title"]')
          const body  = title?.nextElementSibling || document.body
          body.focus()
          try {
            const range = document.createRange()
            range.setStart(body, 0)
            range.collapse(true)
            window.getSelection().removeAllRanges()
            window.getSelection().addRange(range)
          } catch {}
        })()
      `)
    } else {
      await bodyFrame.executeJavaScript(`
        (function() {
          document.body.focus()
          try {
            const range = document.createRange()
            range.setStart(document.body, 0)
            range.collapse(true)
            window.getSelection().removeAllRanges()
            window.getSelection().addRange(range)
          } catch {}
        })()
      `)
    }
  }

  // 볼드(**text**) 포함 텍스트 입력
  async _typeText(frame, text) {
    const parts = text.split(/(\*\*[^*]+\*\*)/)
    for (const part of parts) {
      if (!part) continue
      if (part.startsWith('**') && part.endsWith('**')) {
        const bold = part.slice(2, -2)
        await frame.executeJavaScript(`
          document.execCommand('bold', false, null)
          document.execCommand('insertText', false, ${JSON.stringify(bold)})
          document.execCommand('bold', false, null)
        `)
      } else {
        await frame.executeJavaScript(
          `document.execCommand('insertText', false, ${JSON.stringify(part)})`
        )
      }
    }
  }

  // 이미지 삽입 — clipboard 후 webContents.paste()
  async _insertImage(bodyFrame, imageData) {
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

    // JS 포커스 유지 후 webContents.paste() (Ctrl+V 시뮬레이션 없이)
    await bodyFrame.executeJavaScript(`document.body.focus()`)
    await SLEEP(100)
    this.wc.paste()
    await SLEEP(1500)
  }

  async _inputTags(tags) {
    try {
      // 발행 버튼 클릭
      await this.wc.mainFrame.executeJavaScript(`
        (function() {
          const btn = Array.from(document.querySelectorAll('button, [role="button"]'))
            .find(b => b.textContent.trim() === '발행' ||
                       b.classList.contains('publish_btn') ||
                       b.getAttribute('data-log-actionid')?.includes('publish'))
          if (btn) btn.click()
        })()
      `)
      await SLEEP(1000)

      // 발행 패널 내 태그 입력 — 모든 프레임 탐색
      const frames = this.wc.mainFrame.framesInSubtree
      for (const frame of frames) {
        const ok = await frame.executeJavaScript(`
          (function() {
            const input = document.querySelector(
              '.se-tag-input input, input[placeholder*="태그"], .wrap_tag input, .tag_input input'
            )
            if (!input) return false
            input.focus()
            return true
          })()
        `).catch(() => false)
        if (ok) {
          for (const tag of tags) {
            await frame.executeJavaScript(`
              (function() {
                const input = document.querySelector(
                  '.se-tag-input input, input[placeholder*="태그"], .wrap_tag input, .tag_input input'
                )
                if (!input) return
                input.focus()
                document.execCommand('insertText', false, ${JSON.stringify(tag)})
              })()
            `)
            await SLEEP(100)
            await frame.executeJavaScript(`
              document.querySelector('.se-tag-input input, input[placeholder*="태그"], .wrap_tag input, .tag_input input')
                ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
            `)
            await SLEEP(300)
          }
          this.log('log', { level: 'ok', msg: `태그 ${tags.length}개 입력 ✓ — 직접 발행하세요` })
          return
        }
      }
      this.log('log', { level: 'warn', msg: '태그 입력창을 찾지 못해 건너뜀' })
    } catch (e) {
      this.log('log', { level: 'warn', msg: `태그 입력 건너뜀: ${e.message}` })
    }
  }
}

module.exports = { NaverInput }
