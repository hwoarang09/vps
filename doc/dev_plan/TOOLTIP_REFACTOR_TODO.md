# Tooltip 시스템 리팩토링 TODO

## 현재 상황 (v0.4.32 시점)

`MenuTooltip` 위치 계산이 **bottom 메뉴 버튼 높이(56px) 기준의 매직 넘버**(`+54`/`-54`)로 굳어 있음.

`MenuTooltip.tsx`:
```ts
const topOffset = isSubMenu ? 54 : -54;
```

호출 컨벤션도 이 보정에 맞춰 잡혀 있음:
- `MenuButton`(bottom 메뉴): `y: rect.top` 넘기고 `±54` 보정으로 버튼 위/아래에 표시
- `QuickViewToolbar`(top-right): `y: rect.bottom + 4` 넘기는데 또 `+54` 더해져서 한참 아래로 떨어졌었음

## 임시 조치 (B안)

`showTooltip`에 `placement?: "default" | "anchor"` 옵션 추가. `"anchor"`면 MenuTooltip이 위치 보정 안 함 — 호출자가 준 좌표 그대로 사용. `QuickViewToolbar`만 `"anchor"` 사용.

장점: 변경 최소, 기존 bottom 메뉴 동작 그대로.
단점: 매직 넘버 `54`는 여전히 남음. quick toolbar 버튼이 `w-9 h-9`(36px)로 작은데도 다른 toolbar(예: 추후 다른 위치의 toolbar)들이 늘어나면 또 placement 분기 추가해야 함.

## 본격 리팩토링 (C안 — 이 문서 작업 대상)

### 목표
매직 넘버 `54` 제거 + 호출 컨벤션 통일.

### 변경안

**`showTooltip` 시그니처 변경**:
```ts
showTooltip(
  id: string,
  message: string,
  anchorRect: DOMRect,            // 좌표 분해 안 함, DOMRect 통째로
  options?: {
    side?: "top" | "bottom" | "auto";  // "auto"면 viewport 기반 결정
    offset?: number;                   // 기본 8px
  }
)
```

**`MenuTooltip` 내부**:
- `anchorRect.left + anchorRect.width/2` 로 가로 정렬
- side === "top": `top: anchorRect.top - tooltip.height - offset`
- side === "bottom": `top: anchorRect.bottom + offset`
- side === "auto": viewport 경계 체크 (위/아래 빈 공간 큰 쪽 선택)

**모든 caller 업데이트**:
- `MenuButton.tsx`: `showTooltip(id, msg, rect)` — 기존 bottom 메뉴는 자동으로 "top" 선택(아래 공간 없음)
- `QuickViewToolbar.tsx`: 동일하게 `showTooltip(id, msg, rect)` — 자동으로 "bottom" 선택

### 추가 고려사항
- `tooltipLevel` 필드는 의미가 사라짐 → 제거 가능
- `topOffset` 매직 넘버 완전 제거
- 측정 가능한 단위(tooltip height)는 ref + `useLayoutEffect`로 잡거나, 화살표 위치도 자동 계산
- 다른 곳에서 tooltip 패턴 재사용(예: 미래의 anywhere-tooltip)할 때 유연

### 영향 파일
- `src/store/ui/menuStore.ts` — 시그니처
- `src/components/react/menu/MenuTooltip.tsx` — 위치 계산 로직
- `src/components/react/menu/shared/MenuButton.tsx` — 호출부
- `src/components/react/menu/QuickViewToolbar.tsx` — 호출부 (`placement: "anchor"` 제거)

### 예상 작업량
~30분. 테스트 포인트: 5개 정도 (bottom 메뉴 hover 위/아래, sub 메뉴 hover, quick toolbar hover, 화면 가장자리 버튼 hover).

### 시작 시점
다음 UI 리팩토링 사이클 또는 새 toolbar가 추가될 때.
