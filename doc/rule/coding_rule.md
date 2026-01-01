# Code Style Rules

이 프로젝트의 정적 분석 규칙입니다. 코드 작성 시 반드시 준수하세요.

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

## using chanin
if (command && command.nextEdgeId) {
}
Prefer using an optional chain expression instead, as it's more concise and easier to read.

```
