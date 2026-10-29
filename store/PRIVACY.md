# lingo-patch 개인정보처리방침 / Privacy Policy

시행일: 2026-10-29

## 한국어

lingo-patch(이하 "확장")는 사용자가 고른 AI 제공자를 이용해 웹 페이지를 번역하는 브라우저 확장입니다. 개발자는 별도 서버를 운영하지 않으며, 사용자의 데이터를 수집·보관·판매하지 않습니다.

### 처리하는 정보와 목적

| 정보 | 처리 방식 | 목적 |
|---|---|---|
| 번역할 웹 페이지의 문장 | 사용자가 번역을 켠 페이지(또는 자동 번역 사이트로 등록한 사이트)의 문장을 사용자가 설정한 AI 제공자(OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, OpenRouter 또는 사용자가 입력한 주소)로 직접 전송 | 번역 |
| API 키 | 사용자의 브라우저 로컬 저장소(`chrome.storage.local`)에만 저장, 해당 AI 제공자에게 인증용으로만 전송 | AI 제공자 인증 |
| 번역 결과 캐시 | 브라우저 IndexedDB에 저장 (원문 해시와 번역문), 기본 90일 후 삭제 | 재방문 시 다시 요청하지 않기 위함 |
| 설정, 용어집, 토큰 사용량 통계 | 브라우저 로컬 저장소에만 저장 | 기능 제공 |

- 위 정보는 개발자에게 전송되지 않습니다. 분석 도구, 광고, 추적 코드를 사용하지 않습니다.
- AI 제공자로 전송된 문장은 각 제공자의 개인정보처리방침에 따라 처리됩니다.
- 비밀번호 입력란, 편집 가능한 영역 등 입력 중인 내용은 번역하지 않습니다.

### 보관과 삭제

모든 데이터는 사용자의 브라우저에만 있습니다. 옵션 화면에서 API 키 삭제, 캐시 삭제, 사용량 기록 초기화를 할 수 있고, 확장을 삭제하면 모두 지워집니다.

### 문의

GitHub 저장소의 Issues 또는 개발자 이메일로 문의할 수 있습니다.

## English

lingo-patch is a browser extension that translates web pages using the AI provider the user chooses. The developer runs no server and does not collect, store, or sell user data.

- **Page text:** On pages where the user turns translation on (or sites the user registers for auto-translation), text is sent directly from the browser to the user's configured AI provider (OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, OpenRouter, or a custom endpoint) solely to translate it.
- **API keys:** Stored only in the browser's local extension storage and sent only to the matching AI provider for authentication.
- **Translation cache, settings, glossary, token usage stats:** Stored only in the browser (IndexedDB / extension storage). The cache expires after 90 days by default.
- No data is sent to the developer. No analytics, ads, or tracking.
- Text sent to an AI provider is handled under that provider's privacy policy.
- Users can delete keys, cache, and usage history from the options page; uninstalling removes everything.
