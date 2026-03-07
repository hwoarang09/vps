# Session Context

## 현재 진행 중인 작업

### Config 폴더 도메인별 분리 (v0.3.19 완료)

**완료:**
- config 폴더를 `react/`, `threejs/`, `worker/`, `log/`, `mqtt/`로 분리
- 33개 파일의 44개 import 경로 업데이트
- 6개 새 worker config 파일 생성 (하드코딩 값 추출)
- `movementConfig.ts` 삭제 (미사용), `workerConfig` → `log/logConfig` 리네임

**완료 — 하드코딩 값 → config 참조 교체:**
- `LockMgr/index.ts`: `PRELOCK_STOP_DISTANCE` → `lockConfig.prelockStopDistance`
- `OrderMgr.ts`: `MAX_PATH_FINDS_PER_FRAME`, `MAX_ATTEMPTS`, `targetRatio 0.5` → `orderConfig.*`
- `JobBatchMgr.ts`: `MAX_ASSIGNMENTS_PER_FRAME`, load/unload duration → `jobBatchConfig.*`
- `TransferMgr/index.ts`: `MAX_LOOKAHEAD` (2곳) → `transferConfig.maxLookahead`
- `checkpoint-processor.ts`: `MAX_CATCHUP` → `checkpointConfig.maxCatchupPerFrame`
- `checkpoint/builder.ts`: `DEFAULT_OPTIONS`, `DEFAULT_WAITING_OFFSET` → `checkpointConfig.*`
- `Dijkstra.ts`: `PATH_CACHE_MAX_SIZE` → `pathfindingConfig.cacheMaxSize`

### 메뉴 스타일 개선 (v0.3.17~18 완료)
- active 버튼: radial-gradient 배경 (가운데 약간 어둡고 가장자리 밝은 파란색)
- 테두리: 3px, 밝은 neon (`rgba(150,220,255,1.0)`)
- inset glow: `inset 0 0 6px 1px rgba(160,220,255,0.4)`
- 아이콘 교체: Vehicle (SVG), LayoutBuilder (menu-cut.png), Performance (icon-gauge.svg)

### InstancedText static 모드 (v0.3.19 완료)
- `isStatic` prop 추가 — 1프레임 렌더 후 useFrame 스킵
- bay label에 적용
- `BaseInstancedText`: count=0인 메쉬 `visible=false`로 draw call 제거
- `textConfig.ts`: node/edge/station/vehicle/bay visibility 제어
