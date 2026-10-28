# P6 후속 — API 키 분리 보관, 제공자 한도 안내

발신: Opus (w6:p1) → 수신: Codex (w6:p2) 또는 Cursor (w6:p3)
배경: `docs/DESIGN.md` §7.4.1 (2026-10-28 결정)

## 절대 규칙
lingo-patch 폴더 안만 수정(`/tmp` 포함 폴더 밖 파일 생성 금지), 전역 설치 금지, git 쓰기 금지, `docs/` 수정 금지, 실제 AI API 호출 금지, `ps`·환경 변수 출력 금지.

## 1. 키 분리 보관
- API 키를 `lp-settings.provider.apiKey`에서 빼서 별도 항목 `lp-secrets` = `{ [providerId 또는 preset id]: apiKey }`에 저장. 제공자를 바꿔도 이전 제공자 키가 남아 있어 다시 고르면 재입력 불필요
- `getSettings()`는 키 없이 설정만 반환. 키는 `src/storage/secrets.ts`의 `getApiKey(id)` / `setApiKey(id, key)` / `clearApiKey(id)`로만 접근
- background가 provider를 만들 때만 키를 합친다. 팝업·옵션은 키 입력·"키 보기"·저장에만 사용
- **마이그레이션**: 기존 `lp-settings.provider.apiKey`가 있으면 첫 실행 때 `lp-secrets`로 옮기고 `lp-settings`에서 제거 (확장 업데이트 후 키를 다시 넣지 않아도 되게)
- **보장 테스트**: content script 번들(`.output/chrome-mv3/content-scripts/content.js`)과 `src/content/**`에 `lp-secrets`·`getApiKey` 참조가 없음을 검사하는 테스트. background→content 메시지에 키가 없음을 검사하는 테스트(기존 것이 있으면 유지)

## 2. 제공자 한도 안내
- 옵션 화면 번역 엔진 섹션 아래(팝업 설정 화면에는 한 줄 + 고급 설정 링크): "키가 유출돼도 피해를 줄이려면 제공자 콘솔에서 사용 한도를 설정하세요" + 제공자별 한 줄 안내와 링크(공식 문서로 확인한 URL만)
  - OpenAI: 프로젝트 전용 키 + 월 예산 한도
  - Anthropic: 워크스페이스 지출 한도
  - Gemini: 키의 API 제한(Generative Language API만 허용)
- 저장소 루트 `README.md` 작성(없으면 생성): 프로젝트 소개, 설치(개발자 모드 로드), 키 발급·무료 시작 안내, **키 보관 방식과 한도 설정 권장**, 개발 명령어

## 완료 조건
```
npm run typecheck && npm run lint && npm test && npm run build && npm run build:firefox && npm run test:e2e
```
검사가 하나라도 실패하면 완료로 보고하지 않는다.

## 보고
결과, 바꾼 파일, 마이그레이션 동작, 확인한 공식 문서 URL, 남은 문제
