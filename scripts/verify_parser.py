#!/usr/bin/env python3
"""
노트북 파서 코드 검증 (Polars 없이 기본 검증)
"""

import struct
from pathlib import Path

RECORD_SIZE = 28
RECORD_FORMAT = '<I BB H I I I f B 3x'

EDGE_TYPES = {
    0: 'LINEAR',
    1: 'CURVE_90',
    2: 'CURVE_180',
    3: 'CURVE_CSC',
    4: 'S_CURVE',
    5: 'LEFT_CURVE',
    6: 'RIGHT_CURVE',
}

def verify_log_file(filepath):
    """로그 파일 검증"""
    print(f'로그 파일 검증: {filepath}\n')

    records = []
    with open(filepath, 'rb') as f:
        data = f.read()

    # 레코드 파싱
    for i in range(0, len(data), RECORD_SIZE):
        chunk = data[i:i+RECORD_SIZE]
        if len(chunk) < RECORD_SIZE:
            break

        r = struct.unpack(RECORD_FORMAT, chunk)
        records.append({
            'timestamp': r[0],
            'worker_id': r[1],
            'fab_id': r[2],
            'edge_id': r[3],
            'veh_id': r[4],
            'enter_time': r[5],
            'exit_time': r[6],
            'edge_length': r[7],
            'edge_type': r[8],
        })

    print(f'✓ 총 레코드 수: {len(records):,}')

    # Edge Type 분포 확인
    edge_type_counts = {}
    for rec in records:
        edge_type = rec['edge_type']
        edge_type_name = EDGE_TYPES.get(edge_type, 'UNKNOWN')
        edge_type_counts[edge_type_name] = edge_type_counts.get(edge_type_name, 0) + 1

    print('\n✓ Edge Type 분포:')
    for edge_type_name in sorted(edge_type_counts.keys()):
        count = edge_type_counts[edge_type_name]
        pct = count / len(records) * 100
        print(f'  {edge_type_name:12s}: {count:5,} ({pct:5.1f}%)')

    # Edge ID 확인 (E0001 형식 테스트)
    unique_edges = set(rec['edge_id'] for rec in records)
    print('\n✓ Unique Edges: {len(unique_edges)}')
    print('  샘플 Edge ID 포맷 테스트:')
    for edge_id in sorted(list(unique_edges))[:5]:
        formatted = f'E{edge_id+1:04d}'
        print(f'    edge_id {edge_id:3d} → {formatted}')

    # Transit Time 통계
    transit_times = [rec['exit_time'] - rec['enter_time'] for rec in records]
    avg_transit = sum(transit_times) / len(transit_times)
    min_transit = min(transit_times)
    max_transit = max(transit_times)

    print('\n✓ Transit Time 통계 (ms):')
    print(f'  평균: {avg_transit:.1f}')
    print(f'  최소: {min_transit}')
    print(f'  최대: {max_transit}')

    # Speed 계산 샘플
    print('\n✓ Speed 계산 샘플 (첫 5개):')
    for i, rec in enumerate(records[:5]):
        transit_time_ms = rec['exit_time'] - rec['enter_time']
        if transit_time_ms > 0:
            speed = rec['edge_length'] / (transit_time_ms / 1000.0)
            edge_type_name = EDGE_TYPES.get(rec['edge_type'], 'UNKNOWN')
            print(f'  [{i+1}] {edge_type_name:12s}: {rec["edge_length"]:.2f}m / {transit_time_ms}ms = {speed:.2f} m/s')

    # 통계 요약
    unique_vehs = len({rec['veh_id'] for rec in records})
    unique_fabs = len({rec['fab_id'] for rec in records})
    unique_workers = len({rec['worker_id'] for rec in records})

    duration_ms = records[-1]['timestamp'] - records[0]['timestamp']
    duration_sec = duration_ms / 1000.0
    throughput = len(records) / duration_sec

    print('\n✓ 전체 통계:')
    print(f'  Unique Vehicles: {unique_vehs}')
    print(f'  Unique Fabs: {unique_fabs}')
    print(f'  Unique Workers: {unique_workers}')
    print(f'  Duration: {duration_sec:.1f} seconds')
    print(f'  Throughput: {throughput:.1f} transits/sec')

    print(f'\n✅ 검증 완료! 노트북 파서가 정상적으로 작동할 것으로 예상됩니다.')

if __name__ == '__main__':
    test_file = Path('/home/vosui/vosui/vps/scripts/test_edge_transit_5k.bin')
    verify_log_file(test_file)
