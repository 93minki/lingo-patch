# P5 수정 — 서비스 워커 재시작 시 번역이 사라졌다 다시 나타나는 깜빡임

발신: Opus (w6:p1) → 수신: Codex (w6:p2, GPT-6.1 Terra high)

## 현상 (실사용)
페이지를 오래 켜 두면 가끔 "원본+번역 → 원본만 → 원본+번역"으로 깜빡인다.

## 원인 (Opus 분석, `src/content/pipeline.ts`)
1. MV3 서비스 워커가 유휴로 종료 → content의 Port `onDisconnect` → 100ms 후 재연결
2. 새 서비스 워커가 `mode` 메시지를 보낸다. `revision`은 `service.ts`에서 메모리 변수(`let revision = 0`)라 재시작 시 0부터 다시 시작
3. content `receive('mode')`의 `changed = !connected || targetLang 변경 || revision !== lastRevision` 이 재연결 때 항상 참 → `reset()` → `clear()`가 모든 `lp-t` 제거 → 재스캔 → 캐시에서 재렌더 (API 비용은 없음, 깜빡임만)

## 절대 규칙
lingo-patch 폴더 안만 수정(`/tmp` 포함 폴더 밖 파일 생성 금지), 전역 설치 금지, git 쓰기 금지, `docs/` 수정 금지, 실제 AI API 호출 금지, `ps`·환경 변수 출력 명령 금지.

## 수정
1. **재연결은 화면을 지우지 않는다.** 연결이 끊겼다 다시 붙은 것만으로는 `clear()`하지 않는다. 기존 `records`·`memory`·렌더된 `lp-t`를 유지하고:
   - 현재 records의 키로 `page`·`lookup`을 다시 보내고
   - 끊기기 전에 요청했지만 응답을 못 받은 키(`requested`)는 다시 IntersectionObserver에 등록해 필요하면 재요청 (캐시에 이미 저장됐으면 lookup으로 복원됨 — P5에서 진행 중 배치는 완주·저장하도록 바뀌었음)
   - 진행 표시(상단 알약) 카운트가 어긋나지 않게 정리
2. **"정말 바뀐 것"만 reset 대상.** `revision` 숫자 비교 대신 실제 값 비교:
   - `targetLang` 변경, `autoEnabled`(이 사이트 자동 번역) 변경으로 enabled가 바뀐 경우, URL 변경(기존 navigate 경로), `toggle` → 지금처럼 reset/clear
   - `displayMode`만 바뀐 경우 → `data-lp-mode` 속성만 갱신 (지금도 그렇다면 유지)
   - 그 밖의 설정 변경(제공자·모델 등)은 화면 유지
   - `revision`이 다른 용도로 필요하면 유지하되 reset 판단에 쓰지 않는다
3. 같은 원칙을 P5-fix2의 `ping` 재연결(`reconnectPort`)에도 적용 — ping으로 다시 붙을 때도 화면을 지우지 않는다

## 테스트
- 단위(pipeline): 렌더 완료 상태에서 Port 끊김 → 재연결 → 새 `mode`(revision 0, 같은 설정) 수신 시 `lp-t` 개수·노드가 그대로이고 `clear`가 호출되지 않음. 이때 `lookup`이 다시 전송됨
- 단위: 재연결 후 targetLang이 바뀐 `mode` → reset 수행
- 단위: ping 재연결도 화면 유지
- E2E(가능하면): 번역 완료 후 확장 서비스 워커를 종료(Playwright에서 가능한 방법을 찾고, 불가능하면 테스트 전용 훅으로 모든 Port를 끊는 메시지)한 뒤 `lp-t` 개수가 줄지 않고, 추가 API 호출 0
- 기존 테스트 유지

## 완료 조건
```
npm run typecheck && npm run lint && npm test && npm run build && npm run build:firefox && npm run test:e2e
```

## 보고
결과, 바꾼 파일, 재연결 시 동작 요약, E2E에서 서비스 워커 종료를 어떻게 재현했는지, 남은 문제
