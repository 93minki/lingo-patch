# P5 수정 2 — 첫 접속 시 팝업이 "번역할 수 없습니다"로 나오는 문제

발신: Opus (w6:p1) → 수신: Cursor (w6:p3)

## 현상
페이지에 처음 접속한 뒤 툴바 팝업을 열면 "이 페이지는 번역할 수 없습니다". 새로고침하면 정상.

## 원인 (Opus 분석)
`src/messaging/api.ts`는 `service.status(tabId)`(background가 Port로 연결된 탭 목록)에 탭이 없으면 unavailable로 판단한다. 첫 접속에서 이 목록에 탭이 없는 경우:
1. **프리렌더**: Chromium은 주소창 입력·검색 결과에서 페이지를 미리 렌더링하고 Enter 시 활성화한다. content script는 프리렌더 문서에서 이미 실행돼 Port를 연결하는데, 이때 `port.sender.tab.id`가 실제 보이는 탭 id와 다르다. 또 프리렌더 상태에서 번역 요청까지 나가 **사용자가 보지 않은 페이지에 토큰을 쓸 수 있다.**
2. **확장 재로드 후 기존 탭**: 새 content script가 주입되지 않아 연결이 없다.
3. **bfcache 복귀**: 페이지가 뒤로가기 캐시에 들어가면 Port가 끊기고, 복귀 시 다시 연결되지 않을 수 있다.

## 절대 규칙
lingo-patch 폴더 안만 수정, 전역 설치 금지, git 쓰기 금지, `docs/` 수정 금지, 실제 AI API 호출 금지.

## 수정
1. **content (`src/content/pipeline.ts` 또는 entrypoint)**
   - `document.prerendering === true`이면 연결·스캔·번역을 하지 않고 `prerenderingchange` 이벤트 후에 시작한다
   - `pageshow` 이벤트에서 `event.persisted === true`이면(bfcache 복귀) Port가 끊긴 상태일 때 즉시 다시 연결한다
   - `runtime.onMessage`로 `{ scope: 'lp-content', type: 'ping' }`을 받으면: 현재 Port를 끊고 새로 연결한 뒤 `{ ok: true }`로 응답한다 (background가 올바른 tab id로 다시 등록하도록)
2. **background (`src/messaging/api.ts`)**
   - `getTabStatus` 등에서 URL은 번역 가능한데 `service.status(tabId)`가 없으면 `ensureContent(tabId)`를 먼저 실행한다
     1. `tabs.sendMessage(tabId, ping)` 시도 → 응답이 오면 연결이 다시 등록될 때까지 최대 1초 대기
     2. 실패하면(content script 없음) `scripting.executeScript({ target: { tabId }, files: [content script 빌드 경로] })`로 주입 → 최대 1.5초 대기
     3. 그래도 없으면 지금처럼 unavailable
   - 매니페스트 `permissions`에 `scripting` 추가. content script 빌드 파일 경로는 WXT 산출물 기준으로 확인(하드코딩 대신 manifest의 `content_scripts[0].js`를 `runtime.getManifest()`로 읽는 방식 권장)
   - 주입된 content script가 기존(무효화된) 인스턴스와 중복 실행되지 않는지 확인 (WXT `ctx.onInvalidated`가 이전 인스턴스를 정리하는지, 아니면 전역 플래그로 중복 방지)
3. **팝업**: 상태를 받는 동안 "확인 중…" 표시 (unavailable을 먼저 보여주지 않기)

## 테스트
- 단위: prerendering 중 연결하지 않음 → `prerenderingchange` 후 연결, `pageshow persisted` 재연결, ping 수신 시 재연결, `ensureContent`의 ping 성공 / ping 실패→주입 / 둘 다 실패 경로
- E2E: 확장 서비스워커를 재시작하거나 content 연결이 없는 탭에서 팝업 상태 API 호출 시 available로 회복되는 시나리오 1개 (가능한 범위에서)
- 기존 테스트 유지

## 완료 조건
```
npm run typecheck && npm run lint && npm test && npm run build && npm run build:firefox && npm run test:e2e
```

## 보고
결과 요약, 바꾼 파일, 중복 실행 방지 방법, 검증하지 못한 부분
