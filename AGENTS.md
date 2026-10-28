# lingo-patch — 구현자 가이드

AI로 웹 페이지를 이중 언어로 번역하고, 문단 단위 캐시로 재방문 시 API 호출 없이 복원하는 크로스 브라우저 확장(WXT + TypeScript).

상세 설계는 `docs/DESIGN.md`, 설치는 `docs/INSTALL.md`, 남은 과제는 `docs/BACKLOG.md`를 따른다.

구현 전에 `docs/DESIGN.md` **§3 기술 스택**, **§10 디렉터리**, **§11 단계 계획**, **§12 작업 프로세스**를 읽는다.

## 디렉터리 구조 (`docs/DESIGN.md` §10)

```
lingo-patch/
├─ AGENTS.md
├─ docs/DESIGN.md
├─ wxt.config.ts
├─ src/
│  ├─ entrypoints/
│  │  ├─ background.ts
│  │  ├─ content/index.ts
│  │  ├─ popup/
│  │  └─ options/
│  ├─ core/                 # 순수 로직 — DOM·브라우저 API 금지, 단위 테스트 대상
│  │  ├─ segment/
│  │  ├─ cache/
│  │  ├─ queue/
│  │  ├─ glossary/
│  │  └─ prompt/
│  ├─ providers/
│  ├─ storage/
│  ├─ content/              # renderer, observers, spa, overlay
│  ├─ messaging/
│  ├─ platform/
│  └─ ui/
└─ tests/
   ├─ unit/
   ├─ fixtures/
   └─ e2e/
```

## 명령어 (P0 `package.json` 스크립트)

| 스크립트                | 설명                            |
| ----------------------- | ------------------------------- |
| `npm run dev`           | Chromium 계열 개발 모드         |
| `npm run dev:firefox`   | Firefox 개발 모드               |
| `npm run build`         | Chromium 계열 프로덕션 빌드     |
| `npm run build:firefox` | Firefox 프로덕션 빌드           |
| `npm run zip`           | 배포용 zip                      |
| `npm run typecheck`     | WXT 타입 생성 후 `tsc --noEmit` |
| `npm run lint`          | ESLint                          |
| `npm run format`        | Prettier                        |
| `npm test`              | Vitest 단위 테스트              |

P0 완료 검증:

```bash
npm run typecheck && npm run lint && npm test && npm run build && npm run build:firefox
```

## 규칙 (P0 절대 규칙 + 구현 원칙)

1. **작업 범위**: `lingo-patch` 저장소 루트(`/Users/93minki/Desktop/Study/lingo-patch`) 안의 파일만 생성·수정한다. 전역 설치(`npm i -g`, `corepack enable`, brew 등)와 홈 디렉터리 설정 변경은 하지 않는다. npm의 기본 캐시(`~/.npm`)와 시스템 임시 폴더는 그대로 사용해도 된다 (프로젝트 안에 캐시 폴더를 만들지 않는다).
2. **Git**: Opus 검수·사용자 승인 전까지 **커밋·브랜치 생성 등 git 쓰기 작업을 하지 않는다.** (`git status` / `git diff` 읽기는 가능)
3. **설계 문서**: `docs/DESIGN.md`는 구현자가 수정하지 않는다. 설계와 다르게 구현해야 하면 보고에 이유를 적는다.
4. **`src/core/`**: 전역 객체(`document`, `window`, `browser`/`chrome`, `fetch`, `indexedDB`)를 직접 참조하지 않는다. DOM 노드는 **인자로 받은 것만** 표준 DOM API로 다룬다 (happy-dom으로 테스트 가능해야 함). 브라우저 연동은 `src/content/`, `src/storage/`, `src/platform/`, 엔트리포인트에서 처리한다.
5. **페이지 DOM**: 원본 페이지의 **텍스트 노드는 수정하지 않는다.** 번역문은 `<lp-t>` 등으로 덧붙이기만 한다 (`docs/DESIGN.md` §5.3).
6. **테스트**: 새 코드는 단위 테스트를 함께 추가한다. 단위 테스트는 `tests/unit/`에 둔다.
7. **패키지 매니저**: npm. 의존성은 호환되는 안정 버전을 쓰고 `package-lock.json`을 유지한다. TypeScript는 typescript-eslint 지원 범위에 맞춰 6.0.x를 사용한다. 의존성을 갱신할 때 지원 범위를 다시 확인한다.
