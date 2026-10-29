# Chrome 웹 스토어 제출 자료

## 기본 정보
- 이름: lingo-patch
- 카테고리: 생산성 (Productivity) 또는 도구 (Tools)
- 언어: 한국어
- 공개 범위: 비공개(링크가 있는 사용자만, Unlisted) 권장
- 패키지: `npm run zip` → `.output/lingo-patch-<버전>-chrome.zip`
- 이미지: `store/assets/` (스크린샷 1280x800, 작은 홍보 타일 440x280), 아이콘 `public/icon/128.png`

## 짧은 설명 (132자 이하)
웹 페이지를 원문 아래 번역문을 붙이는 이중 언어로 AI 번역합니다. 한 번 번역한 문단은 캐시로 저장해 다시 방문하면 바로 복원합니다.

## 자세한 설명
lingo-patch는 웹 페이지 레이아웃을 깨지 않고 문단마다 번역문을 덧붙이는 AI 번역 확장입니다.

주요 기능
• 이중 언어 / 번역문만 / 원문만 표시 모드
• 문단 단위 캐시: 같은 문단은 다시 요청하지 않고, 페이지가 일부 바뀌면 바뀐 문단만 번역
• 화면에 보이는 부분부터 번역해 비용 절약
• 드래그한 문장만 번역
• 용어집으로 고유명사·전문 용어 고정
• AI 토큰 사용량 기록 (페이지별, 일·주·월, 모델별)
• 자동 번역 사이트 등록, 단축키 지원
• 캐시 내보내기·가져오기

지원 AI 제공자 (본인 API 키 사용)
OpenAI, Anthropic Claude, Google Gemini(무료 키 가능), DeepSeek, Groq, OpenRouter, OpenAI 호환 주소

개인정보
개발자 서버가 없습니다. 번역할 문장은 사용자가 선택한 AI 제공자로만 직접 전송되고, API 키와 캐시는 브라우저 안에만 저장됩니다.

## 단일 목적 (Single purpose)
사용자가 선택한 AI 제공자로 웹 페이지 문장을 번역해 원문 옆에 표시하고, 번역 결과를 로컬에 캐시합니다.

## 권한 사용 이유 (Permission justification)
| 권한 | 이유 |
|---|---|
| storage | 설정, 용어집, 사용자 API 키, 토큰 사용량 통계를 로컬에 저장 |
| alarms | 오래된 번역 캐시를 주기적으로 정리 |
| activeTab | 팝업·단축키로 현재 탭 번역을 켜고 끌 때 해당 탭에 접근 |
| scripting | 확장 설치·업데이트 전부터 열려 있던 탭에 번역 스크립트를 다시 주입 |
| 호스트 권한 (api.openai.com, api.anthropic.com, generativelanguage.googleapis.com, api.deepseek.com, api.groq.com, openrouter.ai) | 사용자가 고른 AI 제공자 API로 번역 요청을 보냄 |
| 선택 호스트 권한 (https://*/*, http://*/*) | 사용자가 직접 입력한 OpenAI 호환 주소를 쓸 때만 요청 |
| 콘텐츠 스크립트 (<all_urls>) | 사용자가 방문하는 페이지의 문단을 찾아 번역문을 덧붙이기 위함. 사용자가 번역을 켜거나 자동 번역 사이트로 등록한 경우에만 문장을 전송 |

원격 코드 사용: 없음 (모든 코드는 패키지에 포함).

## 데이터 사용 공개 (Privacy practices 탭)
- 수집 항목: "웹사이트 콘텐츠(Website content)" — 번역을 위해 사용자가 선택한 AI 제공자로 전송. "인증 정보(Authentication information)" — 사용자의 API 키, 로컬 저장 및 해당 제공자 인증에만 사용.
- 체크할 확인 항목: 승인된 용도 외 제3자 판매·이전 안 함 / 핵심 기능과 무관한 용도로 사용 안 함 / 신용도 판단·대출 용도로 사용 안 함.
- 개인정보처리방침 URL: `store/PRIVACY.md`를 공개 주소에 올린 뒤 그 URL 입력.

## 제출 순서
1. https://chrome.google.com/webstore/devconsole 에 Google 계정으로 로그인 → 개발자 등록비 $5 결제 (1회)
2. 계정 이메일 인증
3. "새 항목" → zip 업로드
4. 스토어 등록정보: 위 설명, 카테고리, 언어, 이미지 입력
5. 개인정보 보호: 단일 목적, 권한 이유, 데이터 사용 공개, 개인정보처리방침 URL 입력
6. 배포: 공개 범위 선택 → 검토 제출 (모든 사이트 접근 권한 때문에 심사가 며칠 걸릴 수 있음)
