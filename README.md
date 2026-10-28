# lingo-patch

AI로 웹 페이지를 **이중 언어**로 번역하는 크로스 브라우저 확장 프로그램입니다. 문단 단위로 번역 결과를 로컬 캐시에 저장해, 같은 페이지를 다시 열면 API 호출 없이 복원할 수 있습니다. 원본 페이지의 텍스트 노드는 수정하지 않고, 번역문만 덧붙입니다.

기술 스택: [WXT](https://wxt.dev/) + TypeScript + Preact.

## 개발 환경

### 사전 요구

- Node.js (npm 포함)
- Chromium 계열(Chrome, Edge 등) 또는 Firefox

### 설치 및 실행

```bash
npm install
npm run dev          # Chromium — 감시 빌드, .output/ 에 산출
npm run dev:firefox  # Firefox
```

### 확장 프로그램 불러오기 (개발자 모드)

**Chromium**

1. `npm run dev` 실행 후 `.output/chrome-mv3-dev`(또는 안내에 나온 dev 출력 폴더)를 확인합니다.
2. 주소창에 `chrome://extensions` 를 엽니다.
3. **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드합니다** → 위 dev 출력 폴더를 선택합니다.
5. 코드를 수정하면 WXT가 다시 빌드합니다. 확장 카드의 **새로고침**으로 반영합니다.

**Firefox**

1. `npm run dev:firefox` 실행 후 `.output/firefox-mv3-dev` 등 dev 출력 폴더를 확인합니다.
2. `about:debugging` → **임시 확장 기능 로드**에서 해당 폴더의 `manifest.json`을 선택합니다.

### 기타 npm 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run build` | Chromium 프로덕션 빌드 |
| `npm run build:firefox` | Firefox 프로덕션 빌드 |
| `npm run zip` | 배포용 zip |
| `npm run typecheck` | 타입 검사 |
| `npm run lint` | ESLint |
| `npm test` | Vitest 단위 테스트 |
| `npm run test:e2e` | E2E (Playwright) |

## 번역 설정 · 무료로 시작 (Gemini)

1. [Google AI Studio](https://aistudio.google.com/)에서 **Gemini API** 키를 발급합니다.
2. 확장 **팝업** 또는 **옵션** 페이지에서 번역 엔진으로 **Gemini**를 선택하고 키를 붙여 넣은 뒤 **키 확인**으로 연결을 검증합니다.
3. 모델을 고른 다음 페이지에서 번역을 사용합니다.

**Gemini 무료·요금 관련 (제공자 조건)**

- 무료 등급·한도·데이터 사용 정책은 Google이 변경할 수 있습니다. 사용 전 [Gemini API 가격](https://ai.google.dev/gemini-api/docs/pricing)에서 현재 조건을 확인하세요.
- 무료 등급에서는 입력이 Google의 서비스 개선에 사용될 수 있다는 안내가 UI에 표시됩니다. 유료·엔터프라이즈 정책이 필요하면 동일 문서에서 확인하세요.
- 다른 무료 경로(Groq, OpenRouter `:free` 모델 등)는 **고급 설정**에서 선택할 수 있습니다. 각 제공자의 한도·약관은 해당 콘솔에서 확인해야 합니다.

OpenAI, Anthropic 등 유료 제공자는 각 콘솔에서 키를 발급한 뒤 같은 방식으로 엔진과 키를 설정합니다.

## API 키 보관 방식

- API 키는 **`browser.storage.local`의 `lp-secrets`** 에 `{ [제공자 또는 프리셋 id]: apiKey }` 형태로 저장됩니다.
- **암호화하지 않으며**, OS 키체인·비밀번호 관리자와 연동하지 **않습니다**. 디스크/프로필에 평문에 가깝게 남을 수 있으므로, 공유 PC·원격 지원·악성 확장 프로그램에 노출되지 않도록 주의하세요.
- 번역 설정(`lp-settings`)에는 키가 들어가지 않습니다. background가 번역 요청을 보낼 때만 키를 합칩니다. content script에는 키가 전달되지 않도록 설계되어 있습니다.
- 제공자를 바꿔도 이전 제공자 키는 `lp-secrets`에 남아 있어, 다시 선택하면 재입력 없이 불러올 수 있습니다(해당 id에 키가 저장되어 있는 경우).

## 키 삭제 · 유출이 의심될 때

### 확장 프로그램에서 삭제

- **팝업·옵션** 설정 화면: API 키 입력란 옆 **키 삭제**(저장된 키가 있을 때). 확인 후 해당 제공자/프리셋 키만 `lp-secrets`에서 **항목 자체가 제거**됩니다.
- **옵션 고급 설정**: **저장된 모든 API 키 삭제** — 모든 제공자·프리셋 키를 한 번에 지웁니다(확인 필수).
- 현재 사용 중인 제공자의 키를 지우면 번역 설정이 미설정 상태가 되어 **새 번역 요청은 중지**됩니다. 이미 저장된 캐시로 복원되는 번역은 계속 표시될 수 있습니다.

### 제공자 콘솔에서 폐기 · 재발급

키가 유출되었거나 저장된 기기를 잃어버렸다면, 확장에서 삭제하는 것과 별도로 **반드시 제공자 콘솔에서 해당 키를 폐기(revoke)하고 새 키를 발급**하세요. 로컬 삭제만으로는 이미 유출된 키의 원격 사용을 막을 수 없습니다.

유출 피해를 줄이려면 새 키 발급 전·후로 **사용 한도**를 콘솔에서 설정하는 것을 권장합니다.

| 제공자 | 공식 안내 (한도·키 제한) |
| --- | --- |
| **OpenAI** | [Managing projects in the API platform](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform) — 프로젝트 전용 키, **월 예산(budget)** 한도. 더 강한 상한이 필요하면 문서에 안내된 **별도 한도 설정**을 확인하세요. |
| **Anthropic** | [Workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces) — **워크스페이스 지출 한도**. 조직/기본 workspace에 어떤 제한이 적용되는지 콘솔에서 확인하세요. |
| **Google Gemini** | [API keys](https://ai.google.dev/gemini-api/docs/api-key?hl=en) — AI Studio에서 키를 만들 때 **Generative Language API(Gemini API)만** 허용하도록 제한할 수 있습니다. 새로 만든 auth key에는 **기본 API 제한**이 적용됩니다. 요금·한도: [Pricing](https://ai.google.dev/gemini-api/docs/pricing). |

## 라이선스 · 기여

저장소 정책은 프로젝트 maintainer에게 따릅니다. 상세 설계는 `docs/DESIGN.md`를 참고하세요(구현자용).
