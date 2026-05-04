#!/usr/bin/env python3
"""
VPS 로그 통합 분석 스크립트
세션의 모든 .bin 로그를 병합하여 차량 타임라인, job state 이력, 이상 감지

사용법:
  python analyze.py logs/SESSION_ID/                      # 세션 요약
  python analyze.py logs/SESSION_ID/ --veh 13             # 차량 타임라인
  python analyze.py logs/SESSION_ID/ --veh 13 --from 60000 --to 90000
  python analyze.py logs/SESSION_ID/ --stuck              # 멈춘 차량 탐지
  python analyze.py logs/SESSION_ID/ --transfers          # 반송 현황 요약
  python analyze.py logs/SESSION_ID/ --veh 13 --raw       # 원시 레코드 출력
  python analyze.py logs/SESSION_ID/ --deadlock --pair 41 108 --node 260  # deadlock 분석
"""

import argparse
import struct
import sys
from typing import Optional
from pathlib import Path
from collections import defaultdict

# ==============================================================================
# 프로토콜 (protocol.ts 동기화)
# ==============================================================================

EVENT_TYPES = {
    1:  ('ML_ORDER_COMPLETE', 44, '<III8I',    ['order_id','veh_id','dest_edge','move_to_pickup_ts','pickup_arrive_ts','pickup_start_ts','pickup_done_ts','move_to_drop_ts','drop_arrive_ts','drop_start_ts','drop_done_ts']),
    3:  ('ML_EDGE_TRANSIT',   24, '<IIIIIf',   ['ts','veh_id','edge_id','enter_ts','exit_ts','edge_len']),
    4:  ('ML_LOCK',           16, '<IIHBBI',   ['ts','veh_id','node_idx','event_type','holder_hint','wait_ms']),
    5:  ('ML_REPLAY_SNAPSHOT',36, '<IIfffIffI',['ts','veh_id','x','y','z','edge_idx','ratio','speed','status']),
    10: ('DEV_VEH_STATE',     44, '<II9f',     ['ts','veh_id','x','y','z','edge','ratio','speed','moving_status','traffic_state','job_state']),
    11: ('DEV_PATH',          16, '<IIII',     ['ts','veh_id','dest_edge','path_len']),
    12: ('DEV_LOCK_DETAIL',   20, '<IIHBxII',  ['ts','veh_id','node_idx','type','holder_veh_id','wait_ms']),
    13: ('DEV_TRANSFER',      16, '<IIII',     ['ts','veh_id','from_edge','to_edge']),
    14: ('DEV_EDGE_QUEUE',    16, '<IIIHBx',   ['ts','edge_id','veh_id','count','type']),
    15: ('DEV_CHECKPOINT',    24, '<IIHBBfIf', ['ts','veh_id','cp_edge','cp_flags','action','cp_ratio','current_edge','current_ratio']),
}

FILE_SUFFIX_MAP = {
    'order':        1,
    'edge_transit': 3,
    'lock':         4,
    'replay':       5,
    'veh_state':    10,
    'path':         11,
    'lock_detail':  12,
    'transfer':     13,
    'edge_queue':   14,
    'checkpoint':   15,
}

JOB_STATE_NAMES = {0:'INIT', 1:'IDLE', 2:'MOVE_TO_LOAD', 3:'LOADING', 4:'MOVE_TO_UNLOAD', 5:'UNLOADING'}
LOCK_EVENT_NAMES = {0:'REQ', 1:'GRANT', 2:'RELEASE', 3:'WAIT'}
CHECKPOINT_ACTION_NAMES = {0:'LOADED', 1:'HIT', 2:'MISS', 3:'WAITING', 4:'WAIT_BLOCKED'}
CHECKPOINT_FLAG_NAMES = {1:'REQ', 2:'WAIT', 4:'REL', 8:'PREP', 16:'SLOW'}

# DEV_LOCK_DETAIL type — 의심 메커니즘 추적용 (LockMgr/types.ts 의 LockDetailType 동기화)
LOCK_DETAIL_NAMES = {
    10: 'ZONE_PREEMPT',     # grantNextInQueue 가 queue[0] 가 아닌 차량 grant
    11: 'DZ_GATE_AUTO_REQ', # updateDeadlockZoneGates 가 cp 우회 자동 REQ
    12: 'DZ_GATE_AUTO_GRANT', # auto-REQ 직후 holder 없어 즉시 grant
    13: 'DZ_GATE_BLOCK',    # auto-REQ 후 grant 못 받아 강제 정지
    20: 'PRIORITY_INSERT',  # path 변경 시 거리 기반 큐 insert (FIFO 위반 가능)
    21: 'HOLDER_SWAP',      # path 변경 시 현재 holder 박탈
    22: 'PRIORITY_GRANT',   # path 변경 시 holder 없어 즉시 grant
    30: 'PRELOCK_REGISTER', # preLockMergeNodes 가 차량을 큐에 push (silent)
    31: 'PRELOCK_HOLDER',   # preLockMergeNodes 결과 holder 됨
    32: 'PRELOCK_STOP',     # stopNonHolderVehiclesNearMerge 가 차량 LOCKED 정지
    40: 'DEADLOCK_SWAP',    # DZ holder stuck 감지 → ready queued 로 강제 holder 이전
    90: 'FLUSH_MARKER',     # 버퍼링된 preLock 이벤트 flush 시작 (extra=count)
}


def parse_file(path: Path) -> tuple[str, list[dict]]:
    """파일 하나 파싱. (suffix, records) 반환"""
    stem = path.stem
    suffix = None
    etype = None
    for suf, et in FILE_SUFFIX_MAP.items():
        if stem.endswith(f'_{suf}'):
            suffix = suf
            etype = et
            break
    if etype is None:
        return (stem, [])

    _, rec_size, fmt, columns = EVENT_TYPES[etype]
    raw = path.read_bytes()
    n = len(raw) // rec_size
    records = []
    for i in range(n):
        vals = struct.unpack_from(fmt, raw, i * rec_size)
        records.append(dict(zip(columns, vals)))
    return (suffix, records)


SNAPSHOT_MAGIC = 0xCAFE


def parse_snapshot_file(path: Path) -> list[dict]:
    """snapshot.bin (가변 블록) 파싱. SnapshotLogger.ts 형식 참고.
    Returns: [{ts, vehicles: [{vehId, currentEdge, ratio, velocity, stopReason}], activeEdges: [{edgeId, vehIds}]}]
    """
    raw = path.read_bytes()
    blocks = []
    off = 0
    total = len(raw)
    while off + 8 <= total:
        magic = struct.unpack_from('<H', raw, off)[0]
        if magic != SNAPSHOT_MAGIC:
            nxt = raw.find(struct.pack('<H', SNAPSHOT_MAGIC), off + 1)
            if nxt < 0:
                break
            off = nxt
            continue
        try:
            ts = struct.unpack_from('<I', raw, off + 2)[0]
            num_v = struct.unpack_from('<H', raw, off + 6)[0]
            cur = off + 8
            vehicles = []
            for _ in range(num_v):
                if cur + 14 > total: break
                vid, edge = struct.unpack_from('<HH', raw, cur)
                ratio, vel = struct.unpack_from('<ff', raw, cur + 4)
                stop = struct.unpack_from('<H', raw, cur + 12)[0]
                vehicles.append({'vehId': vid, 'currentEdge': edge, 'ratio': ratio, 'velocity': vel, 'stopReason': stop})
                cur += 14
            if cur + 2 > total: break
            num_e = struct.unpack_from('<H', raw, cur)[0]
            cur += 2
            edges = []
            for _ in range(num_e):
                if cur + 4 > total: break
                eid, cnt = struct.unpack_from('<HH', raw, cur)
                cur += 4
                if cur + 2 * cnt > total: break
                vids = list(struct.unpack_from(f'<{cnt}H', raw, cur))
                cur += 2 * cnt
                edges.append({'edgeId': eid, 'vehIds': vids})
            blocks.append({'ts': ts, 'vehicles': vehicles, 'activeEdges': edges})
            off = cur
        except struct.error:
            break
    return blocks


def load_session(session_dir: Path) -> dict[str, list[dict]]:
    """세션 디렉토리의 모든 .bin 파일 로드. {suffix: [records]} 반환.
    'snapshot' suffix 는 fixed-size 가 아니라 가변 블록 — 별도 처리.
    """
    result = {}
    for f in sorted(session_dir.glob('*.bin')):
        if f.stem.endswith('_snapshot'):
            blocks = parse_snapshot_file(f)
            if blocks:
                result['snapshot'] = blocks
                print(f"  loaded {f.name}: {len(blocks):,} frames")
            continue
        suffix, records = parse_file(f)
        if records:
            result[suffix] = records
            print(f"  loaded {f.name}: {len(records):,} records")
    return result


def find_veh_at_ts(snapshots: list[dict], veh_id: int, ts: int) -> dict | None:
    """주어진 ts에 가장 가까운 snapshot frame 에서 veh_id 의 상태 반환"""
    if not snapshots:
        return None
    # 이진 탐색으로 가장 가까운 frame
    lo, hi = 0, len(snapshots) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if snapshots[mid]['ts'] <= ts:
            lo = mid
        else:
            hi = mid - 1
    frame = snapshots[lo]
    for v in frame['vehicles']:
        if v['vehId'] == veh_id:
            return {'frame_ts': frame['ts'], **v}
    return None


def fmt_ts(ms: int) -> str:
    s = ms // 1000
    rem = ms % 1000
    m, sec = divmod(s, 60)
    return f"{m:02d}:{sec:02d}.{rem:03d}"


def fmt_ms(ms: int) -> str:
    if ms < 1000:
        return f"{ms}ms"
    return f"{ms/1000:.1f}s"


# ==============================================================================
# 분석 기능
# ==============================================================================

def cmd_summary(data: dict):
    """세션 전체 요약"""
    print("\n=== Session Summary ===")
    for suffix, records in sorted(data.items()):
        if not records:
            continue
        ts_list = [r['ts'] for r in records if 'ts' in r]
        veh_ids = set(r['veh_id'] for r in records if 'veh_id' in r)
        t_range = f"{fmt_ts(min(ts_list))} ~ {fmt_ts(max(ts_list))}" if ts_list else "?"
        print(f"  {suffix:<15} {len(records):>8,} records  vehs={len(veh_ids):>4}  time={t_range}")


def cmd_vehicle_timeline(data: dict, veh_id: int, ts_from: int, ts_to: int):
    """차량 타임라인: edge 이동 + path 할당 + job state + lock 병합"""
    events = []  # (ts, kind, data)

    # Edge transit
    for r in data.get('edge_transit', []):
        if r['veh_id'] != veh_id: continue
        if not (ts_from <= r['ts'] <= ts_to): continue
        events.append((r['ts'], 'EDGE', r))

    # Path 할당
    for r in data.get('path', []):
        if r['veh_id'] != veh_id: continue
        if not (ts_from <= r['ts'] <= ts_to): continue
        events.append((r['ts'], 'PATH', r))

    # Replay snapshot (job state 추적용)
    last_job = -1
    for r in data.get('replay', []):
        if r['veh_id'] != veh_id: continue
        if not (ts_from <= r['ts'] <= ts_to): continue
        jstate = r.get('status', -1)  # status field in replay = job state? check field
        # replay snapshot: ts veh_id x y z edge_idx ratio speed status
        events.append((r['ts'], 'SNAP', r))

    # DEV_TRANSFER
    for r in data.get('transfer', []):
        if r['veh_id'] != veh_id: continue
        if not (ts_from <= r['ts'] <= ts_to): continue
        events.append((r['ts'], 'XFER', r))

    # Lock (REQ/WAIT/GRANT/RELEASE)
    for r in data.get('lock', []):
        if r['veh_id'] != veh_id: continue
        if not (ts_from <= r['ts'] <= ts_to): continue
        events.append((r['ts'], 'LOCK', r))

    # Checkpoint events
    for r in data.get('checkpoint', []):
        if r['veh_id'] != veh_id: continue
        if not (ts_from <= r['ts'] <= ts_to): continue
        events.append((r['ts'], 'CP', r))

    if not events:
        print(f"  No events for veh {veh_id} in [{fmt_ts(ts_from)} ~ {fmt_ts(ts_to)}]")
        return

    events.sort(key=lambda x: x[0])

    print(f"\n=== Vehicle {veh_id} Timeline ===")
    print(f"  Events: {len(events)}\n")

    cur_job = -1
    for ts, kind, r in events:
        prefix = f"  [{fmt_ts(ts)}]"

        if kind == 'EDGE':
            dur = r['exit_ts'] - r['enter_ts']
            print(f"{prefix} EDGE_TRANSIT  edge={r['edge_id']:>4}  dur={fmt_ms(dur):>8}  len={r['edge_len']:>5.1f}m")

        elif kind == 'PATH':
            print(f"{prefix} PATH_ASSIGNED dest_edge={r['dest_edge']:>4}  path_len={r['path_len']}")

        elif kind == 'SNAP':
            job = r.get('status', -1)
            if job != cur_job:
                jname = JOB_STATE_NAMES.get(job, str(job))
                print(f"{prefix} JOB_STATE     → {jname} ({job})  edge={r.get('edge_idx','?')}  ratio={r.get('ratio',0):.3f}  spd={r.get('speed',0):.1f}")
                cur_job = job

        elif kind == 'XFER':
            print(f"{prefix} EDGE_CHANGE   {r['from_edge']:>4} → {r['to_edge']:>4}")

        elif kind == 'LOCK':
            ename = LOCK_EVENT_NAMES.get(r['event_type'], str(r['event_type']))
            wait = f"  wait={fmt_ms(r['wait_ms'])}" if r.get('wait_ms', 0) > 0 else ""
            holder = ""
            if r['event_type'] == 3:  # WAIT
                hh = r.get('holder_hint', 255)
                holder = f"  holder=veh{hh}" if hh < 255 else "  holder=?"
            if r['event_type'] in (1, 3):  # GRANT, WAIT만 출력 (너무 많으면 노이즈)
                print(f"{prefix} LOCK_{ename:<7}  node={r['node_idx']:>4}{wait}{holder}")

        elif kind == 'CP':
            aname = CHECKPOINT_ACTION_NAMES.get(r['action'], str(r['action']))
            flags = []
            for bit, name in CHECKPOINT_FLAG_NAMES.items():
                if r['cp_flags'] & bit:
                    flags.append(name)
            fstr = '|'.join(flags) if flags else 'NONE'
            print(f"{prefix} CP_{aname:<12} cpEdge={r['cp_edge']:>4}@{r['cp_ratio']:.3f} [{fstr}]  curEdge={r['current_edge']:>4}@{r['current_ratio']:.3f}")

    # 마지막 edge 확인 - stuck 여부
    edge_transits = [(r['ts'], r['edge_id']) for ts, kind, r in events if kind == 'EDGE']
    if edge_transits:
        last_ts, last_edge = edge_transits[-1]
        all_ts = [ts for ts, _, _ in events]
        max_ts = max(all_ts)
        silent = max_ts - last_ts
        if silent > 5000:
            print(f"\n  ⚠️  STUCK? 마지막 edge_transit: edge={last_edge} at {fmt_ts(last_ts)}")
            print(f"        이후 {fmt_ms(silent)} 동안 edge 전환 없음 (현재 edge={last_edge}에 머무는 중)")


def cmd_stuck(data: dict, threshold_ms: int = 10000):
    """장시간 같은 edge에 머문 차량 탐지"""
    print(f"\n=== Stuck Vehicles (threshold: {fmt_ms(threshold_ms)}) ===")

    edge_transits = data.get('edge_transit', [])
    if not edge_transits:
        print("  edge_transit 로그 없음")
        return

    # veh별 마지막 edge transit
    last_transit = {}  # veh_id → (ts, edge_id)
    for r in edge_transits:
        v = r['veh_id']
        if v not in last_transit or r['ts'] > last_transit[v][0]:
            last_transit[v] = (r['ts'], r['edge_id'])

    global_max_ts = max(r['ts'] for r in edge_transits)

    stuck = []
    for veh_id, (ts, edge_id) in last_transit.items():
        silent = global_max_ts - ts
        if silent >= threshold_ms:
            stuck.append((silent, veh_id, ts, edge_id))

    stuck.sort(reverse=True)
    if not stuck:
        print("  발견 없음")
        return

    print(f"  {'veh':>5} {'last_edge':>10} {'last_ts':>12} {'silent':>10}")
    for silent, veh_id, ts, edge_id in stuck:
        print(f"  {veh_id:>5} {edge_id:>10} {fmt_ts(ts):>12} {fmt_ms(silent):>10}")


def cmd_transfers(data: dict):
    """반송 중인 차량 현황 및 완료 이력"""
    print("\n=== Transfer Summary ===")

    paths = data.get('path', [])
    edge_transits = data.get('edge_transit', [])
    replay = data.get('replay', [])

    if not replay:
        print("  replay 로그 없음 (job_state 추적 불가)")
    if not paths:
        print("  path 로그 없음 (DEV_PATH 활성화 필요)")

    # replay에서 job_state 변화 추적
    if replay:
        # veh별 job_state 이력
        job_history = defaultdict(list)  # veh_id → [(ts, job_state)]
        for r in sorted(replay, key=lambda x: x['ts']):
            v = r['veh_id']
            js = r.get('status', -1)
            if not job_history[v] or job_history[v][-1][1] != js:
                job_history[v].append((r['ts'], js))

        print(f"\n  Job State 변화 (최종 상태 기준):")
        print(f"  {'veh':>5}  {'현재 state':>16}  {'변화 횟수':>8}  {'history (최근 3)':}")
        for veh_id in sorted(job_history.keys()):
            hist = job_history[veh_id]
            last_js = hist[-1][1]
            last_name = JOB_STATE_NAMES.get(last_js, str(last_js))
            recent = hist[-3:]
            hist_str = ' → '.join(f"{JOB_STATE_NAMES.get(js,'?')}@{fmt_ts(ts)}" for ts, js in recent)
            if last_js in (2, 3, 4, 5):  # 비 IDLE만 표시
                print(f"  {veh_id:>5}  {last_name:>16}  {len(hist):>8}  {hist_str}")

    # path 할당 통계
    if paths:
        path_by_veh = defaultdict(list)
        for r in paths:
            path_by_veh[r['veh_id']].append(r)

        print(f"\n  Path 할당 통계 ({len(paths)} total):")
        dest_count = defaultdict(int)
        for r in paths:
            dest_count[r['dest_edge']] += 1
        top_dests = sorted(dest_count.items(), key=lambda x: -x[1])[:10]
        print(f"  Top 목적지 edges: {top_dests}")


def cmd_deadlock(data: dict, veh_ids: list[int], node_id: int | None = None):
    """두 차량의 deadlock 분석: lock 이력, edge 경로, 미해제 lock, 접점 노드"""
    locks = data.get('lock', [])
    edges = data.get('edge_transit', [])
    transfers = data.get('transfer', [])
    paths = data.get('path', [])

    if not locks and not edges:
        print("  lock/edge_transit 로그 없음")
        return

    for vid in veh_ids:
        # ── 1. 전체 edge 경로 ──
        veh_edges = sorted([r for r in edges if r['veh_id'] == vid], key=lambda x: x['ts'])
        veh_locks = sorted([r for r in locks if r['veh_id'] == vid], key=lambda x: x['ts'])
        veh_paths = sorted([r for r in paths if r['veh_id'] == vid], key=lambda x: x['ts'])
        veh_xfers = sorted([r for r in transfers if r['veh_id'] == vid], key=lambda x: x['ts'])

        print(f"\n{'='*80}")
        print(f"  VEHICLE {vid}")
        print(f"{'='*80}")

        # 경로 할당 이력
        if veh_paths:
            print(f"\n  [경로 할당] ({len(veh_paths)}건)")
            for r in veh_paths:
                print(f"    {fmt_ts(r['ts'])}  dest_edge={r['dest_edge']:>4}  path_len={r['path_len']}")

        # Edge 경로 (마지막 30건 + 전체 edge 목록 요약)
        EDGE_TAIL = 30
        print(f"\n  [Edge 경로] ({len(veh_edges)}건, 마지막 {min(EDGE_TAIL, len(veh_edges))}건 표시)")
        if len(veh_edges) > EDGE_TAIL:
            print(f"    ... ({len(veh_edges) - EDGE_TAIL}건 생략)")
        for r in veh_edges[-EDGE_TAIL:]:
            dur = r['exit_ts'] - r['enter_ts']
            print(f"    {fmt_ts(r['ts'])}  edge={r['edge_id']:>4}  dur={fmt_ms(dur):>8}  len={r['edge_len']:>5.1f}m")
        # 전체 edge 목록 한 줄 요약
        all_edge_ids = [r['edge_id'] for r in veh_edges]
        print(f"  [전체 edge 순서] {' → '.join(str(e) for e in all_edge_ids)}")

        # 마지막 위치
        if veh_xfers:
            last = veh_xfers[-1]
            print(f"\n  [마지막 transfer] {fmt_ts(last['ts'])}  edge {last['from_edge']} → {last['to_edge']}")
        if veh_edges:
            last = veh_edges[-1]
            print(f"  [마지막 edge exit] {fmt_ts(last['exit_ts'])}  edge={last['edge_id']}")

        # Lock 이벤트 (전체)
        print(f"\n  [Lock 이벤트] ({len(veh_locks)}건)")
        for r in veh_locks:
            ename = LOCK_EVENT_NAMES.get(r['event_type'], str(r['event_type']))
            mark = ''
            if node_id is not None and r['node_idx'] == node_id:
                mark = f'  ◀◀◀ TARGET NODE {node_id}'
            holder = ''
            if r['event_type'] == 3:  # WAIT
                hh = r.get('holder_hint', 255)
                holder = f'  holder=veh{hh}' if hh < 255 else '  holder=?'
            print(f"    {fmt_ts(r['ts'])}  LOCK_{ename:<7}  node={r['node_idx']:>4}{holder}{mark}")

        # 미해제 lock 감지
        node_state: dict[int, tuple[int, int]] = {}  # node → (last_ts, last_event)
        for r in veh_locks:
            node_state[r['node_idx']] = (r['ts'], r['event_type'])
        unreleased = [(n, ts, et) for n, (ts, et) in node_state.items() if et != 2]
        if unreleased:
            print(f"\n  [미해제 Lock]")
            for n, ts, et in sorted(unreleased, key=lambda x: x[1]):
                ename = LOCK_EVENT_NAMES.get(et, str(et))
                print(f"    node={n:>4}  상태={ename}  at {fmt_ts(ts)}")
        else:
            print(f"\n  [미해제 Lock] 없음 (전부 정상 해제)")

    # ── 공통 노드 분석 ──
    if len(veh_ids) >= 2:
        v1, v2 = veh_ids[0], veh_ids[1]
        nodes_v1 = set(r['node_idx'] for r in locks if r['veh_id'] == v1)
        nodes_v2 = set(r['node_idx'] for r in locks if r['veh_id'] == v2)
        common = sorted(nodes_v1 & nodes_v2)
        print(f"\n{'='*80}")
        print(f"  공통 Lock 노드 (veh {v1} ∩ veh {v2}): {common}")

        # 타겟 노드 lock 시간순 비교
        target = node_id if node_id is not None else (common[0] if common else None)
        if target is not None:
            print(f"\n  [Node {target} Lock 시간순 (veh {v1} & {v2})]")
            node_events = sorted(
                [r for r in locks if r['node_idx'] == target and r['veh_id'] in veh_ids],
                key=lambda x: x['ts']
            )
            for r in node_events:
                ename = LOCK_EVENT_NAMES.get(r['event_type'], str(r['event_type']))
                print(f"    {fmt_ts(r['ts'])}  veh={r['veh_id']:>3}  LOCK_{ename}")

        # 공통 edge 분석
        edges_v1 = set(r['edge_id'] for r in edges if r['veh_id'] == v1)
        edges_v2 = set(r['edge_id'] for r in edges if r['veh_id'] == v2)
        common_edges = sorted(edges_v1 & edges_v2)
        print(f"\n  공통 Edge (veh {v1} ∩ veh {v2}): {len(common_edges)}개")
        if common_edges:
            print(f"    {common_edges}")


def cmd_lock_node(data: dict, node_idx: int, ts_from: int, ts_to: int):
    """특정 노드의 lock activity 통합 분석:
       - 시간순 모든 lock event (REQ/WAIT/GRANT/RELEASE)
       - 차량별 사이클 요약
       - 각 이벤트 시점의 차량 위치 (snapshot 가장 가까운 frame)
       - holder timeline + 잔존 holder 식별
    """
    ETYPE = {0: 'REQ', 1: 'GRANT', 2: 'RELEASE', 3: 'WAIT'}

    locks = [r for r in data.get('lock', [])
             if r['node_idx'] == node_idx and ts_from <= r['ts'] <= ts_to]
    if not locks:
        print(f"  node_idx={node_idx} 에 대한 lock event 없음 (in [{fmt_ts(ts_from)} ~ {fmt_ts(ts_to)}])")
        return
    locks.sort(key=lambda r: r['ts'])
    snapshots = data.get('snapshot', [])

    print(f"\n=== node_idx={node_idx} lock activity ({len(locks)} events) ===")
    print(f"{'ts':>10}  {'veh':>4}  {'event':<8}  {'holder':>6}  {'wait_ms':>7}  {'pos at ts':<48}")
    print('-' * 100)

    holder = None  # 현재 holder veh_id
    holder_since = None
    holder_history = []  # (start_ts, end_ts, veh_id)
    by_veh = {}  # veh_id -> list of events

    for r in locks:
        et = ETYPE.get(r['event_type'], str(r['event_type']))
        holder_hint = r['holder_hint'] if r['holder_hint'] != 255 else '-'

        # 위치
        snap = find_veh_at_ts(snapshots, r['veh_id'], r['ts'])
        if snap:
            pos = f"edge={snap['currentEdge']:>4} ratio={snap['ratio']:.3f} vel={snap['velocity']:.2f} stop={snap['stopReason']}"
        else:
            pos = '(no snapshot)'

        print(f"{r['ts']:>10}  {r['veh_id']:>4}  {et:<8}  {str(holder_hint):>6}  {r['wait_ms']:>7}  {pos}")

        # holder 추적
        if r['event_type'] == 1:  # GRANT
            if holder is not None and holder != r['veh_id']:
                holder_history.append((holder_since, r['ts'], holder))
            holder = r['veh_id']
            holder_since = r['ts']
        elif r['event_type'] == 2:  # RELEASE
            if holder == r['veh_id']:
                holder_history.append((holder_since, r['ts'], holder))
                holder = None
                holder_since = None

        by_veh.setdefault(r['veh_id'], []).append(r)

    # 차량별 사이클 요약
    print(f"\n=== 차량별 사이클 ===")
    for vid in sorted(by_veh.keys()):
        evs = by_veh[vid]
        counts = {}
        for r in evs:
            et = ETYPE.get(r['event_type'], '?')
            counts[et] = counts.get(et, 0) + 1
        seq = ' '.join(ETYPE.get(r['event_type'], '?') for r in evs)
        print(f"  veh={vid:>3}  {dict(sorted(counts.items()))}  sequence: {seq}")

    # holder timeline
    print(f"\n=== holder timeline ===")
    for start, end, vid in holder_history:
        dur = end - start
        print(f"  veh={vid:>3}  ts={start:>6} ~ {end:>6}  ({fmt_ms(dur)})")
    if holder is not None:
        last_ts = locks[-1]['ts']
        # 시뮬 끝까지 hold
        all_lock_max = max((r['ts'] for r in data.get('lock', [])), default=last_ts)
        dur = all_lock_max - holder_since
        print(f"  veh={holder:>3}  ts={holder_since:>6} ~ END    ({fmt_ms(dur)})  ❗ 잔존 holder")


def cmd_lock_detail(data: dict, ts_from: int, ts_to: int,
                    veh_filter: Optional[int] = None,
                    node_filter: Optional[int] = None,
                    type_filter: Optional[str] = None):
    """DEV_LOCK_DETAIL 분석 — 의심 메커니즘 발화 추적.

    필터:
      veh_filter   : 특정 차량만
      node_filter  : 특정 노드만
      type_filter  : 'ZONE_PREEMPT' / 'DZ_GATE_*' / 'HOLDER_SWAP' 등 부분 일치
    """
    details = data.get('lock_detail', [])
    if not details:
        print("  lock_detail event 0 (DEV_LOCK_DETAIL 미활성화 또는 발화 없음)")
        return

    # 필터 적용
    filtered = []
    for r in details:
        if not (ts_from <= r['ts'] <= ts_to):
            continue
        if veh_filter is not None and r['veh_id'] != veh_filter:
            continue
        if node_filter is not None and r['node_idx'] != node_filter:
            continue
        type_name = LOCK_DETAIL_NAMES.get(r['type'], f'?{r["type"]}')
        if type_filter and type_filter not in type_name:
            continue
        filtered.append((r, type_name))

    if not filtered:
        print(f"  필터 통과 event 0 (전체 {len(details)} 중)")
        return

    # FLUSH_MARKER 검출 (preLock 버퍼 flush 시점)
    flush_markers = [r for r in details if r['type'] == 90]
    if flush_markers:
        print(f"\n=== preLock buffer flush 정보 ({len(flush_markers)} 개 marker) ===")
        for r in flush_markers:
            print(f"  ts={r['ts']:>6}  flushed {r['wait_ms']} preLock 이벤트 (callback 설정 시점)")

    # 시간순 출력
    filtered.sort(key=lambda x: x[0]['ts'])
    print(f"\n=== DEV_LOCK_DETAIL ({len(filtered)} events) ===")
    print(f"{'ts':>10}  {'veh':>4}  {'node':>4}  {'type':<20}  {'holder':>6}  {'extra':>6}")
    print('-' * 80)
    for r, name in filtered:
        holder = r['holder_veh_id'] if r['holder_veh_id'] != 0xFFFFFFFF and r['holder_veh_id'] >= 0 else '-'
        # holder_veh_id 가 -1 (uint32 = 0xFFFFFFFF) 이면 - 표시
        holder_raw = r['holder_veh_id']
        if holder_raw == 0xFFFFFFFF:
            holder = '-'
        else:
            holder = str(holder_raw)
        print(f"{r['ts']:>10}  {r['veh_id']:>4}  {r['node_idx']:>4}  {name:<20}  {holder:>6}  {r['wait_ms']:>6}")

    # type 별 요약
    print(f"\n=== type 별 발화 요약 ===")
    by_type = defaultdict(int)
    for _, name in filtered:
        by_type[name] += 1
    for name, cnt in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {name:<20}  {cnt}")

    # node 별 hot spot
    print(f"\n=== node 별 (top 10) ===")
    by_node = defaultdict(int)
    for r, _ in filtered:
        by_node[r['node_idx']] += 1
    for node, cnt in sorted(by_node.items(), key=lambda x: -x[1])[:10]:
        print(f"  node={node:>4}  {cnt}")

    # veh 별 (top 10) — REQ 안 하고 grant 받은 차량 등 추적
    print(f"\n=== veh 별 (top 10) ===")
    by_veh = defaultdict(int)
    for r, _ in filtered:
        by_veh[r['veh_id']] += 1
    for vid, cnt in sorted(by_veh.items(), key=lambda x: -x[1])[:10]:
        print(f"  veh={vid:>4}  {cnt}")


def cmd_raw(data: dict, veh_id: int, ts_from: int, ts_to: int, limit: int = 50):
    """특정 차량의 원시 레코드 출력"""
    print(f"\n=== Raw Records for veh {veh_id} ===")
    for suffix, records in sorted(data.items()):
        veh_records = [r for r in records
                       if r.get('veh_id') == veh_id and ts_from <= r.get('ts', 0) <= ts_to]
        if not veh_records:
            continue
        print(f"\n  [{suffix}] {len(veh_records)} records")
        cols = list(veh_records[0].keys())
        print('  ' + ' | '.join(f'{c:>12}' for c in cols))
        for r in veh_records[:limit]:
            vals = []
            for c in cols:
                v = r[c]
                vals.append(f'{v:>12.3f}' if isinstance(v, float) else f'{v:>12}')
            print('  ' + ' | '.join(vals))
        if len(veh_records) > limit:
            print(f"  ... (+{len(veh_records)-limit} more)")


# ==============================================================================
# main
# ==============================================================================

def parse_ts(s: str) -> int:
    if ':' in s:
        parts = s.split(':')
        h, m, sec = int(parts[0]), int(parts[1]), float(parts[2])
        return int((h*3600 + m*60 + sec) * 1000)
    return int(s)


def main():
    parser = argparse.ArgumentParser(
        description='VPS 로그 통합 분석',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('session_dir', help='세션 로그 디렉토리 (logs/SESSION_ID/)')
    parser.add_argument('--veh', type=int, help='차량 ID 필터')
    parser.add_argument('--from', dest='ts_from', default='0', help='시작 시간 ms or MM:SS.mmm')
    parser.add_argument('--to',   dest='ts_to',   default='999999999', help='종료 시간')
    parser.add_argument('--stuck', action='store_true', help='멈춘 차량 탐지')
    parser.add_argument('--transfers', action='store_true', help='반송 현황 요약')
    parser.add_argument('--deadlock', action='store_true', help='deadlock 분석 (--pair 필수)')
    parser.add_argument('--pair', type=int, nargs='+', metavar='VEH', help='분석할 차량 ID 목록 (예: --pair 41 108)')
    parser.add_argument('--node', type=int, help='타겟 노드 ID (deadlock 분석용, 0-based)')
    parser.add_argument('--lock-node', dest='lock_node', type=int,
                        help='특정 노드의 lock activity 분석 (0-based node_idx, 시간순 + 위치 + holder timeline)')
    parser.add_argument('--lock-detail', action='store_true', dest='lock_detail',
                        help='DEV_LOCK_DETAIL 분석 (zone preempt / DZ gate / holder swap 의심 메커니즘 추적)')
    parser.add_argument('--detail-type', dest='detail_type',
                        help='--lock-detail 필터: 부분 일치 (예: ZONE_PREEMPT, DZ_GATE, HOLDER_SWAP)')
    parser.add_argument('--raw', action='store_true', help='원시 레코드 출력')
    parser.add_argument('--limit', type=int, default=50, help='raw 모드 최대 출력 수')
    args = parser.parse_args()

    session_dir = Path(args.session_dir)
    if not session_dir.exists():
        print(f"[ERROR] 디렉토리 없음: {session_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading session: {session_dir}")
    data = load_session(session_dir)
    if not data:
        print("[ERROR] .bin 파일을 찾을 수 없습니다", file=sys.stderr)
        sys.exit(1)

    ts_from = parse_ts(args.ts_from)
    ts_to   = parse_ts(args.ts_to)

    if args.deadlock:
        if not args.pair or len(args.pair) < 2:
            print("[ERROR] --deadlock 에는 --pair VEH1 VEH2 필요", file=sys.stderr)
            sys.exit(1)
        cmd_deadlock(data, args.pair, args.node)
    elif args.lock_detail:
        cmd_lock_detail(data, ts_from, ts_to,
                        veh_filter=args.veh,
                        node_filter=args.lock_node,
                        type_filter=args.detail_type)
    elif args.lock_node is not None:
        cmd_lock_node(data, args.lock_node, ts_from, ts_to)
    elif args.stuck:
        cmd_stuck(data)
    elif args.transfers:
        cmd_transfers(data)
    elif args.veh is not None:
        if args.raw:
            cmd_raw(data, args.veh, ts_from, ts_to, args.limit)
        else:
            cmd_vehicle_timeline(data, args.veh, ts_from, ts_to)
    else:
        cmd_summary(data)


if __name__ == '__main__':
    main()
