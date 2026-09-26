import { DEFAULT_COMMON_STYLE, DEFAULT_PROFILES } from './prompts.js';

// ── 프로파일별 블로그 스타일 ─────────────────────────────────────
// overrides: { common, seoldi, income } — 비어있으면 prompts.js 기본값 사용

function getBlogStyle(profile, overrides = {}) {
  const profileStr = overrides[profile]?.trim() || (DEFAULT_PROFILES[profile] ?? DEFAULT_PROFILES.income);
  const commonStr  = overrides.common?.trim()   || DEFAULT_COMMON_STYLE;
  return profileStr + commonStr;
}

const BLOG_FOOTER = `작업문의\n메일 : contact@seoldi.com l 카카오톡 : seoldi\n\nhttp://pf.kakao.com/_xnxoSkn/chat`;

function buildExBlock(examples) {
  if (!examples?.length) return '';
  let block = '\n[참조 글 예시 — 아래 글들의 문체·호흡·온도를 그대로 따라 쓰세요]\n';
  examples.slice(0, 3).forEach(ex => { block += `---\n${ex.trim()}\n`; });
  return block + '---\n';
}

async function callGemini(apiKey, model, parts, { useGrounding = false } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = { contents: [{ parts }] };
  if (useGrounding) body.tools = [{ googleSearch: {} }];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || res.statusText;
    if (res.status === 429) {
      throw new Error('Gemini 무료 플랜 일일 한도 초과 (20회/일).\n설정에서 모델을 gemini-1.5-flash로 변경하거나 내일 다시 시도하세요.');
    }
    throw new Error(`Gemini 오류: ${msg}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

function parseJSON(text) {
  text = text.trim();
  if (text.startsWith('```')) {
    const parts = text.split('```');
    text = parts[1] ?? text;
    if (text.startsWith('json')) text = text.slice(4);
  }
  return JSON.parse(text.trim());
}

export async function generateDraft({ apiKey, model, images, keyword, highlights, examples, useGrounding = false, profile = 'seoldi', missionMode = false, missionGuidelines = '', productInfo = null, placeInfo = null, promptOverrides = {} }) {
  const parts = images.map(img => ({
    inlineData: { mimeType: img.type, data: img.data },
  }));
  const blogStyle = getBlogStyle(profile, promptOverrides);
  const exBlock = buildExBlock(examples);

  const productBlock = productInfo ? `
[상품 정보 — 이 상품에 대한 블로그 글을 작성하세요]
- 상품명: ${productInfo.productName || ''}
- 브랜드: ${productInfo.brand || ''}
- 특징: ${(productInfo.features || []).join(', ')}
- 설명: ${productInfo.description || ''}
` : '';

  const placeBlock = placeInfo ? `
[장소 정보 — 이 장소에 대한 방문 리뷰를 작성하세요]
- 장소명: ${placeInfo.placeName || ''}
- 카테고리: ${placeInfo.category || ''}
- 주소: ${placeInfo.address || ''}
- 운영시간: ${placeInfo.hours || ''}
- 주차: ${placeInfo.parking || ''}
- 메뉴/가격: ${(placeInfo.menu || []).map(m => `${m.name} ${m.price}`).join(' / ')}
- 분위기: ${placeInfo.atmosphere || ''}
${placeInfo.sourceUrl ? `- 네이버 장소 링크: ${placeInfo.sourceUrl}` : ''}

[지역 SEO 지시]
- 주소에서 시·구 지역명을 추출하여 제목 후보 3개 모두에 "지역명+업종" 조합으로 포함 (예: 창원 카페, 창원 브런치카페, 창원 디저트카페)
- 본문 첫 단락과 실용 정보 섹션(주소·운영시간 부분)에 지역명 반드시 포함
${placeInfo.sourceUrl ? `- 실용 정보 섹션 끝에 "📍 네이버 지도 → ${placeInfo.sourceUrl}" 형태로 장소 링크 삽입` : ''}
` : '';

  const missionBlock = (missionMode && missionGuidelines.trim()) ? `
[브랜드 미션 가이드라인 — 아래 조건을 반드시 준수하세요]
${missionGuidelines.trim()}
` : '';

  parts.push({
    text: `
${blogStyle}
${exBlock}
${productBlock}
${placeBlock}
${missionBlock}
[작업 지시]
첨부된 사진들을 순서대로 보고, 아래 조건에 맞는 네이버 블로그 글을 작성하세요.

- 핵심 키워드: ${keyword}
- 강조할 점: ${highlights || '없음'}
- 분량: ${{ income: '공백 포함 1500자 내외', local: '공백 포함 1200자 내외' }[profile] ?? '공백 제외 500자 이내'}
- 핵심 키워드를 본문에 자연스럽게 ${missionMode ? '5회' : '3회'} 이상 포함
- 단락 사이 빈 줄 1개
${profile === 'local' ? `- tags: 반드시 지역명+업종(예: 창원카페), 지역명+맛집(예: 창원맛집) 형태를 앞에 2개 포함. 이후 상호명·동네명·업종 관련 키워드로 채움. 총 7개 이내` : `- tags: 핵심 키워드·관련 주제·서비스명 등 네이버 검색에서 실제로 쓰이는 태그 7개 이내`}

[출력 형식 — JSON만 출력, 다른 텍스트 절대 금지]
- 검색 인용 표시([1] [2] 등) 절대 금지 — JSON 문자열 내에도 포함 금지
- 마크다운 코드블록(\`\`\`) 감싸기 금지
{
  "titles": ["제목 후보 1 (검색 의도 반영, 30자 이내)", "제목 후보 2", "제목 후보 3"],
  "body": "본문 전체 텍스트 (줄바꿈 포함)",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5", "태그6", "태그7"]
}
`,
  });
  const text = await callGemini(apiKey, model, parts, { useGrounding });
  const result = parseJSON(text);
  result.footer = profile === 'seoldi' ? BLOG_FOOTER : '';
  return result;
}

export async function extractPlaceInfo({ apiKey, model, pageText, url }) {
  const isJson = pageText.trim().startsWith('{') || pageText.trim().startsWith('[');
  const prompt = `다음 ${isJson ? 'JSON API 응답' : '웹페이지 텍스트'}에서 장소(카페/음식점/관광지) 정보를 추출하세요.

URL: ${url}

${isJson ? 'JSON 데이터' : '페이지 내용'}:
${pageText}

[출력 형식 — JSON만 출력]
{
  "placeName": "장소명",
  "category": "카테고리 (예: 카페, 한식, 이탈리안)",
  "address": "주소 전체",
  "hours": "운영시간",
  "phone": "전화번호",
  "parking": "주차 정보 (없으면 빈 문자열)",
  "menu": [{"name": "메뉴명", "price": "가격 (예: 5,500원)"}],
  "atmosphere": "분위기 설명 1~2문장",
  "keywords": [
    "지역명+업종 (주소에서 시·구명 추출 — 예: 창원 카페, 창원 브런치카페)",
    "지역명+맛집 (예: 창원맛집, 창원카페추천)",
    "장소명 관련 키워드",
    "업종 특화 키워드 1~2개"
  ]
}

중요: keywords 첫 2개는 반드시 주소의 시·구 지역명을 추출하여 "지역명+업종", "지역명+맛집" 형태로 작성.
추출 불가능한 필드는 빈 문자열 또는 빈 배열로 반환하세요.`;
  const text = await callGemini(apiKey, model, [{ text: prompt }]);
  return parseJSON(text);
}

export async function extractProductInfo({ apiKey, model, pageText, url }) {
  const prompt = `다음 웹페이지 텍스트에서 상품 정보를 추출하세요.

URL: ${url}

페이지 내용:
${pageText}

[출력 형식 — JSON만 출력, 다른 텍스트 없이]
{
  "productName": "상품명",
  "brand": "브랜드명",
  "features": ["핵심 특징 1", "핵심 특징 2", "핵심 특징 3"],
  "keywords": ["SEO 키워드1", "키워드2", "키워드3"],
  "description": "상품 설명 2~3문장"
}

추출 불가능한 필드는 빈 문자열 또는 빈 배열로 반환하세요.`;
  const text = await callGemini(apiKey, model, [{ text: prompt }]);
  return parseJSON(text);
}

export async function analyzeKeyword({ apiKey, model, keyword }) {
  const prompt = `
네이버 블로그 마케터 관점에서 키워드 "${keyword}"를 분석하세요.
설디그래픽스 (경남·창원 B2B 디자인 전문, 10년차 1인 스튜디오) 블로그에 적합한 롱테일 전략을 포함하세요.

[출력 형식 — JSON만 출력]
{
  "competition": "높음|보통|낮음",
  "monthly_search": "예상 월 검색량 설명 (1~2줄)",
  "related": ["연관키워드1", "연관키워드2", "연관키워드3", "연관키워드4", "연관키워드5"],
  "tip": "이 키워드로 상위 노출 노리는 한 줄 전략 (설디 타깃 독자 기준)"
}
`;
  const text = await callGemini(apiKey, model, [{ text: prompt }]);
  return parseJSON(text);
}
