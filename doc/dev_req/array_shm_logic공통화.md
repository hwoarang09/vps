# vehicleArrayMode ↔ shmSimulator Logic Consolidation Analysis

## 🔍 Analysis Result

### ✅ **Conclusion: Consolidation is Possible and Highly Recommended**

The logic in both folders (`vehicleArrayMode` and `shmSimulator`) is **almost identical**, and some consolidation is already in progress.

---

## 📊 Overlapping Files and Logic

### 1️⃣ **Movement Logic**
| File | vehicleArrayMode | shmSimulator | Similarity | Status |
|------|------------------|--------------|------------|--------|
| `movementUpdate.ts` | ✅ | ✅ | **95%** | 🔴 Not Consolidated |
| `speedCalculator.ts` | ✅ | ✅ | **100%** | ✅ **Already Consolidated** (`src/common/vehicle/physics/speedCalculator.ts`) |
| `edgeTransition.ts` | ✅ | ✅ | **98%** | 🔴 Not Consolidated |
| `positionInterpolator.ts` | ✅ | ✅ | **95%** | 🔴 Not Consolidated |

### 2️⃣ **Collision Logic**
| File | vehicleArrayMode | shmSimulator | Similarity | Status |
|------|------------------|--------------|------------|--------|
| `collisionCheck.ts` | ✅ | ✅ | **90%** | 🔴 Not Consolidated |
| `verifyLinearCollision.ts` | ✅ | ✅ | **95%** | 🔴 Not Consolidated |
| `verifyCurveCollision.ts` | ✅ | ✅ | **95%** | 🔴 Not Consolidated |
| `verifyFollowingCollision.ts` | ✅ | ✅ | **95%** | 🔴 Not Consolidated |
| `verifyMergeCollision.ts` | ✅ | ✅ | **95%** | 🔴 Not Consolidated |
| `verifyNextPathCollision.ts` | ✅ | ✅ | **95%** | 🔴 Not Consolidated |
| `collisionCommon.ts` | ✅ | ✅ | **95%** | 🔴 Not Consolidated |

### 3️⃣ **Helpers**
| File | vehicleArrayMode | shmSimulator | Similarity | Status |
|------|------------------|--------------|------------|--------|
| `sensorCollision.ts` | ✅ | ✅ | **98%** | 🔴 Not Consolidated |
| `sensorPoints.ts` | ✅ | ✅ | **90%** | 🔴 Not Consolidated |
| `sensorDebug.ts` | ✅ | ✅ | **95%** | 🔴 Not Consolidated |
| `distanceCalculator.ts` | ✅ | ✅ | **95%** | 🔴 Not Consolidated |
| `edgeTargetFinder.ts` | ✅ | ✅ | **95%** | 🔴 Not Consolidated |
| `statusApplier.ts` | ✅ | ✅ | **95%** | 🔴 Not Consolidated |
| `updateVehicleTransform.ts` | ✅ | ✅ | **95%** | 🔴 Not Consolidated |

### 4️⃣ **Logic Managers**
| File | vehicleArrayMode | shmSimulator | Similarity | Status |
|------|------------------|--------------|------------|--------|
| `LockMgr.ts` | ✅ | ✅ | **99%** | 🔴 Not Consolidated |
| `TransferMgr.ts` | ✅ | ✅ | **95%** | 🔴 Not Consolidated |

---

## 🎯 Consolidation Priority and Recommended Location

### **Priority 1: Immediate Consolidation Required** (100% identical logic)

#### 1. **LockMgr.ts** → `src/common/vehicle/logic/LockMgr.ts`
- **Reason**: Both files are almost identical (99% similar)
- **Differences**: None (types and logic are completely identical)
- **Consolidation Method**: Move as-is

#### 2. **sensorCollision.ts** → `src/common/vehicle/collision/sensorCollision.ts`
- **Reason**: SAT algorithm logic is completely identical (98% similar)
- **Differences**: 
  - arrayMode: Uses global `sensorPointArray`
  - shmSimulator: Passes `SensorPointArray` as parameter
- **Consolidation Method**: Unify to accept as parameter

#### 3. **edgeTransition.ts** → `src/common/vehicle/movement/edgeTransition.ts`
- **Reason**: Edge transition logic is completely identical (98% similar)
- **Differences**: 
  - arrayMode: Uses global `vehicleDataArray`
  - shmSimulator: Passes `VehicleDataArray` as parameter
- **Consolidation Method**: Unify to accept as parameter

#### 4. **positionInterpolator.ts** → `src/common/vehicle/movement/positionInterpolator.ts`
- **Reason**: Position interpolation logic is almost identical (95% similar)
- **Differences**: 
  - arrayMode: Uses `getMarkerConfig().Z`
  - shmSimulator: Uses `defaultZ` parameter
- **Consolidation Method**: Unify with `defaultZ` parameter (shmSimulator already has correct structure)

---

### **Priority 2: Consolidation Recommended** (95% identical logic)

#### 5. **movementUpdate.ts** → `src/common/vehicle/movement/movementUpdate.ts`
- **Reason**: Core movement logic is 95% identical
- **Differences**:
  - arrayMode: Uses global store/config
  - shmSimulator: Passes via Context object (better structure)
- **Consolidation Method**: Adopt shmSimulator's Context pattern

#### 6. **All Collision Logic** → `src/common/vehicle/collision/`
- `collisionCheck.ts`
- `verifyLinearCollision.ts`
- `verifyCurveCollision.ts`
- `verifyFollowingCollision.ts`
- `verifyMergeCollision.ts`
- `verifyNextPathCollision.ts`
- `collisionCommon.ts`

**Consolidation Method**: Use Context pattern (shmSimulator approach)

#### 7. **All Helpers** → `src/common/vehicle/helpers/`
- `distanceCalculator.ts`
- `edgeTargetFinder.ts`
- `sensorDebug.ts`
- `statusApplier.ts`
- `updateVehicleTransform.ts`

---

### **Priority 3: Review Required** (Platform-specific possibilities)

#### 8. **TransferMgr.ts**
- **Differences**: 
  - arrayMode: Tightly coupled with Zustand store
  - shmSimulator: Independent class
- **Consolidation Method**: Interface-based abstraction needed

#### 9. **sensorPoints.ts**
- **Differences**: 
  - arrayMode: Directly modifies global array
  - shmSimulator: Uses SensorPointArray class
- **Consolidation Method**: Interface-based abstraction

---

## 📁 Recommended Common Logic Location

```
src/common/vehicle/
├── collision/              # Collision detection logic
│   ├── collisionCheck.ts
│   ├── sensorCollision.ts
│   ├── verifyLinearCollision.ts
│   ├── verifyCurveCollision.ts
│   ├── verifyFollowingCollision.ts
│   ├── verifyMergeCollision.ts
│   ├── verifyNextPathCollision.ts
│   └── collisionCommon.ts
├── movement/               # Movement logic
│   ├── movementUpdate.ts
│   ├── edgeTransition.ts
│   └── positionInterpolator.ts
├── physics/                # Physics calculations (already exists)
│   └── speedCalculator.ts  ✅
├── logic/                  # Logic managers
│   ├── LockMgr.ts
│   └── TransferMgr.ts
├── helpers/                # Helper functions
│   ├── distanceCalculator.ts
│   ├── edgeTargetFinder.ts
│   ├── sensorDebug.ts
│   ├── sensorPoints.ts
│   ├── statusApplier.ts
│   └── updateVehicleTransform.ts
└── initialize/             # Initialization (already exists)
    ├── initializeVehicles.ts ✅
    ├── types.ts ✅
    └── constants.ts ✅
```

---

## 🎨 Consolidation Strategy

### **Pattern 1: Context Object Pattern** (Adopt shmSimulator approach)

```typescript
// ✅ Good (shmSimulator approach)
export interface MovementContext {
  vehicleDataArray: VehicleDataArray;
  edgeArray: Edge[];
  config: Config;
  // ...
}

export function updateMovement(ctx: MovementContext) {
  // ...
}
```

```typescript
// ❌ Bad (arrayMode approach)
import { vehicleDataArray } from "@/store/...";

export function updateMovement(params: Params) {
  const data = vehicleDataArray.getData(); // Global dependency
}
```

### **Pattern 2: Parameter Injection**
- Pass as parameters instead of global variables
- Improves testability
- Ensures platform independence

---

## 📝 Summary

### ✅ **Files that can be consolidated**: Total **20+ files**

### 🎯 **Immediate Consolidation Recommended**:
1. `LockMgr.ts` - 99% identical, no differences
2. `sensorCollision.ts` - 98% identical, SAT algorithm
3. `edgeTransition.ts` - 98% identical, edge transition logic
4. `positionInterpolator.ts` - 95% identical, position interpolation

### 📍 **Common Logic Location**: `src/common/vehicle/`
- `collision/` - Collision detection logic
- `movement/` - Movement logic
- `logic/` - Manager logic
- `helpers/` - Helper functions

### 🔑 **Key Strategy**:
- **Adopt shmSimulator's Context pattern** (cleaner structure)
- Remove global dependencies
- Interface-based abstraction

---

## 🚀 Implementation Plan

### Phase 1: Core Logic (Priority 1)
1. Move `LockMgr.ts` to `src/common/vehicle/logic/`
2. Move `sensorCollision.ts` to `src/common/vehicle/collision/`
3. Move `edgeTransition.ts` to `src/common/vehicle/movement/`
4. Move `positionInterpolator.ts` to `src/common/vehicle/movement/`

### Phase 2: Movement & Collision (Priority 2)
5. Consolidate `movementUpdate.ts`
6. Consolidate all collision logic files
7. Consolidate all helper files

### Phase 3: Platform Adapters (Priority 3)
8. Create interface-based abstraction for `TransferMgr`
9. Create interface-based abstraction for `sensorPoints`

---

## 📌 Key Differences Between Platforms

### arrayMode
- Uses global singletons (`vehicleDataArray`, `sensorPointArray`, etc.)
- Tightly coupled with Zustand stores
- Uses `getMarkerConfig()` for Z-axis

### shmSimulator
- Uses Context pattern (dependency injection)
- Independent classes with clear interfaces
- Uses configurable `defaultZ` parameter

**Recommendation**: Adopt shmSimulator's approach as it's more testable and maintainable.

---

## ⚠️ Migration Notes

1. **Breaking Changes**: Both `vehicleArrayMode` and `shmSimulator` will need to update their imports
2. **Testing**: Ensure both platforms work correctly after consolidation
3. **Gradual Migration**: Start with Priority 1 files (least risk)
4. **Adapter Pattern**: Use adapters for platform-specific differences

---

## 📚 References

- Existing consolidated code: `src/common/vehicle/physics/speedCalculator.ts`
- Existing consolidated code: `src/common/vehicle/initialize/`
- Pattern to follow: shmSimulator's Context-based approach

