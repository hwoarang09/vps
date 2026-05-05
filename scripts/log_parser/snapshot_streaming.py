#!/usr/bin/env python3
"""
Snapshot binary streaming reader.

큰 *_snapshot.bin (300MB+) 을 메모리에 다 안 올리고 streaming 으로 파싱.
analyze.py 의 parse_snapshot_file 은 모든 frame 을 list 로 보관 — large
session 에서 OOM 위험. 이 모듈은 generator + filter 로 필요한 frame 만 보관.

사용 시점:
  - snapshot.bin 이 100MB 이상
  - 특정 ts 범위/특정 veh 만 필요한 경우
  - ratio 점프 감지처럼 dense sampling 이 필요할 때

I/O:
  Input:
    - filepath: snapshot.bin 경로
    - target_ts_list (optional): 캡처할 시뮬 ts 리스트 (각 ts 이상 처음 만나는 frame 캡처)
    - ts_range (optional): (ts_from, ts_to) — 이 범위 내 frame 만 캡처
    - target_vehs (optional): set/list of vehId — 이 차량만 dict 에 포함 (전체 캡처해도 됨)
  Output:
    - dict {ts: {'snap_ts': actual_ts, 'data': {vehId: {edge,ratio,vel,stop}}}}
    - 또는 frames generator (필요 시)
"""

import struct
from pathlib import Path
from typing import Iterable, Optional

SNAPSHOT_MAGIC = 0xCAFE
HEADER_SIZE = 8  # magic(2) + ts(4) + numVehicles(2)
VEHICLE_RECORD_SIZE = 14  # vehId(2) + currentEdge(2) + ratio(f4) + velocity(f4) + stopReason(2)


def iter_snapshot_frames(filepath: str | Path,
                         ts_range: Optional[tuple[int, int]] = None):
    """Snapshot frames generator. 각 frame 의 ts/num_v/raw_offsets 만 yield.

    Yields:
        dict { 'ts': int, 'num_v': int, 'raw': bytes, 'veh_off': int, 'edge_off_after_veh': int }

    한 frame 의 vehicle 데이터는 raw[veh_off : veh_off + 14*num_v].
    호출자가 직접 unpack 해서 원하는 필드만 추출하도록 함.
    """
    filepath = Path(filepath)
    raw = filepath.read_bytes()
    total = len(raw)
    off = 0

    ts_from = ts_range[0] if ts_range else 0
    ts_to = ts_range[1] if ts_range else 0xFFFFFFFF

    while off + HEADER_SIZE <= total:
        magic = struct.unpack_from('<H', raw, off)[0]
        if magic != SNAPSHOT_MAGIC:
            nxt = raw.find(struct.pack('<H', SNAPSHOT_MAGIC), off + 1)
            if nxt < 0:
                break
            off = nxt
            continue

        ts = struct.unpack_from('<I', raw, off + 2)[0]
        num_v = struct.unpack_from('<H', raw, off + 6)[0]
        veh_start = off + HEADER_SIZE
        veh_end = veh_start + VEHICLE_RECORD_SIZE * num_v

        if veh_end + 2 > total:
            break

        # Skip past activeEdges section to find next frame
        cur = veh_end
        num_e = struct.unpack_from('<H', raw, cur)[0]
        cur += 2
        for _ in range(num_e):
            if cur + 4 > total:
                break
            edge_id, count = struct.unpack_from('<HH', raw, cur)
            cur += 4 + 2 * count

        if ts_from <= ts <= ts_to:
            yield {'ts': ts, 'num_v': num_v, 'raw': raw,
                   'veh_off': veh_start, 'next_off': cur}

        if ts > ts_to:
            break

        off = cur


def _read_vehicles_from_frame(frame, target_vehs: Optional[set] = None) -> dict:
    """Frame 에서 특정 차량(또는 전체)의 상태 추출."""
    raw = frame['raw']
    off = frame['veh_off']
    num_v = frame['num_v']
    out = {}
    for _ in range(num_v):
        vid, edge = struct.unpack_from('<HH', raw, off)
        ratio, vel = struct.unpack_from('<ff', raw, off + 4)
        stop = struct.unpack_from('<H', raw, off + 12)[0]
        if target_vehs is None or vid in target_vehs:
            out[vid] = {'edge': edge, 'ratio': ratio, 'vel': vel, 'stop': stop}
        off += VEHICLE_RECORD_SIZE
    return out


def capture_at_ts_list(filepath: str | Path,
                       target_ts_list: list[int],
                       target_vehs: Optional[Iterable[int]] = None) -> dict:
    """주어진 ts 리스트에 대해 각 ts 이상 처음 만나는 frame 의 차량 상태 캡처.

    Args:
        filepath: snapshot.bin 경로
        target_ts_list: 정렬된 ts (ms) 리스트 — 각 값 이상 처음 만나는 frame 캡처
        target_vehs: 추출할 vehId 집합 (None 이면 전체)

    Returns:
        { target_ts: { 'snap_ts': int, 'data': { vehId: {edge,ratio,vel,stop} } } }
    """
    target_ts_list = sorted(target_ts_list)
    veh_set = set(target_vehs) if target_vehs is not None else None
    results = {}
    target_idx = 0

    for frame in iter_snapshot_frames(filepath):
        if target_idx >= len(target_ts_list):
            break
        # 현재 frame 의 ts 가 target 을 지나면 캡처
        while target_idx < len(target_ts_list) and frame['ts'] >= target_ts_list[target_idx]:
            results[target_ts_list[target_idx]] = {
                'snap_ts': frame['ts'],
                'data': _read_vehicles_from_frame(frame, veh_set),
            }
            target_idx += 1

    return results


def capture_dense_range(filepath: str | Path,
                        ts_range: tuple[int, int],
                        target_vehs: Optional[Iterable[int]] = None,
                        every_n: int = 1) -> list[dict]:
    """Range 내 모든 frame (또는 N frame 마다) 의 차량 상태를 list 로 캡처.

    Args:
        filepath: snapshot.bin 경로
        ts_range: (ts_from, ts_to)
        target_vehs: 추출할 vehId 집합 (None 이면 전체)
        every_n: N=1 이면 모든 frame, N=2 면 격 frame

    Returns:
        [{ 'ts': int, 'data': {vehId: {edge,ratio,vel,stop}} }, ...]
    """
    veh_set = set(target_vehs) if target_vehs is not None else None
    results = []
    i = 0
    for frame in iter_snapshot_frames(filepath, ts_range):
        if i % every_n == 0:
            results.append({
                'ts': frame['ts'],
                'data': _read_vehicles_from_frame(frame, veh_set),
            })
        i += 1
    return results


def detect_ratio_jumps(filepath: str | Path,
                       veh_id: int,
                       threshold: float = 0.3,
                       ts_range: Optional[tuple[int, int]] = None) -> list[dict]:
    """차량의 frame 간 ratio 변화를 추적해서 |Δratio| > threshold 인 점프 감지.

    Edge 가 변경된 경우는 정상 (다음 edge 시작), 같은 edge 인데 점프하면 비정상.

    Args:
        veh_id: 추적할 차량
        threshold: 절댓값 임계 (기본 0.3 = 30%)
        ts_range: (ts_from, ts_to). None 이면 전체.

    Returns:
        [{ 'ts': int, 'edge': int, 'prev_ratio': float, 'cur_ratio': float,
           'delta': float, 'same_edge': bool, 'prev_vel': float, 'cur_vel': float }]
    """
    jumps = []
    prev = None
    for frame in iter_snapshot_frames(filepath, ts_range):
        veh_data = _read_vehicles_from_frame(frame, {veh_id})
        if veh_id not in veh_data:
            continue
        cur = {'ts': frame['ts'], **veh_data[veh_id]}
        if prev is not None:
            delta = cur['ratio'] - prev['ratio']
            same_edge = cur['edge'] == prev['edge']
            if abs(delta) > threshold:
                jumps.append({
                    'ts': cur['ts'],
                    'edge': cur['edge'],
                    'prev_ratio': prev['ratio'],
                    'cur_ratio': cur['ratio'],
                    'delta': delta,
                    'same_edge': same_edge,
                    'prev_vel': prev['vel'],
                    'cur_vel': cur['vel'],
                    'prev_ts': prev['ts'],
                })
        prev = cur
    return jumps
