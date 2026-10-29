# 백로그 (검수 중 발견, 아직 처리 안 함)

| 출처 | 내용 | 우선순위 |
|---|---|---|
| P4 검수 | `content/pipeline.ts`의 `scan()`·`request()`가 records를 선형 탐색 (세그먼트 수 제곱). 블록→record Map 인덱스로 바꾸기 | ✅ 완료 (3c4fb64) |
| P4 검수 | DOM이 바뀔 때마다 전체 재스캔(findSegments + 전체 해시 + 전체 lookup). 시계·광고처럼 계속 바뀌는 페이지에서 반복 실행됨. 추가된 하위 트리만 스캔하거나 최소 간격 두기 | ✅ 완료 (3c4fb64) |
| P4 보고 | 가로 flex·grid 부모에서 번역문이 추가 배치 항목이 되어 레이아웃이 바뀔 수 있음 | 실사용 확인 후 |
| P4 보고 | 번역문만 보기 모드(`font-size:0`)가 자식의 명시적 글꼴 크기를 못 숨길 수 있음 | 실사용 확인 후 |
| P4 보고 | ~~호버/단축키 실기 검증~~ 호버 기능 제거됨, 단축키는 Mac Control로 변경 | ✅ 정리 |
| P0~ | Firefox `data_collection_permissions` 미선언 경고 | ✅ 완료 (aefe9f4) |
| P3 검수 | `core/prompt`가 `providers/types`(ProviderError)에 의존 — core→providers 역방향 의존 | 하 |
| P7 | Next.js 사이드바처럼 원문 칸이 `flex:1; truncate`면 번역문이 오른쪽 끝에 붙고 원문이 잘림 | 실사용 판단 |
| P7 | Firefox·Whale 실기 검증 (이 Mac에 미설치), Safari 실기 검증 | 수동 |
| P7 | `scan-block.ts`의 블록 판정 규칙이 `core/segment`와 중복 정의됨 — 한쪽만 바뀌면 어긋날 수 있음 | 하 |
