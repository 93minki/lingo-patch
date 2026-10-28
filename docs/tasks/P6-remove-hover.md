# P6 정리 — 호버 번역 기능 제거

발신: Opus (w6:p1) → 수신: Codex (w6:p2)
결정: 사용자 요청으로 호버(수정키+마우스) 번역을 **완전히 제거**한다. 선택(드래그) 번역은 유지.

## 절대 규칙
lingo-patch 폴더 안만 수정(`/tmp` 포함 폴더 밖 파일 생성 금지), 전역 설치 금지, git 쓰기 금지, `docs/` 수정 금지, 실제 AI API 호출 금지, `ps`·환경 변수 출력 금지.

## 제거 대상
- `src/content/pipeline.ts`의 호버 관련 상태·핸들러(mousemove/keydown/keyup/blur/mouseleave 리스너, `modifierPressed`, `activateHover`, `visitedBlocks`, `hiddenBlocks` 등 호버 전용 로직)
- `src/content/hover-segment.ts`와 그 테스트 — 선택 번역 등 다른 곳에서 쓰지 않을 때만 삭제 (쓰면 이름·위치를 용도에 맞게 정리)
- 설정 `hoverModifier` (스키마·기본값·검증·`mode` 메시지·옵션 UI "호버 번역 수정키"·문구)
- 저장된 기존 설정에 `hoverModifier`가 남아 있어도 오류 없이 무시 (마이그레이션 불필요, 읽을 때 버림)
- 단위·E2E 테스트의 호버 시나리오
- 선택 번역이 호버와 공유하던 코드(수동 요청 `requestManual`, `manualBlocks` 등)는 선택 번역에 필요한 만큼만 남기고 정리
- README·옵션 안내 문구의 호버 언급

## 확인
- 선택 번역 동작·테스트 유지
- 제거 후 사용하지 않는 export·import가 남지 않게 (`npm run lint`)

## 완료 조건
```
npm run typecheck && npm run lint && npm test && npm run build && npm run build:firefox && npm run test:e2e
```
검사가 하나라도 실패하면 완료로 보고하지 않는다.

## 보고
삭제·수정한 파일, 줄 수 변화, 남은 문제
