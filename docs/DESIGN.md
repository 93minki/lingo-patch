# lingo-patch 설계 초안 (v0.2)

작성: 2026-10-28 (v0.2: 피드백 반영) · 기획/설계: Opus · 구현: Codex(gpt-6.1-sol, herdr w6:p2), Cursor-Agent(composer-2.5, herdr w6:p3)

---

## 1. 개요

Immersive Translate처럼 AI로 웹 페이지를 이중 언어로 번역하는 브라우저 확장.
**핵심 차별점: 한 번 번역한 내용을 문단 단위로 영구 캐시해, 페이지를 다시 방문하면 API 호출 없이 즉시 복원한다.**

주 사용처는 여러 페이지로 나뉜 프로그래밍 공식 문서(React, MDN, Rust Book 등)를 빠르게 오가며 읽는 상황이다.
예: A 기능 설명을 읽다가 B 기능 페이지로 넘어가 읽고(10초일 수도 30분일 수도 있음) 다시 A로 돌아온다 → A는 다시 번역하지 않는다.

### 목표
- 이미 번역한 문단은 **얼마 뒤에 돌아오든(캐시 TTL 90일 안)** 다시 번역하지 않고 캐시에서 복원. API 호출 0회
  - 탭 이동, 뒤로가기, 새로고침, 브라우저 재시작 뒤에도 동일
  - 복원 속도 목표(부차): 캐시 조회부터 번역문 표시까지 일반 문서 페이지 기준 체감 지연 없음(~300ms)
- 원본 페이지 UI를 망가뜨리지 않음 (원본 텍스트 노드는 건드리지 않고 번역문을 덧붙이기만 함)
- Chrome / Brave / Whale / Edge / Firefox / Safari 지원

### 비목표 (MVP 제외)
- 자체 백엔드 서버, 계정, 기기 간 자동 동기화
- PDF, 동영상 자막, 이미지 OCR 번역
- 스토어 공개 배포 (개인 사용 우선. 구조는 나중에 배포할 수 있게 유지)
- **기계번역 엔진** (브라우저 내장 번역 API, 구글 번역 웹 엔드포인트 등). 이 확장은 AI 번역만 한다
- 무료 번역을 위한 자체 프록시 서버. 무료로 쓰려는 사용자에게는 무료 등급 키(Gemini, Groq, OpenRouter)를 안내한다 (§8.5)

---

## 2. 확정된 결정

| 항목 | 결정 |
|---|---|
| 번역 엔진 | BYOK. OpenAI, Anthropic, Gemini, OpenAI 호환(OpenRouter, Ollama 등) |
| 무료 이용 | 서버 없음. 첫 실행 시 무료 등급 키(Gemini 기본, Groq·OpenRouter 대안) 발급을 안내. 더 좋은 품질은 유료 키 |
| 제공자 프리셋 | OpenAI 호환 방식의 DeepSeek, Groq, OpenRouter는 주소·모델을 미리 채운 프리셋으로 제공 (§7.6) |
| 모델 선택 | 키를 넣은 제공자의 현행 상위 모델 3개 중에서 사용자가 고름 (§7.5). 최상위 고가 모델(예: Astra)은 목록에서 제외 |
| 번역 문체 | 존댓말 평서문(~합니다/~하세요) 고정. 요약·생략·의역 축약 금지 |
| 캐시 | IndexedDB 로컬 영구 저장. 문단 단위, 마지막 접근 기준 TTL 90일 + 용량 상한 20MB LRU |
| 배포 | 개인 사용. 각 브라우저에 개발자 모드로 설치, Safari는 Xcode로 로컬 빌드 |
| 표시 방식 | 원문 아래에 번역문을 붙이는 이중 언어가 기본. 단축키로 번역문만/원문만 보기 전환 |
| 번역 시점 | 사이트별 '항상 번역' + 캐시 자동 복원. 화면에 보이는 문단부터 번역. 도메인을 등록해도 **사용자가 실제로 연 페이지만** 번역 (사이트 전체를 미리 번역하지 않음) |
| 언어 | 원문 언어 자동 감지 → 한국어가 기본. 목표 언어는 설정에서 변경 가능 |
| 기본 포함 | 코드 블록 제외, 스크롤로 나타나는 내용 번역, SPA 라우팅 대응 |
| 추가 기능 | 용어집, 선택/호버 번역, 캐시 내보내기/가져오기 |

---

## 3. 기술 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 확장 프레임워크 | **WXT** + TypeScript | 브라우저별 MV3 차이(Firefox event page, Safari 변환)를 한 코드베이스에서 처리 |
| 팝업/옵션 UI | Preact + CSS Modules | 가볍고 번들이 작음 |
| 페이지에 띄우는 UI | Shadow DOM 안의 vanilla TS | 페이지 CSS와 서로 간섭하지 않음 |
| 저장소 | IndexedDB (`idb` 라이브러리) + `browser.storage.local`(설정) | 대용량 캐시는 IDB, 작은 설정은 storage |
| 해시 | `crypto.subtle` SHA-256 (앞 16바이트를 hex로) | 모든 브라우저 지원, 충돌 걱정 없음 |
| 테스트 | Vitest + happy-dom (단위), Playwright + Chromium (E2E) | |
| 린트/포맷 | ESLint + Prettier, `tsc --noEmit` | |
| 패키지 매니저 | npm (Node 24 기본 포함) | 전역 설치 없이 바로 사용 |

---

## 4. 아키텍처

```
┌─────────────── Content Script (페이지마다) ───────────────┐
│ Segmenter → Restorer → Scheduler → Renderer               │
│     ↑ MutationObserver / SPA 라우팅 감지 / IntersectionObserver │
│ Overlay(Shadow DOM): 선택/호버 번역, 진행 표시             │
└───────────────┬───────────────────────────────────────────┘
                │ 타입이 지정된 메시지 (runtime.sendMessage / Port)
┌───────────────▼──────── Background (SW / event page) ─────┐
│ CacheService (IDB) ── TranslateQueue ── ProviderRegistry   │
│                         │ 배치·동시성·재시도               │
│                         └→ OpenAI / Anthropic / Gemini / Compat │
│ SettingsService · GlossaryService · Eviction(alarms)      │
└───────────────────────────────────────────────────────────┘
Popup: 사이트 자동 번역 토글, 지금 번역, 표시 모드, 통계
Options: 제공자/키/모델, 목표 언어, 용어집, 캐시 관리(삭제/내보내기/가져오기), 단축키
```

API 키와 IndexedDB는 **background에만** 둔다. content script는 페이지 컨텍스트와 가까워서 키를 두지 않는다.

### 4.1 처리 흐름 (페이지 로드)
1. `document_idle`에 content script 실행. 사이트 설정 확인 (자동 번역 대상이 아니면 대기)
2. **Segmenter**: 번역할 블록을 찾아 세그먼트 목록 생성 (§5)
3. **Restorer**: 모든 세그먼트 키를 한 번에 `cache.getMany(keys)`로 조회. 캐시에 있는 것은 바로 렌더링
4. 캐시에 없는 세그먼트만 **Scheduler**에 넣음. 화면에 보이는 것(앞뒤 1화면 여유) 먼저 처리
5. background의 **TranslateQueue**가 배치로 묶어 제공자 호출 → 결과를 캐시에 저장 → content로 반환 → 렌더링
6. MutationObserver가 새 노드나 React 재렌더로 사라진 번역문을 감지하면 2~5단계를 다시 실행 (번역문 재삽입은 캐시에서 하므로 비용 없음)

### 4.2 SPA 라우팅
- Chrome 계열: `navigation` API의 `navigatesuccess` 이벤트를 받음
- Firefox/Safari 대체 방법: `popstate` + `location.href` 변경 감시 + 큰 DOM 변경 감지(디바운스 300ms)
- URL이 바뀌면 진행 중인 요청을 취소(AbortController)하고 1단계부터 다시 실행

---

## 5. 세그먼트 분리와 렌더링 (UI를 망가뜨리지 않기)

### 5.1 대상 블록
- 포함: `p, li, h1–h6, td, th, dt, dd, blockquote, figcaption, summary, caption, label`, 그리고 텍스트만 직접 담은 `div`/`span` 말단 블록
- 제외: `pre, code(블록), kbd, samp, script, style, noscript, textarea, input, select, svg, math, [contenteditable], [translate="no"], .notranslate, [aria-hidden="true"]`, 이 확장이 삽입한 요소
- 건너뜀: 이미 목표 언어인 텍스트, 숫자·기호만 있는 텍스트, 공백 제거 후 2글자 미만
- 사이트별 CSS 선택자로 포함/제외 규칙 추가 가능 (주요 문서 사이트용 기본 규칙 제공: Docusaurus, VitePress, MDN, Nextra, mdBook, Sphinx)

### 5.2 인라인 요소 보존
블록 안의 인라인 요소는 자리표시 태그로 바꿔 보낸다. 번호 N은 세그먼트 안에서 등장 순서대로 0부터 매긴다.
```
원문 DOM:   Call <code>useState</code> at the <a href="#top">top level</a>.
전송 텍스트: Call <x0/> at the <g1>top level</g1>.
응답:       <g1>최상위</g1>에서 <x0/>을 호출하세요.
```
- **원자 요소** `<xN/>`: `code, kbd, samp, var, img, br, svg, math, input`, 알 수 없는 요소(커스텀 엘리먼트, button 등). 원본 노드를 깊은 복제해 그대로 다시 넣는다 (번역하지 않음)
- **쌍 요소** `<gN>…</gN>`: `a, em, strong, b, i, u, s, mark, span, abbr, small, sub, sup, q, cite, del, ins, time`. 원본 요소의 얕은 복제(`cloneNode(false)`)에 번역된 자식을 넣는다
- 텍스트 안의 `< > &`는 `&lt; &gt; &amp;`로 이스케이프한다
- 검증: 응답의 자리표시 집합이나 중첩 구조가 원문과 다르면 태그를 모두 빼고 텍스트만 렌더링한다 (실패로 처리하지 않음)

### 5.3 삽입 방식
- 원본 텍스트 노드는 **절대 수정하지 않는다.** 블록 요소의 마지막 자식으로 `<lp-t>` 커스텀 요소를 붙인다
- 블록 부모 → `display:block; margin-top:.25em`. 인라인 성격 부모(버튼, 메뉴 링크, 짧은 표 셀) → 앞에 공백을 두고 inline으로 붙임
- 글꼴, 색, 크기는 부모에서 상속. 따로 지정하는 것은 투명도/점선 같은 최소 스타일만 (사용자 테마 3종: 기본·흐리게·밑줄)
- 표시 모드는 `<html data-lp-mode="bilingual|translation|original">` 속성과 CSS만으로 전환. 이때 DOM은 다시 그리지 않음
  - `translation` 모드: 원문 텍스트 노드를 감싸지 않고, 블록에 `data-lp-hide-src`를 붙이고 `font-size:0`과 `<lp-t>`의 글자 크기 복원으로 숨김 (레이아웃 영향 최소화. 사이트마다 검증 필요한 위험 항목)
- 각 블록에 `data-lp-key`를 붙여 중복 삽입 방지

---

## 6. 캐시 설계 (핵심)

### 6.1 키
```
key = sha256(
  normalize(sourceMarkup)   // 공백 정리, 자리표시 태그로 바꾼 텍스트
  + "|" + targetLang
  + "|" + promptVersion     // 프롬프트를 바꾸면 이전 캐시 무효화
  + "|" + glossaryFingerprint(segment)  // 이 세그먼트에 등장하는 용어집 항목만으로 만든 해시
)
```
- **URL을 키에 넣지 않는다.** 사이드바, 헤더, 반복되는 안내 문구처럼 같은 문단이 여러 페이지에 나오면 한 번만 번역한다
- 모델/제공자는 키에서 제외하고 값에 기록한다. 모델을 바꿔도 기존 캐시를 재사용 (옵션: "모델이 다르면 다시 번역")
- 용어집 지문은 세그먼트에 실제로 등장하는 용어만 반영한다. 용어 하나를 바꾸면 그 용어가 들어간 문단만 다시 번역

### 6.2 IndexedDB 스키마 (`lingo-patch`, v1)
| store | key | 값 | 인덱스 |
|---|---|---|---|
| `segments` | key | `{ translated, srcLang, model, provider, createdAt, lastAccess, bytes }` | `lastAccess` |
| `pages` | `origin+pathname` | `{ keys: string[], updatedAt }` | `updatedAt` |
| `meta` | name | 총 용량, 통계(캐시 적중 수, 절약 토큰 추정) | |

- `pages`는 선택적 가속용 저장소다. 다시 방문하면 DOM 분리가 끝나기 전에 미리 가져와(prefetch) 메모리 Map에 올려둔다
- `lastAccess` 갱신은 쓰기 비용을 줄이려고 하루 1회까지만 한다

### 6.3 정리
- 기본값: 마지막 접근 후 90일 TTL, 총 20MB 상한 (설정에서 변경)
  - 추정: 원문은 저장하지 않고 번역문 + 키만 저장. 문서 한 페이지 ≈ 20~40KB → 20MB ≈ 500~1,000페이지
  - React 문서 전체가 약 200페이지 규모이므로 여러 문서 사이트를 함께 써도 충분. 실제 사용량은 옵션 화면 통계로 확인 후 조정
- `alarms`로 하루 1회 정리: TTL이 지난 항목 삭제 → 상한 초과 시 `lastAccess` 오래된 순으로 삭제
- 옵션 화면: 전체 삭제, 사이트별 삭제, 사용량 표시

### 6.4 내보내기/가져오기
- 형식: `lingo-patch-cache-YYYYMMDD.jsonl.gz` (`CompressionStream` 사용, 미지원 시 압축하지 않은 jsonl)
- 첫 줄은 헤더 `{ format:1, promptVersion, exportedAt }`, 이후 한 줄에 세그먼트 하나
- 가져올 때 같은 키가 있으면 `createdAt`이 최신인 쪽을 유지. `promptVersion`이 다르면 경고만 표시하고 그대로 가져옴

---

## 7. 번역 요청

### 7.1 Provider 인터페이스
```ts
interface TranslationProvider {
  id: 'openai' | 'anthropic' | 'gemini' | 'openai-compatible';
  translateBatch(req: {
    items: { id: string; text: string }[];
    sourceLang?: string; targetLang: string;
    glossary: GlossaryEntry[]; signal: AbortSignal;
  }): Promise<{ id: string; text: string }[]>;
  estimateTokens(text: string): number;
}
```
- 요청과 응답은 JSON 배열(`[{id, text}]`)로 주고받는다. 구조화 출력(JSON mode / response schema)을 지원하는 제공자는 그 기능을 사용
- 응답에서 빠진 id는 다시 큐에 넣는다 (최대 2회)

### 7.2 큐
- 배치: 최대 약 2,500 토큰 또는 40개 세그먼트, 50ms 디바운스로 모아서 전송
- 동시성: 제공자별 기본 3개 (설정 가능)
- 429/5xx 응답: 지수 백오프(1s, 2s, 4s + 지터), `retry-after` 헤더 우선
- 화면에 보이는 세그먼트가 우선순위 높음. 탭이 닫히거나 URL이 바뀌면 그 탭의 대기 요청 취소
- 같은 키를 동시에 요청하면 한 번만 보냄 (in-flight dedupe)
- MV3 service worker가 30초 넘게 쉬면 종료될 수 있음 → 요청 중에는 content와 맺은 Port 연결로 살려두고, 큐 상태는 메모리에만 둠 (SW가 죽으면 content가 다시 요청)

### 7.3 프롬프트 (요지)
- 역할: 기술 문서 번역가. 문체는 존댓말 평서문(~합니다/~하세요) 고정
- 규칙: 원문의 모든 문장과 정보를 빠짐없이 옮김(요약·생략·축약 금지), 자리표시 태그 보존, 코드 식별자·API 이름·CLI 플래그 번역 금지, 용어집 준수, 설명 없이 JSON만 출력
- 문맥: 페이지 제목과 현재 섹션 제목(h1/h2)을 함께 보냄 (짧게)
- 프롬프트를 바꾸면 `promptVersion`을 올림

### 7.4 키 보관
- `browser.storage.local`에 평문으로 저장 (개인 사용 전제). 옵션 화면에 이 사실을 명시
- 요청 권한: 기본 제공자 도메인은 `host_permissions`에 넣고, 사용자 지정 base URL은 `optional_host_permissions`로 그때그때 요청

### 7.5 모델 목록
- 제공자별로 현행 상위 모델 3개를 `src/providers/models.ts`에 고정 목록으로 둔다. 최상위 고가 모델은 넣지 않는다
- 키를 넣으면 그 제공자의 3개 모델이 선택지로 뜨고, 사용자가 하나를 고른다. 키를 넣을 때 가벼운 확인 요청을 보내 키가 유효한지 검사
- 목록은 모델 세대가 바뀔 때 코드에서 갱신한다 (제공자의 `/models` API로 실제 사용 가능 여부만 확인)

| 제공자 | 선택지 | 비고 |
|---|---|---|
| OpenAI | GPT-6.1-Sol, GPT-6.1-Terra, GPT-6-Luna | GPT-6-Astra 제외. 정확한 API 모델 ID는 P3에서 확인 |
| Anthropic | Claude Opus 5.5, Sonnet 5.5, Haiku 5.5 | `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` |
| Gemini | 현행 상위 3종 | P3에서 확인해 확정 |
| OpenAI 호환 | 모델 ID 직접 입력 | Ollama, OpenRouter 등 |

### 7.6 제공자 프리셋과 요청 속도 제한
- 프리셋은 `openai-compatible` 제공자에 주소·모델 후보·분당 요청 한도(RPM)를 미리 채운 것이다. 사용자는 키만 넣는다
  | 프리셋 | base URL | 무료 | 비고 |
  |---|---|---|---|
  | DeepSeek | `https://api.deepseek.com` | 아니오 (매우 저렴) | |
  | Groq | `https://api.groq.com/openai/v1` | 예 (모델별 분당·일일 한도) | |
  | OpenRouter | `https://openrouter.ai/api/v1` | `:free` 모델만 (분당 20, 일 50회) | 모델 목록에서 `:free`로 끝나는 것만 무료 표시 |
- 큐는 제공자(프리셋)별 **분당 요청 수 상한**을 지킨다. 무료 등급은 한도가 낮아 동시 요청만으로는 429가 잦다
- 정확한 base URL·모델 ID·한도는 구현 시 공식 문서로 확인한다

---

## 8. 부가 기능

### 8.1 용어집
- 전역 용어집 + 사이트별 용어집 (사이트별이 우선)
- 항목: `{ term, mode: 'keep' | 'map', target?, caseSensitive }`
- 기본 제공: React/JS/TS 공통 용어 keep 목록 (props, state, hook, callback, middleware 등)
- 세그먼트에 등장하는 항목만 프롬프트에 넣어 토큰 절약

### 8.2 선택/호버 번역
- 호버: 수정키(기본 Alt/Option)를 누른 채 문단에 마우스를 올리면 그 블록만 번역 (자동 번역이 꺼진 사이트에서도 동작)
- 선택: 텍스트를 드래그하면 작은 버튼이 뜨고, 누르면 Shadow DOM 팝오버에 번역 표시
- 둘 다 같은 캐시와 큐를 사용

### 8.3 단축키 (`commands`)
- `Alt+A`: 이 페이지 번역 켜기/끄기
- `Alt+S`: 표시 모드 전환 (이중 언어 → 번역문만 → 원문만)
- 사용자가 브라우저 단축키 설정에서 변경 가능

### 8.5 첫 실행 안내 (무료로 시작하기)
- 키가 없으면 옵션 화면이 열리고 두 갈래를 보여준다
  - **무료로 시작**: Gemini 무료 키 발급 단계별 안내(기본 추천), 대안으로 Groq·OpenRouter 무료
  - **더 좋은 품질**: OpenAI, Anthropic, DeepSeek 유료 키
- 무료 등급은 입력이 제공자의 서비스 개선에 쓰일 수 있다는 점을 한 줄로 알린다

### 8.4 팝업
- 이 사이트 항상 번역 토글, 지금 번역, 표시 모드
- 현재 페이지 통계: 세그먼트 수 / 캐시 적중 / 새로 번역 / 추정 사용 토큰

---

## 9. 브라우저 호환

| 브라우저 | 빌드 | 설치 | 주의 |
|---|---|---|---|
| Chrome / Brave / Edge / Whale | `wxt build -b chrome` | 확장 관리 → 개발자 모드 → 압축해제된 확장 로드 | Whale은 Chromium 기반이라 같은 빌드 사용. Brave Shields가 API 요청을 막지 않는지 확인 |
| Firefox | `wxt build -b firefox --mv3` | `about:debugging` 임시 로드, 또는 web-ext로 자체 서명 | background가 event page로 동작. `browser_specific_settings.gecko.id` 필요 |
| Safari (macOS) | `wxt build -b safari` → `xcrun safari-web-extension-converter` | Xcode 빌드 → Safari 개발자 메뉴 → '서명되지 않은 확장 허용' | 이 설정은 Safari를 재시작하면 꺼짐. `navigation` API 없음(대체 경로 사용). IDB 용량 정책이 더 엄격하므로 실제 기기에서 확인 필요 |

브라우저 차이는 `src/platform/`에 모으고, 나머지 코드는 WXT의 `browser` 객체만 사용한다.

---

## 10. 디렉터리 구조

```
lingo-patch/
├─ AGENTS.md                # 구현자(Codex/Cursor)용 규칙
├─ docs/DESIGN.md
├─ wxt.config.ts
├─ src/
│  ├─ entrypoints/
│  │  ├─ background.ts
│  │  ├─ content/index.ts
│  │  ├─ popup/
│  │  └─ options/
│  ├─ core/                 # 순수 로직. 전역 객체 금지, 인자로 받은 DOM 노드만 다룸 → 단위 테스트 대상
│  │  ├─ segment/           # 세그먼트 분리, 자리표시 직렬화/역직렬화
│  │  ├─ cache/             # 키 생성, 정리 정책
│  │  ├─ queue/             # 배치·우선순위·dedupe
│  │  ├─ glossary/
│  │  └─ prompt/
│  ├─ providers/            # openai, anthropic, gemini, compat
│  ├─ storage/              # idb 래퍼, settings
│  ├─ content/              # renderer, observers, spa, overlay
│  ├─ messaging/            # 메시지 타입 정의 + 헬퍼
│  ├─ platform/             # 브라우저 차이 흡수
│  └─ ui/                   # 팝업/옵션 공용 컴포넌트
├─ site-rules/              # 문서 사이트별 기본 선택자 규칙(JSON)
└─ tests/
   ├─ unit/
   ├─ fixtures/             # 실제 문서 사이트 HTML 스냅샷
   └─ e2e/
```

---

## 11. 단계별 계획과 담당

담당 기준: 난이도 3 = Opus(설계·검수), 2 = Codex(여러 파일 구현, Cursor 작업 검토), 1 = Cursor(1~2파일 단위 작업, 반복적인 구현, 테스트 fixture)
분배 원칙: 나눌 수 있으면 나누고, 억지로 쪼개지 않는다. 서로 얽힌 작업은 한 쪽에 몰아준다.

| 단계 | 내용 | Codex | Cursor | 완료 조건 |
|---|---|---|---|---|
| P0 | 프로젝트 골격 | lint/test/tsconfig 설정 검토 | WXT 프로젝트 생성, AGENTS.md 초안 | `npm run typecheck && npm run lint && npm test` 통과, 크롬에서 빈 확장 로드 |
| P1 | 세그먼트 분리 + 자리표시 직렬화 | `core/segment` 로직 | 문서 사이트 HTML fixture 5종 수집·정리 | fixture 단위 테스트 통과 |
| P2 | 캐시 | IDB 래퍼, 정리 정책 | 키 생성(정규화+해시) 함수와 단위 테스트 | 단위 테스트(fake-indexeddb) 통과 |
| P3 | 번역 요청 | queue, OpenAI adapter, 공통 인터페이스 | Anthropic/Gemini/호환 adapter(OpenAI 구현을 본떠), `models.ts` | 모의 fetch 테스트 통과 |
| P4 | 페이지 렌더링 | renderer, observers, SPA 감지 (서로 얽혀 있어 한 쪽 담당) | — | E2E: A 번역 → B 이동 → A 복귀 시 **API 호출 0회** |
| P5 | 팝업/옵션 UI | 메시징·상태 연결 | 화면 컴포넌트, 스타일 | 수동 확인 체크리스트 |
| P6 | 부가 기능 | 선택/호버 번역 | 용어집 CRUD, 캐시 내보내기/가져오기 | 단위 + E2E |
| P7 | 브라우저별 빌드 | 플랫폼 차이 수정 | 빌드 스크립트, 설치 가이드 문서 | 4개 브라우저에서 수동 시나리오 통과 |
| 단계마다 | diff 검토, 테스트 실행, 설계 수정 | Opus | | |

---

## 12. 작업 프로세스

- 방식: **herdr pane 기반 3단 구조** (2026-10-28 연결 테스트 통과)
  ```
  Opus (w6:p1) ──herdr agent prompt──▶ Codex (w6:p2) ──herdr agent prompt──▶ Cursor (w6:p3)
       ◀──── 단계 보고 ────────────────        ◀──── 작업 보고 (agent read) ─────
  ```
  - Opus: 단계별 지시서(목표, 범위, Codex/Cursor 분배안, 완료 조건) 전달 → Codex 보고를 받으면 diff·테스트로 검수
  - Codex: 자기 몫을 구현하고, Cursor 몫은 지시서를 써서 Cursor pane에 맡긴 뒤 결과를 검토해 함께 보고
  - Cursor: 맡은 작업만 하고 결과를 Codex에 보고
- 대체 방식: herdr 경로가 실패하면 Opus가 Codex와 Cursor에 각각 직접 분배 (§11 분배 원칙 동일)
- 참고: `codex exec -s workspace-write`에서 cursor-agent CLI를 직접 실행하면 인증 오류가 남. 그래서 이미 로그인된 pane을 통해 맡긴다
- 지시서 공통 항목: 목표, 대상 파일, AGENTS.md 준수, 완료 조건(실행할 명령), "커밋하지 말 것"
- git: P0에서 `git init`. 단계마다 Opus 검수가 끝난 뒤 사용자 승인을 받고 커밋

---

## 13. 위험과 미결 사항

| 위험 | 대응 |
|---|---|
| React/Vue 재렌더가 삽입한 `<lp-t>`를 지움 | MutationObserver로 감지해 캐시에서 다시 삽입. 같은 노드가 반복해서 지워지면 그 블록은 바깥 오버레이 방식으로 전환 (P4에서 검증) |
| `translation` 모드에서 원문을 숨기는 방식이 레이아웃을 깨뜨림 | 일단 구현해서 실제 문서 사이트에서 써보고 판단. 깨지는 사이트는 사이트 규칙으로 제외 |
| 동적 문서(버전 배지, 타임스탬프)가 있으면 캐시 키가 매번 달라짐 | 숫자/날짜만 다른 경우를 위한 정규화 규칙은 P2 이후 판단 |
| LLM이 자리표시 태그를 깨뜨림 | §5.2의 텍스트만 렌더링하는 대체 경로 + 실패율 통계 |
| Safari 캐시 용량 제한, 장기 미사용 시 저장소 삭제 | 실제 기기에서 측정. 필요하면 Safari 기본 상한을 낮춤 |
| BYOK 키를 평문 저장 | 개인 사용 전제로 수용. 스토어 배포 시 다시 검토 |

미결 (구현 중에 결정):
- OpenAI·Gemini 모델의 정확한 API ID (P3)
- 단축키(`Alt+A`, `Alt+S`, 호버 Alt)는 실제로 써보며 조정
