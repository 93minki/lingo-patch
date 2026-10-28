# P7-2 Firefox 대응 — innerHTML 제거, 사이트 접근 권한 요청

발신: Opus (w6:p1) → 수신: Cursor. Opus가 직접 검수한다.

## 절대 규칙
1. `/Users/93minki/Desktop/Study/lingo-patch` 폴더 안의 파일만 만들고 고친다. `/tmp` 등 폴더 밖 파일 생성 금지
2. 전역 설치 금지, git 쓰기 금지, `docs/` 수정 금지, 실제 AI API 호출 금지, `ps`·`env`·`printenv` 금지
3. `package.json`, `wxt.config.ts`는 수정 금지 (필요하면 보고서에 제안만)

## 1. innerHTML 제거 (Firefox 스토어 심사 경고 `UNSAFE_VAR_ASSIGNMENT`)
- `src/content/progress.ts:81`, `src/content/selection-overlay.ts:143`의 `root.innerHTML = \`<style>...\`` 템플릿을 `document.createElement`로 바꾼다
  - `<style>`은 `createElement('style')` + `textContent = CSS`
  - 버튼·팝오버·텍스트도 `createElement` + `setAttribute` + `textContent`
- 동작·스타일·접근성 속성(role, aria-*)은 그대로 유지, 기존 테스트 통과
- 검증: `npm run build:firefox` 후 `npx --yes web-ext@8.10.0 lint -s .output/firefox-mv3` 결과에서 `content-scripts/content.js`의 `UNSAFE_VAR_ASSIGNMENT`가 사라짐 (Preact 라이브러리 청크의 경고 1건은 남아도 됨 — 보고서에 명시)

## 2. Firefox 사이트 접근 권한 요청
배경: Firefox MV3는 설치 시 `host_permissions`와 content script의 `<all_urls>` 접근을 자동으로 주지 않는다. 사용자가 허용해야 content script가 동작하고 AI API도 호출할 수 있다.
- 공통 헬퍼 `src/platform/host-access.ts`:
  - `hasPageAccess(origin)`: `browser.permissions.contains({ origins: [origin + '/*'] })`
  - `hasProviderAccess(origins)`: 제공자 API 도메인들 권한 확인
  - `requestAccess({ pages: 'all' | origin, providers })`: `browser.permissions.request` (반드시 사용자 클릭 핸들러 안에서 호출)
- 팝업: 현재 탭이 번역 가능한 URL인데 페이지 접근 권한이 없으면 "이 사이트 접근 허용" 버튼과 "모든 사이트 허용" 버튼을 보여준다. 허용 후 탭에 content script가 없으면 기존 `ensureContent`(ping → scripting 주입) 흐름으로 바로 동작하게 한다
- 옵션 "번역 엔진" 섹션: 선택한 제공자의 API 도메인 권한이 없으면 "API 접근 허용" 버튼. 키 확인 전에 권한을 먼저 요청
- Chrome/Brave/Safari에서는 권한이 이미 있으므로 버튼이 나타나지 않아야 한다 (분기는 `permissions.contains` 결과로만 판단, 브라우저 이름으로 분기하지 않기)
- 문구는 `src/ui/strings.ts`에 추가
- 테스트: `permissions.contains` false/true 각각에서 팝업·옵션 표시, 버튼 클릭 시 `permissions.request` 인자, 허용 후 ensureContent 호출

## 완료 조건 (모두 통과)
```
npm run typecheck && npm run lint && npm test && npm run build && npm run build:firefox && npm run test:e2e
```
그리고 위 web-ext lint 결과를 보고서에 붙인다.

## 보고 (마지막 응답)
결과 요약, 바꾼 파일, web-ext lint 요약, 남은 문제
