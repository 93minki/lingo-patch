# 설치 가이드 (개발자 모드)

lingo-patch는 아직 스토어에 올리지 않았다. 각 브라우저의 개발자 모드로 직접 설치한다.
빌드 결과물은 모두 `.output/` 아래에 생긴다.

```bash
npm install
npm run build          # Chrome · Brave · Edge · Whale
npm run build:firefox  # Firefox
npm run build:safari   # Safari (macOS, Xcode 필요)
```

설치 후 처음에는 옵션 화면에서 번역 엔진과 API 키를 설정한다. 무료로 시작하려면 Gemini 무료 키를 권장한다 (`README.md` 참고).

---

## Chrome · Brave · Edge · Whale (Chromium 계열)

같은 빌드(`.output/chrome-mv3`)를 쓴다.

| 브라우저 | 확장 관리 주소 |
|---|---|
| Chrome | `chrome://extensions` |
| Brave | `brave://extensions` |
| Edge | `edge://extensions` |
| Whale | `whale://extensions` |

1. 확장 관리 페이지를 열고 **개발자 모드**를 켠다
2. **압축해제된 확장 프로그램을 로드** → `.output/chrome-mv3` 폴더 선택
3. 툴바의 퍼즐 아이콘에서 lingo-patch를 고정하면 편하다
4. 코드를 다시 빌드한 뒤에는 확장 카드의 새로고침 버튼을 누르고, 열려 있던 탭도 새로고침한다

단축키 변경: Chrome `chrome://extensions/shortcuts`, Brave `brave://extensions/shortcuts`, Edge `edge://extensions/shortcuts`, Whale `whale://extensions/shortcuts`

---

## Firefox

1. `npm run build:firefox`
2. 주소창에 `about:debugging#/runtime/this-firefox` → **임시 부가 기능 로드** → `.output/firefox-mv3/manifest.json` 선택
3. **임시 부가 기능은 Firefox를 재시작하면 사라진다.** 계속 쓰려면 Firefox Developer Edition / Nightly에서 `about:config`의 `xpinstall.signatures.required`를 `false`로 두고 `npm run zip:firefox`로 만든 zip을 설치하거나, AMO에 비공개(unlisted)로 올려 서명받는다
4. **사이트 접근 권한**: Firefox MV3는 설치 때 사이트 접근 권한을 자동으로 주지 않는다. 툴바의 lingo-patch 아이콘을 누르면 나오는 권한 요청을 허용하거나, `about:addons` → lingo-patch → 권한 탭에서 "모든 웹사이트의 데이터에 접근"을 켠다
5. 처음 설치할 때 "웹사이트 콘텐츠를 전송" 데이터 수집 동의가 나온다. 번역할 문장을 사용자가 고른 AI 제공자로 보내기 때문이다

단축키 변경: `about:addons` → 톱니바퀴 → **확장 기능 단축키 관리**

---

## Safari (macOS)

Xcode가 필요하다. 서명하지 않은 로컬 빌드라 개발자 설정이 필요하다.

1. `npm run build:safari` → `.output/safari-xcode/build/Build/Products/Debug/lingo-patch.app`이 만들어진다
2. Safari → 설정 → **고급** → "웹 개발자용 기능 보기" 켜기
3. Safari → 설정 → **개발자** → **"서명되지 않은 확장 프로그램 허용"** 켜기 (macOS 암호 입력)
   - 이 설정은 **Safari를 종료할 때마다 꺼진다.** Safari를 다시 열면 다시 켜야 확장이 보인다
4. Finder에서 위 `lingo-patch.app`을 한 번 실행한다 (확장이 Safari에 등록됨, 앱 창은 닫아도 된다)
5. Safari → 설정 → **확장 프로그램** → lingo-patch 체크
6. 같은 화면에서 "웹 사이트" 권한을 **모든 웹 사이트에서 허용**으로 바꾼다 (기본값은 사이트마다 묻기)

알려진 제한
- 옵션 화면은 새 탭이 아니라 Safari 설정 창 안에서 열릴 수 있다 (`open_in_tab` 미지원)
- 단축키는 Safari가 `commands`를 일부만 지원하므로 동작하지 않을 수 있다. 팝업 버튼을 사용한다
- 계속 쓰려면 Apple Developer 계정으로 서명해야 한다 (개인 사용이면 위 "서명되지 않은 확장 허용"으로 충분)

---

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 팝업이 "이 페이지는 번역할 수 없습니다" | 브라우저 내부 페이지(`chrome://`, 스토어, PDF 뷰어)는 번역할 수 없다. 일반 페이지면 탭 새로고침 |
| 번역이 안 나온다 | 팝업 → 설정에서 키 확인. 진행 표시에 "API 키를 확인하세요"가 나오면 키·모델 문제 |
| 코드 수정이 반영되지 않는다 | 다시 빌드 → 확장 새로고침 → 탭 새로고침 |
| Safari에서 확장이 사라졌다 | Safari 재시작 후 "서명되지 않은 확장 프로그램 허용"을 다시 켠다 |
