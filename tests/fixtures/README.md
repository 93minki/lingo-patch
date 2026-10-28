# HTML fixtures (P1 C1)

실제 문서 사이트 HTML 스냅샷. 세그먼트 분리 단위 테스트(`tests/unit/segment/fixtures.test.ts`)용.

수신·가공: **2026-10-28** (`curl -sL` + Python 표준 라이브러리 정규식 정제).

## 가공 규칙

- 제거: `<script>`, `<style>`, `<link>`, `<noscript>`, `<iframe>` 요소 전체, HTML 주석(`<!-- … -->`)
- 유지: 헤더·사이드바(`nav`/`aside`)·본문·`<pre>`/`<code>` 블록 등 마크업 구조
- 300KB 초과 시: `nav`/`aside` 안의 `<li>`를 끝에서부터 삭제 (본문은 축소하지 않음). 이번 5종은 모두 300KB 이하로 추가 축소 없음

## 목록

| 파일                    | 계열                | 출처 URL                                                                                   | 수신       | 대체 URL    | 가공 후 크기         | 가공                          |
| ----------------------- | ------------------- | ------------------------------------------------------------------------------------------ | ---------- | ----------- | -------------------- | ----------------------------- |
| `react-learn.html`      | Next.js (react.dev) | https://react.dev/learn                                                                    | 2026-10-28 | 없음 (원본) | 223,235 B (~218 KiB) | 5종 요소·주석 제거, 축소 없음 |
| `mdn-array-map.html`    | MDN                 | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map | 2026-10-28 | 없음 (원본) | 116,832 B (~114 KiB) | 5종 요소·주석 제거, 축소 없음 |
| `docusaurus-intro.html` | Docusaurus          | https://docusaurus.io/docs                                                                 | 2026-10-28 | 없음 (원본) | 46,382 B (~45 KiB)   | 5종 요소·주석 제거, 축소 없음 |
| `vitepress-guide.html`  | VitePress           | https://vitepress.dev/guide/what-is-vitepress                                              | 2026-10-28 | 없음 (원본) | 27,854 B (~27 KiB)   | 5종 요소·주석 제거, 축소 없음 |
| `rust-book-ch01.html`   | mdBook              | https://doc.rust-lang.org/book/ch01-01-installation.html                                   | 2026-10-28 | 없음 (원본) | 22,692 B (~22 KiB)   | 5종 요소·주석 제거, 축소 없음 |

정제는 주석 제거 후 script/style/noscript/iframe 전체 요소와 link 태그를 대소문자 구분 없이 제거했다. 원본 URL 대체·본문 축소 없음. 일회성 가공 스크립트와 원본 임시 파일은 보관하지 않는다.
