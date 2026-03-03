# Sonar Report

총 이슈: **35개**

## 분류 요약

| 카테고리 | 규칙 그룹 | 이슈 수 |
|:---:|:---|:---:|
| **A** | Dead Code & Unused Items | 31 |
| **C** | Module & Exports | 3 |
| **F** | Function Structure | 1 |

## 상세 이슈

### [A] Dead Code & Unused Items

| # | 심각도 | Rule | 파일:줄 | 설명 |
|:---:|:---:|:---|:---|:---|
| 1 | 🟡 Medium | A-1 Useless Assignment | `common/vehicle/initialize/initializeVehicles.ts:L246` | Remove this useless assignment to variable "lockMgr". |
| 2 | 🔵 Low | A-2 Unused Import | `common/vehicle/logic/LockMgr/checkpoint-loader.ts:L12` | Remove this unused import of 'devLog'. |
| 3 | 🟡 Medium | A-1 Useless Assignment | `common/vehicle/logic/LockMgr/checkpoint-loader.ts:L40` | Remove this useless assignment to variable "currentEdge". |
| 4 | 🟡 Medium | A-1 Useless Assignment | `common/vehicle/logic/LockMgr/checkpoint-loader.ts:L41` | Remove this useless assignment to variable "currentRatio". |
| 5 | 🟡 Medium | A-1 Useless Assignment | `common/vehicle/logic/LockMgr/checkpoint-loader.ts:L42` | Remove this useless assignment to variable "head". |
| 6 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/checkpoint-loader.ts:L44` | Remove this commented out code. |
| 7 | 🟡 Medium | A-1 Useless Assignment | `common/vehicle/logic/LockMgr/checkpoint-loader.ts:L83` | Remove this useless assignment to variable "head". |
| 8 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/checkpoint-loader.ts:L89` | Remove this commented out code. |
| 9 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/checkpoint-loader.ts:L96` | Remove this commented out code. |
| 10 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/checkpoint-loader.ts:L105` | Remove this commented out code. |
| 11 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/checkpoint-loader.ts:L167` | Remove this commented out code. |
| 12 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/checkpoint-loader.ts:L193` | Remove this commented out code. |
| 13 | 🔵 Low | A-2 Unused Import | `common/vehicle/logic/LockMgr/checkpoint-processor.ts:L7` | Remove this unused import of 'MovementData'. |
| 14 | 🔵 Low | A-2 Unused Import | `common/vehicle/logic/LockMgr/checkpoint-processor.ts:L10` | Remove this unused import of 'devLog'. |
| 15 | 🔵 Low | A-2 Unused Import | `common/vehicle/logic/LockMgr/checkpoint-processor.ts:L11` | Remove this unused import of 'getFbLog'. |
| 16 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/checkpoint-processor.ts:L90` | Remove this commented out code. |
| 17 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/checkpoint-processor.ts:L96` | Remove this commented out code. |
| 18 | 🔵 Low | A-2 Unused Import | `common/vehicle/logic/LockMgr/deadlock-zone.ts:L8` | Remove this unused import of 'devLog'. |
| 19 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/deadlock-zone.ts:L44` | Remove this commented out code. |
| 20 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/deadlock-zone.ts:L53` | Remove this commented out code. |
| 21 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/index.ts:L117` | Remove this commented out code. |
| 22 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/index.ts:L123` | Remove this commented out code. |
| 23 | 🔵 Low | A-2 Unused Import | `common/vehicle/logic/LockMgr/lock-handlers.ts:L15` | Remove this unused import of 'devLog'. |
| 24 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/lock-handlers.ts:L83` | Remove this commented out code. |
| 25 | 🟡 Medium | A-1 Useless Assignment | `common/vehicle/logic/LockMgr/lock-handlers.ts:L116` | Remove this useless assignment to variable "velocity". |
| 26 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/lock-handlers.ts:L176` | Remove this commented out code. |
| 27 | 🟡 Medium | A-5 Unused Collection | `common/vehicle/logic/LockMgr/lock-handlers.ts:L207` | Either use this collection's contents or remove the collection. |
| 28 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/lock-handlers.ts:L239` | Remove this commented out code. |
| 29 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/lock-handlers.ts:L267` | Remove this commented out code. |
| 30 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/lock-handlers.ts:L373` | Remove this commented out code. |
| 31 | 🟡 Medium | A-4 Commented-out Code | `common/vehicle/logic/LockMgr/lock-handlers.ts:L379` | Remove this commented out code. |

### [C] Module & Exports

| # | 심각도 | Rule | 파일:줄 | 설명 |
|:---:|:---:|:---|:---|:---|
| 1 | 🔵 Low | C-2 Duplicate Import | `shmSimulator/core/FabContext/initialization.ts:L8` | '@/logger' imported multiple times. |
| 2 | 🔵 Low | C-2 Duplicate Import | `shmSimulator/core/FabContext/initialization.ts:L21` | '@/logger' imported multiple times. |
| 3 | 🔵 Low | C-1 Re-export Syntax | `store/vehicle/vehicleGeneralStore.ts:L4` | Use `export…from` to re-export `JobState`. |

### [F] Function Structure

| # | 심각도 | Rule | 파일:줄 | 설명 |
|:---:|:---:|:---|:---|:---|
| 1 | 🔴 High | F-1 Cognitive Complexity | `common/vehicle/logic/LockMgr/index.ts:L164` | Refactor this function to reduce its Cognitive Complexity from 25 to the 15 allowed. |
