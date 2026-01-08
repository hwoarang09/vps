# Code Style Rules

이 프로젝트의 정적 분석 규칙입니다. 코드 작성 시 반드시 준수하세요.

## Naming Convention (컬렉션/ID/도메인)

TypeScript/JavaScript 코드에서 **컬렉션/ID/도메인 개념**을 이름만 보고 바로 이해하게 만드는 네이밍 컨벤션.

### Core Principle

이름은 "자료구조(Map/Array) 설명"보다 **접근 방식(키)과 도메인 의미**를 먼저 드러낸다.
(단, 자료구조 차이가 실제로 중요할 때만 접미사로 구분한다.)

### ID Types

* **Primitive alias 금지:** `type FabId = string` 같은 건 Sonar 관점에서 이득이 없으니 쓰지 않는다.
* **타입 안전이 필요하면 브랜딩만 허용:** `type FabId = Brand<"FabId", string>` 형태만 허용.
* **그 외에는 `string` + 주석으로 의미를 남긴다.**
  ```typescript
  /** Unique identifier for the fab (e.g., "fab_A", "fab_B") */
  fabId: string
  ```

### Collections

#### Arrays

* **복수형 명사**로 끝낸다.
  ```typescript
  fabContexts, vehicles, edges, stations
  ```
* 순서/동작 의미가 중요하면 명시한다.
  ```typescript
  vehicleQueue, edgeStack, pendingJobs
  ```
* `...List`는 "순서가 의미 있는 리스트"일 때만 사용.
  ```typescript
  sortedVehicleList
  ```

#### Map (ES6 Map)

* **`<ValuePlural>By<Key>`** 패턴을 기본으로 한다.
  ```typescript
  contextsByFabId: Map<string, FabContext>
  vehicleById: Map<string, Vehicle>  // 단수 value면 단수도 OK
  ```
* "To/Map" 접미사는 기본적으로 금지.
  ```typescript
  // ❌ Bad
  fabIdToContextMap
  
  // ✅ Good
  contextsByFabId
  ```
* 예외적으로 `Map` 접미사를 허용하는 경우:
  * 같은 스코프에 `Record`/`Map` 둘 다 있고 혼동될 때
  * 순수 JS 파일이라 타입이 안 보일 때

#### Record / Plain Object (`Record<K,V>` or `{}`)

* `...By<Key>Record` 또는 `...By<Key>` 중 하나로 통일.
  ```typescript
  contextsByFabIdRecord: Record<string, FabContext>
  ```
* `Map` vs `Record`를 같이 쓰면 **접미사로 반드시 구분**한다.
  ```typescript
  contextsByFabId        // Map
  contextsByFabIdRecord  // Record
  ```

#### Set

* **복수형 + 집합 의미 단어**를 쓴다.
  ```typescript
  activeFabIds: Set<string>
  blockedEdgeIds: Set<string>
  ```
* `setOf...` 같은 표현은 금지.
  ```typescript
  // ❌ Bad
  setOfActiveFabIds
  
  // ✅ Good
  activeFabIds
  ```

### Key Naming

* Key는 가능한 한 **도메인 명사 + Id**로 고정한다.
  ```typescript
  fabId, vehicleId, edgeId, stationId
  ```
* 문자열 키가 "id"가 아니라면 그대로 쓴다.
  ```typescript
  contextByName, edgeByCode
  ```

### Readability Rules

* `data`, `datas`, `info`, `map` 같은 **범용 단어만으로 끝내지 말 것.**
  ```typescript
  // ❌ Bad
  fabData, contextInfo
  
  // ✅ Good
  fabInitData, fabContext, vehicleState
  ```
* 축약어는 팀 공용만 허용. 애매한 축약 금지.
  ```typescript
  // ✅ Good
  id, cfg, ctx  // 정의돼 있으면
  
  // ❌ Bad
  fc, fbc, ct  // 로컬 약어
  ```

### Singular vs Plural

* **단일 객체:** 단수
  ```typescript
  fabContext, currentVehicle
  ```
* **여러 개 컬렉션:** 복수
  ```typescript
  fabContexts, vehicles
  ```
* Map은 "컬렉션"이므로 보통 복수가 자연스럽다.
  ```typescript
  contextsByFabId  // 권장
  contextByFabId   // 도메인상 단일이 더 자연스럽다면 허용
  ```

### Booleans

* **is/has/can/should**로 시작한다.
  ```typescript
  isRunning, hasPendingOrders, canDispatch, shouldReroute
  ```

### Functions

* **동사로 시작**한다.
  ```typescript
  getContext, createFabContext, updateVehicleState, removeFab
  ```

### Classes / Types / Interfaces

* Class/Interface: PascalCase
  ```typescript
  SimulationEngine, FabContext, FabInitData
  ```
* "InitData/State/Config" 같은 역할 접미사는 적극 사용.
  ```typescript
  VehicleState, MovementConfig, FabInitData
  ```

### Quick Examples (Recommended)

```typescript
// Array
const fabContexts: FabContext[] = [];

// Map (keyed by fabId)
private readonly contextsByFabId = new Map<string, FabContext>();

// Set
private readonly activeFabIds = new Set<string>();

// Record
private readonly contextsByFabIdRecord: Record<string, FabContext> = {};
```

### Anti-Patterns

* ❌ `type FabId = string` (브랜딩 아니면 금지)
* ❌ `fabIdToContextMap` (너무 장황 + 중복 정보)
* ❌ `fabDatas` (의미 없음 + 어색함)
* ❌ `map1`, `list2`, `dataMap` (읽기 불가능)

---

## Re-export 규칙

타입이나 값을 re-export할 때는 반드시 `export...from` 형식을 사용하세요.

```typescript
// Bad
import { Foo } from "./foo";
export { Foo };
export type { Foo };
export default Foo;

// Good
export { Foo } from "./foo";
export type { Foo } from "./foo";
export { Foo as default } from "./foo";
```

## 불필요한 코드 제거

### 빈 constructor 금지

```typescript
// Bad
class Foo {
  constructor() {}
}

// Good
class Foo {
  // constructor 생략
}
```

## 에러 처리

### Object stringification 금지

ErrorEvent나 Error 객체를 문자열로 변환할 때 `String()`을 사용하지 마세요.

```typescript
// Bad
worker.onerror = (error) => {
  callback(String(error)); // '[object Object]' 출력
};

// Good
worker.onerror = (error) => {
  callback(error.message);
};


## sqrt


Prefer `Math.hypot(…)` over `Math.sqrt(…)`.

## readOnly
Member 'dispatchMgr' is never reassigned; mark it as `readonly`.

## Unexpected negated condition
example...
if (idx !== undefined) {
  
}

## using chain
if (command && command.nextEdgeId) {
}
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## Number Formatting

Don't use a zero fraction in the number (e.g., use `1` instead of `1.0`).
