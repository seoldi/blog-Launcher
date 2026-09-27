import { generateDraft, extractPlaceInfo } from '../../shared/ai.js'

// ── 설정 로드/저장 ──────────────────────────────────────────────

const STORAGE_KEY = 'blog-launcher-settings'
const VAULT_KEY   = 'blog-launcher-vault'

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') } catch { return {} }
}
function saveSettings(data) {
  const prev = loadSettings()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, ...data }))
}

let cfg = loadSettings()

// ── 탭 전환 ──────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.tab
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'))
    btn.classList.add('active')
    document.querySelector(`.tab-content[data-tab="${name}"]`).classList.add('active')
  })
})

// ── 프로파일 버튼 ────────────────────────────────────────────────

const profileInput  = document.getElementById('profile')
const localUrlGroup = document.getElementById('local-url-group')

document.querySelectorAll('.profile-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.profile-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    profileInput.value = btn.dataset.profile
    localUrlGroup.classList.toggle('hidden', btn.dataset.profile !== 'local')
  })
})

// ── 브라우저 상태 ─────────────────────────────────────────────────

const statusDot  = document.getElementById('status-dot')
const statusText = document.getElementById('status-text')
const toggleBtn  = document.getElementById('browser-toggle')

let browserOn = false

async function refreshBrowserStatus() {
  const { running } = await window.api.browserStatus()
  browserOn = running
  statusDot.className   = 'status-dot ' + (running ? 'on' : 'off')
  statusText.textContent = running ? '실행 중' : '꺼짐'
  toggleBtn.textContent  = running ? '끄기' : '켜기'
}

toggleBtn.addEventListener('click', async () => {
  toggleBtn.disabled = true
  if (browserOn) {
    await window.api.closeBrowser()
  } else {
    const res = await window.api.launchBrowser({ blogId: cfg.blogId })
    if (!res.ok) alert(`에디터 실행 오류: ${res.error}`)
  }
  await refreshBrowserStatus()
  toggleBtn.disabled = false
})

refreshBrowserStatus()

// ── 이미지 선택 ──────────────────────────────────────────────────

const imageInput = document.getElementById('image-input')
const imageDrop  = document.getElementById('image-drop')
const imageList  = document.getElementById('image-list')

let selectedImages = []

imageDrop.addEventListener('click', () => imageInput.click())
imageInput.addEventListener('change', () => addFiles(Array.from(imageInput.files)))

imageDrop.addEventListener('dragover', e => { e.preventDefault(); imageDrop.classList.add('drag-over') })
imageDrop.addEventListener('dragleave', () => imageDrop.classList.remove('drag-over'))
imageDrop.addEventListener('drop', e => {
  e.preventDefault()
  imageDrop.classList.remove('drag-over')
  addFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')))
})

function addFiles(files) {
  for (const file of files) {
    const reader = new FileReader()
    reader.onload = e => {
      selectedImages.push({ path: file.path, name: file.name, dataUrl: e.target.result })
      renderImageList()
    }
    reader.readAsDataURL(file)
  }
}

function showImageNotice(msg) {
  let el = document.getElementById('image-notice')
  if (!el) {
    el = document.createElement('p')
    el.id = 'image-notice'
    el.style.cssText = 'color:var(--orange,#F97316);font-size:12px;margin:6px 0 0;text-align:center'
    imageDrop.insertAdjacentElement('afterend', el)
  }
  el.textContent = msg
  el.style.display = 'block'
  clearTimeout(el._t)
  el._t = setTimeout(() => { el.style.display = 'none' }, 5000)
}

function renderImageList() {
  imageList.innerHTML = ''
  selectedImages.forEach((img, i) => {
    const div = document.createElement('div')
    div.className = 'image-item'
    div.innerHTML = `
      <img src="${img.dataUrl}" alt="${img.name}" />
      <span class="order">${i + 1}</span>
      <button class="remove" data-i="${i}">✕</button>
    `
    imageList.appendChild(div)
  })
  imageList.querySelectorAll('.remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      selectedImages.splice(+btn.dataset.i, 1)
      renderImageList()
    })
  })
}

// ── 키워드 태그 입력 ─────────────────────────────────────────────

const kwTagWrap    = document.getElementById('kw-tag-wrap')
const kwTagInput   = document.getElementById('kw-tag-input')
const kwTagCount   = document.getElementById('kw-tag-count')
const keywordHidden = document.getElementById('keyword')
let kwTags = []

function renderKwTags() {
  kwTagWrap.querySelectorAll('.kw-tag').forEach(t => t.remove())
  kwTags.forEach((tag, i) => {
    const el = document.createElement('span')
    el.className = 'kw-tag'
    el.innerHTML = `${tag}<button class="kw-tag-remove" data-i="${i}" type="button">×</button>`
    kwTagWrap.insertBefore(el, kwTagInput)
  })
  kwTagCount.textContent = `${kwTags.length}/10`
  keywordHidden.value = kwTags.join(' ')
}

kwTagInput.addEventListener('keydown', e => {
  const val = kwTagInput.value.trim()
  if ((e.key === 'Enter' || e.key === ' ') && val) {
    e.preventDefault()
    if (kwTags.length < 10 && !kwTags.includes(val)) {
      kwTags.push(val)
      kwTagInput.value = ''
      renderKwTags()
    }
  }
  if (e.key === 'Backspace' && !kwTagInput.value && kwTags.length) {
    kwTags.pop()
    renderKwTags()
  }
})

kwTagWrap.addEventListener('click', e => {
  const removeBtn = e.target.closest('.kw-tag-remove')
  if (removeBtn) {
    kwTags.splice(+removeBtn.dataset.i, 1)
    renderKwTags()
  } else {
    kwTagInput.focus()
  }
})

// ── 장소 URL 불러오기 ─────────────────────────────────────────────

let placeInfo = null

document.getElementById('load-place-btn').addEventListener('click', async () => {
  const url = document.getElementById('place-url').value.trim()
  if (!url) return
  const btn = document.getElementById('load-place-btn')
  btn.textContent = '로딩...'
  btn.disabled = true
  try {
    const apiKey = cfg.apiKey
    const model  = cfg.model || 'gemini-2.5-flash'
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const text = await res.text()
    placeInfo = await extractPlaceInfo({ apiKey, model, pageText: text.slice(0, 6000), url })
    const prev = document.getElementById('place-info-preview')
    prev.classList.remove('hidden')
    prev.textContent = `${placeInfo.placeName || '?'} · ${placeInfo.category || ''} · ${placeInfo.address || ''}`
  } catch (e) {
    alert(`장소 정보 불러오기 실패: ${e.message}`)
  } finally {
    btn.textContent = '불러오기'
    btn.disabled = false
  }
})

// ── 초안 생성 ────────────────────────────────────────────────────

let draft = null
const genBtn = document.getElementById('gen-btn')

genBtn.addEventListener('click', async () => {
  const apiKey  = cfg.apiKey
  const model   = cfg.model || 'gemini-2.5-flash'
  const keyword = document.getElementById('keyword').value.trim()
  const profile = document.getElementById('profile').value

  if (!apiKey) { alert('설정 탭에서 Gemini API 키를 입력하세요'); return }
  if (!keyword) { alert('핵심 키워드를 입력하세요'); return }
  if (!selectedImages.length) { alert('이미지를 1장 이상 선택하세요'); return }

  genBtn.disabled = true
  genBtn.textContent = '생성 중...'

  try {
    const images = selectedImages.map(img => {
      const [, mimeType, b64] = img.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
      return { type: mimeType, data: b64, name: img.name }
    })

    draft = await generateDraft({
      apiKey, model, images,
      keyword,
      highlights: document.getElementById('highlights').value.trim(),
      profile,
      placeInfo: profile === 'local' ? placeInfo : null,
    })

    renderDraftResult()
  } catch (e) {
    alert(`오류: ${e.message}`)
  } finally {
    genBtn.disabled = false
    genBtn.textContent = '✨ AI 초안 생성'
  }
})

function renderDraftResult(skipSave = false) {
  if (!draft) return
  document.getElementById('draft-empty').classList.add('hidden')
  document.getElementById('draft-result').classList.remove('hidden')

  const titleList = document.getElementById('title-list')
  titleList.innerHTML = ''
  draft.titles.forEach((t, i) => {
    const div = document.createElement('div')
    div.className = 'title-option' + (i === 0 ? ' selected' : '')
    div.innerHTML = `<input type="radio" name="title" value="${i}" ${i===0?'checked':''}> <span>${t}</span>`
    div.querySelector('input').addEventListener('change', () => {
      document.querySelectorAll('.title-option').forEach(el => el.classList.remove('selected'))
      div.classList.add('selected')
    })
    titleList.appendChild(div)
  })

  document.getElementById('draft-body').value = draft.body

  const tagList = document.getElementById('tag-list')
  tagList.innerHTML = ''
  ;(draft.tags ?? []).forEach(tag => {
    const chip = document.createElement('span')
    chip.className = 'tag-chip'
    chip.textContent = tag
    tagList.appendChild(chip)
  })

  if (!skipSave) saveToVault(draft)
  updateInputPreview()
}

// ── 보관함 ───────────────────────────────────────────────────────

function loadVault() {
  try { return JSON.parse(localStorage.getItem(VAULT_KEY) ?? '[]') } catch { return [] }
}

function saveToVault(item) {
  const vault = loadVault()
  vault.unshift({
    id: Date.now(),
    date: new Date().toLocaleString('ko-KR'),
    titles: item.titles ?? [],
    body:   item.body  ?? '',
    tags:   item.tags  ?? [],
  })
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault.slice(0, 50)))
  renderVault()
}

function renderVault() {
  const vault = loadVault()
  const list  = document.getElementById('vault-list')
  if (!vault.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">📁</div>
        <div class="text">저장된 초안이 없습니다</div>
        <div class="sub">AI 초안 생성 시 자동 저장됩니다</div>
      </div>`
    return
  }
  list.innerHTML = vault.map(item => `
    <div class="vault-item" data-id="${item.id}">
      <div class="vault-item-header">
        <div class="vault-item-title">${item.titles?.[0] ?? '제목 없음'}</div>
        <div class="vault-item-date">${item.date}</div>
      </div>
      <div class="vault-item-body">${item.body.slice(0, 120)}…</div>
      <div class="vault-item-footer">
        <button class="btn-vault-load" data-id="${item.id}">불러오기</button>
        <button class="btn-vault-del" data-id="${item.id}">삭제</button>
      </div>
    </div>
  `).join('')

  list.querySelectorAll('.btn-vault-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const updated = loadVault().filter(v => v.id !== +btn.dataset.id)
      localStorage.setItem(VAULT_KEY, JSON.stringify(updated))
      renderVault()
    })
  })

  list.querySelectorAll('.btn-vault-load').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = loadVault().find(v => v.id === +btn.dataset.id)
      if (!item) return
      draft = item
      renderDraftResult(true)
      document.querySelector('.tab-btn[data-tab="photo"]').click()
      if (!selectedImages.length) showImageNotice('이미지는 보관되지 않습니다 — 직접 추가하세요')
    })
  })
}

renderVault()

// ── 초기화 버튼 ──────────────────────────────────────────────────

document.getElementById('reset-btn').addEventListener('click', () => {
  kwTags = []
  renderKwTags()
  selectedImages = []
  renderImageList()
  document.getElementById('highlights').value = ''
  document.getElementById('use-grounding').checked = false
  document.getElementById('draft-empty').classList.remove('hidden')
  document.getElementById('draft-result').classList.add('hidden')
  draft = null
})

// ── 에디터 입력 탭 연동 ──────────────────────────────────────────

document.getElementById('to-input-btn').addEventListener('click', () => {
  document.querySelector('.tab-btn[data-tab="editor"]').click()
})

function updateInputPreview() {
  const preview  = document.getElementById('input-preview')
  const inputBtn = document.getElementById('input-btn')
  if (!draft) return

  const titleIdx = +(document.querySelector('input[name="title"]:checked')?.value ?? 0)
  const title = draft.titles[titleIdx]
  const body  = document.getElementById('draft-body').value

  preview.innerHTML = `
    <div class="preview-title">${title}</div>
    <div class="preview-body">${body}</div>
  `
  inputBtn.disabled = false
}

// ── 실제 입력 실행 ────────────────────────────────────────────────

const inputBtn  = document.getElementById('input-btn')
const logOutput = document.getElementById('log-output')
const cfgBlogId = document.getElementById('blog-id-input')

if (cfg.blogId) cfgBlogId.value = cfg.blogId

function addLog({ level, msg }) {
  const line = document.createElement('div')
  line.className = `log-line ${level}`
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
  logOutput.appendChild(line)
  logOutput.scrollTop = logOutput.scrollHeight
}

document.getElementById('clear-log-btn').addEventListener('click', () => {
  logOutput.textContent = '대기 중...'
})

window.api.onProgress(addLog)

inputBtn.addEventListener('click', async () => {
  if (!draft) return
  const blogId = cfgBlogId.value.trim() || cfg.blogId
  if (!blogId) { alert('Blog ID를 입력하세요'); return }

  const titleIdx = +(document.querySelector('input[name="title"]:checked')?.value ?? 0)

  const finalDraft = {
    titles: draft.titles,
    body: document.getElementById('draft-body').value,
    tags: draft.tags ?? [],
  }

  inputBtn.disabled = true
  saveSettings({ blogId })

  const res = await window.api.inputContent({
    blogId,
    draft: finalDraft,
    imagePaths: selectedImages.map(img => img.dataUrl),
  })

  inputBtn.disabled = false
  if (!res.ok) addLog({ level: 'error', msg: `실패: ${res.error}` })
})

// ── 설정 탭 ──────────────────────────────────────────────────────

if (cfg.blogId)     document.getElementById('cfg-blog-id').value    = cfg.blogId
if (cfg.apiKey)     document.getElementById('cfg-api-key').value    = cfg.apiKey
if (cfg.model)      document.getElementById('cfg-model').value      = cfg.model
if (cfg.chromePath) document.getElementById('cfg-chrome-path').value = cfg.chromePath

function updateGeminiBadge() {
  const badge = document.getElementById('badge-gemini')
  if (cfg.apiKey) {
    badge.textContent = '● Gemini 사용 중'
    badge.classList.add('ok')
  } else {
    badge.textContent = '● Gemini 키 없음'
    badge.classList.remove('ok')
  }
}

updateGeminiBadge()

document.getElementById('save-settings-btn').addEventListener('click', () => {
  saveSettings({
    blogId:     document.getElementById('cfg-blog-id').value.trim(),
    apiKey:     document.getElementById('cfg-api-key').value.trim(),
    model:      document.getElementById('cfg-model').value,
    chromePath: document.getElementById('cfg-chrome-path').value.trim(),
  })
  cfg = loadSettings()
  updateGeminiBadge()

  const msg = document.getElementById('settings-saved')
  msg.classList.remove('hidden')
  setTimeout(() => msg.classList.add('hidden'), 2000)
})
