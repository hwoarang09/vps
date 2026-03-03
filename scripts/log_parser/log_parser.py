#!/usr/bin/env python3
"""
VPS SimLogger 바이너리 로그 파서
새 로그 시스템(SimLogger)이 생성한 .bin 파일을 파싱합니다.

사용법:
  python log_parser.py /path/to/session_xxx_edge_transit.bin --summary
  python log_parser.py /path/to/ --session session_xxx --export-csv ./output/
  python log_parser.py /path/to/ --session session_xxx --type edge_transit --veh 5
  python log_parser.py /path/to/ --session session_xxx --from 1000 --to 5000
"""

import argparse
import os
import struct
import sys
from pathlib import Path

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

# ==============================================================================
# 프로토콜 정의 (protocol.ts와 동기화 필요)
# ==============================================================================

EVENT_TYPES = {
    1:  ('ML_PICKUP',       16, '<IIiHBx'),     # ts(u32) vehId(u32) nodeEdgeId(i32) stationIdx(u16) bayIdx(u8) pad(1)
    2:  ('ML_DROPOFF',      16, '<IIiHBx'),     # ts(u32) vehId(u32) nodeEdgeId(i32) stationIdx(u16) bayIdx(u8) pad(1)
    3:  ('ML_EDGE_TRANSIT', 24, '<IIIIIf'),     # ts(u32) vehId(u32) edgeId(u32) enterTs(u32) exitTs(u32) edgeLen(f32)
    4:  ('ML_LOCK',         16, '<IIHBxI'),     # ts(u32) vehId(u32) nodeIdx(u16) eventType(u8) pad(1) waitMs(u32)
    10: ('DEV_VEH_STATE',   44, '<II9f'),       # ts(u32) vehId(u32) x y z edge ratio speed movingStatus trafficState jobState
    11: ('DEV_PATH',        16, '<IIII'),       # ts(u32) vehId(u32) destEdge(u32) pathLen(u32)
    12: ('DEV_LOCK_DETAIL', 20, '<IIHBxII'),   # ts(u32) vehId(u32) nodeIdx(u16) type(u8) pad(1) holderVehId(u32) waitMs(u32)
    13: ('DEV_TRANSFER',    16, '<IIII'),       # ts(u32) vehId(u32) fromEdge(u32) toEdge(u32)
    14: ('DEV_EDGE_QUEUE',  16, '<IIIHBx'),    # ts(u32) edgeId(u32) vehId(u32) count(u16) type(u8) pad(1)
}

FILE_SUFFIX_TO_TYPES = {
    'job':          [1, 2],
    'edge_transit': [3],
    'lock':         [4],
    'veh_state':    [10],
    'path':         [11],
    'lock_detail':  [12],
    'transfer':     [13],
    'edge_queue':   [14],
}

COLUMNS = {
    1:  ['ts', 'veh_id', 'node_edge_id', 'station_idx', 'bay_idx'],
    2:  ['ts', 'veh_id', 'node_edge_id', 'station_idx', 'bay_idx'],
    3:  ['ts', 'veh_id', 'edge_id', 'enter_ts', 'exit_ts', 'edge_len'],
    4:  ['ts', 'veh_id', 'node_idx', 'event_type', 'wait_ms'],
    10: ['ts', 'veh_id', 'x', 'y', 'z', 'edge', 'ratio', 'speed', 'moving_status', 'traffic_state', 'job_state'],
    11: ['ts', 'veh_id', 'dest_edge', 'path_len'],
    12: ['ts', 'veh_id', 'node_idx', 'type', 'holder_veh_id', 'wait_ms'],
    13: ['ts', 'veh_id', 'from_edge', 'to_edge'],
    14: ['ts', 'edge_id', 'veh_id', 'count', 'type'],
}


def detect_file_type(filename: str):
    """파일명에서 이벤트 타입 목록 추출"""
    stem = Path(filename).stem  # e.g., "session_xxx_edge_transit"
    for suffix, types in FILE_SUFFIX_TO_TYPES.items():
        if stem.endswith(f'_{suffix}'):
            return types
    return None


def parse_file(filepath: str, event_types=None):
    """
    바이너리 파일 파싱

    Args:
        filepath: .bin 파일 경로
        event_types: 파싱할 이벤트 타입 목록 (None이면 자동 감지)

    Returns:
        list of dict records
    """
    filepath = Path(filepath)
    if not filepath.exists():
        print(f"[ERROR] File not found: {filepath}", file=sys.stderr)
        return []

    if event_types is None:
        event_types = detect_file_type(str(filepath))
        if event_types is None:
            print(f"[ERROR] Cannot detect event type from filename: {filepath.name}", file=sys.stderr)
            return []

    records = []
    raw = filepath.read_bytes()
    total_bytes = len(raw)

    if total_bytes == 0:
        return []

    # 단일 이벤트 타입 파일인 경우 (most common)
    if len(event_types) == 1:
        etype = event_types[0]
        if etype not in EVENT_TYPES:
            print(f"[ERROR] Unknown event type: {etype}", file=sys.stderr)
            return []
        _, record_size, fmt = EVENT_TYPES[etype]
        columns = COLUMNS[etype]

        if total_bytes % record_size != 0:
            print(f"[WARN] File size {total_bytes} not aligned to record size {record_size}, "
                  f"truncating to {total_bytes // record_size} records", file=sys.stderr)

        num_records = total_bytes // record_size
        for i in range(num_records):
            offset = i * record_size
            values = struct.unpack_from(fmt, raw, offset)
            records.append(dict(zip(columns, values)))

    # 복수 이벤트 타입 파일 (job.bin = ML_PICKUP + ML_DROPOFF)
    else:
        # ML_PICKUP과 ML_DROPOFF는 동일한 구조이므로 모두 16바이트
        _, record_size, fmt = EVENT_TYPES[event_types[0]]
        columns = COLUMNS[event_types[0]]
        num_records = total_bytes // record_size
        for i in range(num_records):
            offset = i * record_size
            values = struct.unpack_from(fmt, raw, offset)
            records.append(dict(zip(columns, values)))

    return records


def filter_records(records, veh_id=None, ts_from=None, ts_to=None):
    """레코드 필터링"""
    filtered = records
    if veh_id is not None:
        filtered = [r for r in filtered if r.get('veh_id') == veh_id]
    if ts_from is not None:
        filtered = [r for r in filtered if r.get('ts', 0) >= ts_from]
    if ts_to is not None:
        filtered = [r for r in filtered if r.get('ts', 0) <= ts_to]
    return filtered


def print_summary(records, filepath: str):
    """통계 요약 출력"""
    if not records:
        print("No records found.")
        return

    ts_values = [r['ts'] for r in records if 'ts' in r]
    veh_ids = set(r['veh_id'] for r in records if 'veh_id' in r)

    print(f"\n{'='*50}")
    print(f"File: {Path(filepath).name}")
    print(f"Total records: {len(records)}")
    print(f"Unique vehicles: {len(veh_ids)}")
    if ts_values:
        print(f"Time range: {min(ts_values)} ~ {max(ts_values)} ms")
        print(f"Duration: {max(ts_values) - min(ts_values)} ms")

    # Edge transit 특수 통계
    if records and 'enter_ts' in records[0]:
        durations = [r['exit_ts'] - r['enter_ts'] for r in records if r.get('exit_ts', 0) >= r.get('enter_ts', 0)]
        if durations:
            print(f"\nEdge transit stats:")
            print(f"  Count: {len(durations)}")
            print(f"  Avg transit time: {sum(durations)/len(durations):.1f} ms")
            print(f"  Min: {min(durations)} ms, Max: {max(durations)} ms")
            if records[0].get('edge_len', 0) > 0:
                lengths = [r['edge_len'] for r in records]
                print(f"  Avg edge length: {sum(lengths)/len(lengths):.2f} m")

    print(f"{'='*50}\n")


def export_csv(records, output_path: str, filename: str):
    """CSV로 내보내기"""
    if not records:
        print("No records to export.")
        return

    output_path = Path(output_path)
    output_path.mkdir(parents=True, exist_ok=True)

    csv_file = output_path / filename.replace('.bin', '.csv')

    if HAS_PANDAS:
        df = pd.DataFrame(records)
        df.to_csv(csv_file, index=False)
    else:
        # pandas 없이 수동 CSV 작성
        if records:
            with open(csv_file, 'w') as f:
                headers = list(records[0].keys())
                f.write(','.join(headers) + '\n')
                for r in records:
                    f.write(','.join(str(r[h]) for h in headers) + '\n')

    print(f"Exported: {csv_file}")


def print_records(records, limit=20):
    """레코드 출력 (처음 N개)"""
    if not records:
        print("No records.")
        return

    n = min(limit, len(records))
    print(f"\nShowing first {n} of {len(records)} records:")

    if records:
        headers = list(records[0].keys())
        # 헤더 출력
        print(' | '.join(f'{h:>12}' for h in headers))
        print('-' * (14 * len(headers)))
        for r in records[:n]:
            print(' | '.join(f'{r[h]:>12}' if isinstance(r[h], int) else f'{r[h]:>12.3f}' for h in headers))


def find_files_for_session(directory: str, session_id: str):
    """세션 ID에 해당하는 모든 파일 찾기"""
    directory = Path(directory)
    return list(directory.glob(f'{session_id}_*.bin'))


def parse_time(value: str) -> int:
    """시간 파싱: ms 숫자 또는 HH:MM:SS 형식"""
    if ':' in value:
        parts = value.split(':')
        h, m, s = int(parts[0]), int(parts[1]), int(parts[2])
        return (h * 3600 + m * 60 + s) * 1000
    return int(value)


def main():
    parser = argparse.ArgumentParser(
        description='VPS SimLogger 바이너리 로그 파서',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  python log_parser.py /path/to/session_xxx_edge_transit.bin --summary
  python log_parser.py /path/to/ --session session_xxx --type edge_transit
  python log_parser.py /path/to/sim_123_job.bin --veh 5 --summary
  python log_parser.py /path/to/ --session session_xxx --export-csv ./output/
  python log_parser.py /path/to/sim_123_veh_state.bin --from 1000 --to 5000
        """
    )
    parser.add_argument('path', help='파일 경로 또는 디렉토리')
    parser.add_argument('--session', help='세션 ID (디렉토리 지정 시 필수)')
    parser.add_argument('--type', choices=list(FILE_SUFFIX_TO_TYPES.keys()),
                        help='특정 이벤트 타입만 파싱')
    parser.add_argument('--veh', type=int, help='특정 차량 ID 필터')
    parser.add_argument('--summary', action='store_true', help='통계 요약 출력')
    parser.add_argument('--export-csv', metavar='OUTPUT_DIR', help='CSV로 내보내기')
    parser.add_argument('--from', dest='ts_from', type=str, help='시작 시간 (ms 또는 HH:MM:SS)')
    parser.add_argument('--to', dest='ts_to', type=str, help='종료 시간 (ms 또는 HH:MM:SS)')
    parser.add_argument('--limit', type=int, default=20, help='출력할 최대 레코드 수 (기본: 20)')

    args = parser.parse_args()

    # 시간 범위 파싱
    ts_from = parse_time(args.ts_from) if args.ts_from else None
    ts_to = parse_time(args.ts_to) if args.ts_to else None

    path = Path(args.path)

    # 파일 목록 결정
    files_to_parse = []

    if path.is_file():
        files_to_parse.append(path)
    elif path.is_dir():
        if args.session:
            if args.type:
                target = path / f'{args.session}_{args.type}.bin'
                if target.exists():
                    files_to_parse.append(target)
                else:
                    print(f"[ERROR] File not found: {target}", file=sys.stderr)
                    sys.exit(1)
            else:
                files_to_parse = find_files_for_session(path, args.session)
                if not files_to_parse:
                    print(f"[ERROR] No files found for session: {args.session}", file=sys.stderr)
                    sys.exit(1)
        else:
            # 모든 .bin 파일 나열
            all_files = sorted(path.glob('*.bin'))
            if not all_files:
                print(f"No .bin files found in: {path}")
                sys.exit(0)
            print(f"Found {len(all_files)} .bin files:")
            for f in all_files:
                size = f.stat().st_size
                print(f"  {f.name} ({size:,} bytes)")
            sys.exit(0)
    else:
        print(f"[ERROR] Path not found: {path}", file=sys.stderr)
        sys.exit(1)

    # 파싱 및 출력
    for filepath in sorted(files_to_parse):
        event_types = detect_file_type(str(filepath))
        if args.type:
            event_types = FILE_SUFFIX_TO_TYPES.get(args.type, event_types)

        records = parse_file(str(filepath), event_types)

        # 필터링
        records = filter_records(records, veh_id=args.veh, ts_from=ts_from, ts_to=ts_to)

        if args.summary:
            print_summary(records, str(filepath))
        elif args.export_csv:
            export_csv(records, args.export_csv, filepath.name)
        else:
            print(f"\n[{filepath.name}] {len(records)} records")
            print_records(records, limit=args.limit)


if __name__ == '__main__':
    main()
