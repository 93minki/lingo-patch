# P5 수정 지시서 — 실사용 피드백 반영

발신: Opus (w6:p1) → 수신: Cursor (w6:p3). Codex 한도 소진으로 Opus가 직접 지시.

## 먼저 읽을 것
`AGENTS.md`, `src/content/renderer.ts`, `src/content/style.ts`, `src/content/pipeline.ts`, `src/entrypoints/popup/main.tsx`

## 절대 규칙
1. lingo-patch 폴더 안의 파일만 수정. 전역 설치 금지. git 쓰기 금지. `docs/` 수정 금지.
2. 원본 페이지의 텍스트 노드는 수정하지 않는다. 원본 요소에는 `data-lp-*` 속성 추가만 허용.
3. 실제 AI API 호출 금지.

## 수정 1 — "번역문만" 모드에서 원문이 남기는 빈 공간·흔적 제거
현상: `html[data-lp-mode="translation"]`에서 원문을 `font-size:0`으로만 숨겨서 (a) 원문 줄 높이와 `lp-t`의 위 여백 때문에 번역문 위에 빈 줄이 생기고 (b) `px`로 글자 크기를 직접 지정한 인라인 요소(코드 등)가 작은 흔적으로 남고 (c) `li`의 글머리 기호가 사라진다.
방법:
- 렌더러가 세그먼트에 속한 **인라인 요소 자식**(세그먼트 직렬화에 쓰인 최상위 요소 노드)에 `data-lp-src` 속성을 붙인다. 블록 자식(anchor 이후의 하위 목록 등)에는 붙이지 않는다. 번역을 지우거나 끌 때 이 속성도 제거한다
- 렌더러는 블록의 원래 `line-height`도 `lp-t`에 `--lp-lh`로 넘긴다 (`--lp-fs`와 같은 방식)
- 번역문만 모드 CSS:
  - `[data-lp-src-hidden]`: `font-size:0 !important; line-height:0 !important`
  - `[data-lp-src-hidden] [data-lp-src]`: `display:none !important`
  - `[data-lp-src-hidden] > lp-t`: `font-size: var(--lp-fs) !important; line-height: var(--lp-lh) !important; margin-top: 0 !important`
  - `li[data-lp-src-hidden]::marker`: `font-size: var(--lp-fs)` (블록에도 `--lp-fs`를 CSS 변수로 지정할 수 없으므로, 렌더러가 블록에 `data-lp-fs` 대신 `style` 변경을 하지 않도록 주의 — 방법이 없으면 marker는 보고서에 "미해결"로 적는다)
- 이중 언어·원문만 모드에서는 `data-lp-src`가 아무 영향도 주지 않아야 한다

## 수정 2 — 번역 결과가 원문과 같으면 표시하지 않기
- 번역문과 원문을 비교해서 같으면 `lp-t`를 넣지 않는다 (예: "Props" → "Props", "React" → "React", "react-dom@19.3").
- 비교 기준: 자리표시 태그를 지우고, 공백을 정리하고, 대소문자를 무시했을 때 같으면 "같음"으로 본다
- 캐시는 그대로 저장한다 (다음 방문 때 다시 요청하지 않도록). 렌더링만 생략한다
- 팝업 통계에는 영향이 없어야 한다

## 수정 3 — 팝업에 설정 링크
- 팝업 아래쪽에 "설정" 텍스트 버튼 → `runtime.openOptionsPage()` (번역 설정이 있든 없든 항상 표시)

## 테스트
- 단위: 번역문만 모드에서 `data-lp-src` 부여·해제, `--lp-lh` 전달, 같은 번역 생략(대소문자·공백·자리표시 차이 포함), 팝업 설정 버튼
- 기존 테스트 모두 유지

## 완료 조건
```
npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e
```

## 보고 (마지막 응답)
1. 결과와 명령 출력 요약
2. 바꾼 파일 목록
3. `::marker` 처리 결과, 남은 문제
