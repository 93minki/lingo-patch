# P5 수정 — 사이드바 미번역, 팝업 체크박스 배치

발신: Opus (w6:p1) → 수신: Codex (w6:p2, GPT-6.1 Terra high)

## 절대 규칙
lingo-patch 폴더 안만 수정 (`/tmp` 포함 폴더 밖에 파일을 만들지 않는다 — 지난 작업에서 Cursor가 `/tmp`에 파일을 만든 위반이 있었다. 위임 시 이 규칙을 명시할 것), 전역 설치 금지, git 쓰기 금지, `docs/` 수정 금지, 실제 AI API 호출 금지. **프로세스 목록(`ps`)이나 환경 변수를 출력하는 명령을 실행하지 않는다** (지난 작업에서 다른 프로그램의 API 키가 노출됐다).

## 1. 사이드바 항목이 세그먼트가 되지 않는 문제 (`src/core/segment`)
실제 nextjs.org 사이드바 구조 (`tests/fixtures/nextjs-docs.html`에 있음):
```html
<li class="..."><div ...><a href="..."><span class="flex ..."><span class="truncate">Installation</span></span></a></div></li>
```
- `li`는 블록 후보지만 직접 자식이 `div`(경계 요소)뿐이라 인라인 덩어리가 없다
- `div`는 후보가 아니고, 직접 텍스트 노드가 없어 `generic` 판정도 받지 못한다
- `a`·`span`은 부모 블록(li)이 있어 블록이 되지 못한다 → 텍스트가 어디에도 속하지 않음
수정 방향:
- 경계 요소(`div, section, article` 등)가 **후보 블록 안에 있고**, 자기 직접 자식 중에 (공백이 아닌 텍스트 노드) 또는 (텍스트를 가진 인라인 요소)가 있으면 그 요소를 블록으로 삼는다 — 즉 "직접 텍스트"뿐 아니라 "인라인 내용"을 기준으로 `generic` 판정
- 어떤 텍스트 노드도 "번역 대상 블록에 속하지 못하고 버려지는" 경우가 없어야 한다 (제외 규칙에 걸린 경우 제외)
- 회귀 테스트: 위 구조 단위 테스트, `nextjs-docs.html` fixture에서 사이드바 링크 텍스트(Installation, Project Structure, Caching 등)가 세그먼트로 잡히는지, 기존 fixture 5종의 세그먼트 수 변화 보고 (크게 늘면 원인 분석)
- E2E Next.js 시나리오: 사이드바 항목이 `compact`로 렌더되고 높이가 변하지 않는지

## 2. 팝업 "이 사이트 항상 번역" 체크박스 배치
현상(다크 모드 실기): 체크박스가 가운데 떨어져 있고 라벨이 오른쪽에서 두 줄로 줄바꿈된다. 원인 추정: `popup.css`의 `.popup input` 규칙이 체크박스에도 폭·패딩을 적용
- 체크박스·라디오에는 텍스트 입력용 스타일이 적용되지 않게 하고, 체크박스와 라벨을 한 줄 왼쪽 정렬로
- 팝업 메인·설정 화면 캡처(라이트·다크)를 `.output/ui-popup-*`로 다시 저장

## 완료 조건
```
npm run typecheck && npm run lint && npm test && npm run build && npm run build:firefox && npm run test:e2e
```

## 보고
결과, 바꾼 파일, fixture별 세그먼트 수 변화(전→후), 남은 문제
