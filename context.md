# Context: Veh 126 vs Veh 193 Lock Contention at Node 442 (N0442)

## 1. Issue Description
- User reported that Vehicle 126 is holding a lock on node 441 (N0442), but Vehicle 193 is physically closer/ahead of it.
- This causes Veh 193 to be blocked while waiting for Veh 126, which is further away.

## 2. Log Analysis (`/tmp/20260411_2207/*.bin`)
- **Veh 126**
  - Exited E0283 at TS 27040 and entered E0284 (length 36.69m).
  - Requested and got GRANT for N0442 (node 441) at TS 28368.
- **Veh 193**
  - Exited E0252 at TS 34848 (entering N0221, which is just before N0442 via E0534).
  - Requested N0442 at TS 34864, but got WAIT because Veh 126 already held it.

## 3. Map & Topology
- **N0442** is a merge node where `E0518` (from N0441) and `E0534` (from N0221) converge.
- **E0284** (where Veh 126 is) goes from N0246 to N0247. From N0247, the path likely continues toward N0442 via N0248 -> N0441 -> E0518.
- Veh 126 requested the lock for N0442 at TS 28368 while it was still far away on E0284.

## 4. Possible Causes & Hypotheses
- **Overly Aggressive Lock Request Checkpoints**: The `REQUEST` checkpoint for N0442 might be placed too far upstream.
  - `lockRequestDistanceFromMergingStr` is 5.1m. E0284 is 36.69m long.
- **Checkpoint Generation Logic**: `src/common/vehicle/logic/checkpoint/builder.ts` traces backward from the merge node. If there is a bug, the `REQUEST` checkpoint could be placed at an incorrect edge or `ratio` (e.g., `ratio=0`).
- **Path Reassignment (AutoMgr)**: If a new path is assigned to Veh 126 while it's moving, it's possible that `buildCheckpoints` was called and immediately triggered a `REQUEST` because the vehicle was already past the calculated checkpoint ratio for the new path. (At TS 28368, both REQ and GRA happened in the same tick).

## 5. Next Steps
- Inspect `src/common/vehicle/logic/checkpoint/builder.ts` to see how `REQUEST` checkpoints are calculated and placed.
- Verify Veh 126's exact position (`ratio`) and path at TS 28368 to see if it makes sense to trigger a checkpoint there.
- Check if Veh 126 had a path recalculation (`AutoMgr.assignToStation`) exactly at TS 28368 that caused the lock to be requested instantly.

