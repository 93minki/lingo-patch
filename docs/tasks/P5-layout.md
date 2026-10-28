# P5 레이아웃 — 메뉴·버튼·고정 바에서 번역문이 레이아웃을 깨뜨리는 문제

발신: Opus (w6:p1) → 수신: Codex (w6:p2, GPT-6.1 Terra high), 일부 Cursor (w6:p3)

## 현상 (nextjs.org/docs, 사용자 스크린샷)
- 상단 고정 헤더의 "Docs / Learn / Showcase / Blog / Templates / Deploy" 각 항목 옆에 번역문이 **한 글자씩 세로로** 쌓이고 헤더 높이가 늘어난다
  - 원인: 항목(`a` 등)이 가로 flex 컨테이너라 `lp-t`가 별도 flex 항목이 되어 폭이 거의 0으로 줄어든다
- 짧은 제목·버튼("Copy page", "Next.js Docs")도 줄바꿈되어 버튼 높이가 늘어난다
- 비교: Immersive Translate는 (1) 상단 고정 헤더를 번역하지 않고 (2) 짧은 텍스트("Installation 설치", "Copy page 페이지 복사")는 같은 줄 옆에 붙이고 (3) 긴 문단만 아래 줄에 둔다

## 절대 규칙
lingo-patch 폴더 안만 수정, 전역 설치 금지, git 쓰기 금지, `docs/` 수정 금지(BACKLOG 추가 허용), 실제 AI API 호출 금지, 원본 텍스트 노드·기존 요소 스타일 수정 금지(`data-lp-*` 속성만 허용).

## 요구사항
1. **상단 고정 바 건너뛰기** (설정 `skipFixedBars`, 기본 켜짐 — 옵션 고급 설정에 토글)
   - 세그먼트 블록의 조상 중 `position: fixed` 또는 `sticky`이고 높이가 120px 이하인 요소가 있으면 번역하지 않는다 (키가 큰 고정 사이드바는 번역)
   - `getComputedStyle` 호출은 요소별로 캐시(WeakMap)해 스캔 비용을 늘리지 않는다
   - 판정은 content 쪽(`src/content/`)에서 하고, `src/core/segment`는 순수하게 유지 (필요하면 `findSegments`에 `exclude` 콜백 옵션 추가)
2. **표시 방식 3단계** (렌더러)
   - `compact`: 원문 텍스트(공백 정리) 40자 이하이고 블록이 한 줄(높이 ≤ 줄 높이의 1.6배)이면 같은 줄에 `margin-left: .5em`으로 붙인다. `white-space: nowrap`, 부모가 flex/grid면 `flex: none`
   - `inline`: 지금의 inline (그 외 인라인 성격 부모). 부모가 가로 flex/grid면 `flex: 1 1 auto; min-width: 0`
   - `block`: 긴 문단, 지금과 같음
   - `data-lp-display`에 `compact | inline | block` 기록. "번역문만" 모드 규칙은 세 경우 모두에서 동작
3. **회귀 방지 검증**
   - Cursor: `tests/fixtures/nextjs-docs.html` 추가 (https://nextjs.org/docs, P1 fixture와 같은 가공 방식, README 갱신)
   - E2E에 Next.js fixture 시나리오 추가:
     - 번역 전후 `header`(또는 최상단 fixed/sticky 바)의 높이가 같다
     - 상단 바 안에 `lp-t`가 없다
     - 모든 `lp-t` 중 텍스트 2자 이상인데 폭이 `2em` 미만인 것이 없다 (세로 쌓임 감지)
     - 사이드바 항목(짧은 텍스트)은 `compact`로 렌더된다
   - 기존 react fixture 시나리오 유지

## 분배
- Cursor: Next.js fixture, compact/inline 스타일(`style.ts`), 옵션 토글 UI·문구
- Codex: 고정 바 판정, 렌더러 표시 방식 판정, 설정 연결, E2E

## 완료 조건
```
npm run typecheck && npm run lint && npm test && npm run build && npm run build:firefox && npm run test:e2e
```

## 보고
결과 요약, Cursor에 맡긴 일과 검토 내용, 바꾼 파일, 판정 기준(숫자) 근거, Next.js·react 화면 캡처 경로(`.output/layout-*.png`), 남은 문제
