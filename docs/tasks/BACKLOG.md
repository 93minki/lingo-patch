# 백로그 (검수 중 발견, 아직 처리 안 함)

| 출처 | 내용 | 우선순위 |
|---|---|---|
| P4 검수 | `content/pipeline.ts`의 `scan()`·`request()`가 records를 선형 탐색 (세그먼트 수 제곱). 블록→record Map 인덱스로 바꾸기 | 중 (세그먼트 1,000개 이상 페이지에서 체감) |
| P4 검수 | DOM이 바뀔 때마다 전체 재스캔(findSegments + 전체 해시 + 전체 lookup). 시계·광고처럼 계속 바뀌는 페이지에서 반복 실행됨. 추가된 하위 트리만 스캔하거나 최소 간격 두기 | 중 |
| P4 보고 | 가로 flex·grid 부모에서 번역문이 추가 배치 항목이 되어 레이아웃이 바뀔 수 있음 | 실사용 확인 후 |
| P4 보고 | 번역문만 보기 모드(`font-size:0`)가 자식의 명시적 글꼴 크기를 못 숨길 수 있음 | 실사용 확인 후 |
| P4 보고 | macOS 헤드리스에서 `Alt+A` 실제 키 이벤트 미검증 (단위 테스트만) | 수동 확인 |
| P0~ | Firefox `data_collection_permissions` 미선언 경고 | P7 |
| P3 검수 | `core/prompt`가 `providers/types`(ProviderError)에 의존 — core→providers 역방향 의존 | 하 |
