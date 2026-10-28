# P6 수정 — 호버 번역 미동작, 옵션 화면을 새 탭으로

발신: Opus (w6:p1) → 수신: Codex (w6:p2)

## 절대 규칙
lingo-patch 폴더 안만 수정(`/tmp` 포함 폴더 밖 파일 생성 금지), 전역 설치 금지, git 쓰기 금지, `docs/` 수정 금지, 실제 AI API 호출 금지, `ps`·환경 변수 출력 금지.

## 1. Option(Alt) + 호버 번역이 실제로 동작하지 않음 (Mac Brave 실사용)
원인 (Opus 분석, `src/content/pipeline.ts`의 `onHover`):
- `mouseover`에서만, 그것도 `relatedTarget`이 블록 바깥일 때(블록에 "들어오는 순간")만 수정키를 검사한다
- 실제 사용: 문단 위에 마우스를 둔 채 Option을 누르거나, 누른 채 문단 안에서 움직인다 → 반응 없음
- 기존 테스트는 `altKey: true`인 `mouseover`를 합성해서 통과 (실사용 순서를 재현하지 않음)
수정:
- `mousemove`(rAF 등으로 스로틀)로 마지막 포인터 위치의 요소를 추적하고, **수정키 `keydown`** 시점에 그 요소의 블록을 번역 토글. 수정키를 누른 채 다른 블록으로 이동하면 그 블록도 번역 (같은 블록 반복 토글 방지: 키를 누르고 있는 동안 블록당 1회)
- 블록 판정은 `findSegments`의 블록 규칙과 일치시킨다 (지금은 `p,li,h1..h6,td,th,blockquote,dt,dd`로 하드코딩 — 사이드바 `div` 블록 등 누락). 포인터 아래 요소에서 가장 가까운 세그먼트 블록을 찾는 헬퍼를 `src/content/`에 둔다
- 페이지 번역이 꺼진 탭에서도 background가 이 수동 요청을 처리하는지 확인하고, 막혀 있으면 허용 (번역 설정이 없으면 진행 표시의 "설정 필요" 흐름)
- Mac에서 Option 키 `keydown`은 `event.key === 'Alt'`, `altKey`로 들어온다. 입력칸 포커스 중이면 무시
- 테스트: 단위 — (a) 블록 위에 포인터가 있는 상태에서 Alt keydown → 요청 (b) Alt 누른 채 블록 안에서 이동 → 1회만 (c) 다른 블록으로 이동 → 그 블록 요청 (d) 수정키 없이 이동 → 없음 (e) 입력칸 포커스 중 → 없음
- E2E: Playwright 실제 입력으로 `page.mouse.move` → `page.keyboard.down('Alt')` 순서와 `keyboard.down` → `mouse.move` 순서 둘 다 검증 (합성 이벤트 dispatch 금지)

## 2. 옵션 화면을 새 탭의 독립 페이지로
- 매니페스트 `options_ui.open_in_tab: true` (Firefox `options_ui`도 동일하게)
- 팝업의 "고급 설정"·"용어집 관리" 등은 `browser.tabs.create({ url: runtime.getURL('options.html#<section>') })` 또는 `openOptionsPage` 후 해시로 해당 섹션(`#engine`, `#glossary`, `#sites`, `#cache`, `#shortcuts`)으로 스크롤. 이미 열린 옵션 탭이 있으면 그 탭을 활성화하고 해시만 바꿈
- 옵션 페이지가 넓은 화면에서 보기 좋게: 최대 폭 760px 가운데 정렬, 상단에 섹션 목차(앵커 링크) — 라이트·다크 대응 유지
- 테스트: 해시 섹션 스크롤, 기존 옵션 테스트 유지. 캡처 `.output/p6-options-tab-{light,dark}.png`

## 완료 조건
```
npm run typecheck && npm run lint && npm test && npm run build && npm run build:firefox && npm run test:e2e
```
검사가 하나라도 실패하면 완료로 보고하지 않는다.

## 보고
결과, 바꾼 파일, 호버 동작 방식 요약, 남은 문제
