#!/usr/bin/env python3
"""
노트북 테스트를 위한 샘플 로그 파일 생성 및 검증
"""

import struct
import polars as pl
import numpy as np
from pathlib import Path

# Binary Format
RECORD_SIZE = 28
RECORD_FORMAT = '<I BB H I I I f B 3x'  # little-endian

EDGE_TYPES = {
    0: 'LINEAR',
    1: 'CURVE_90',
    2: 'CURVE_180',
    3: 'CURVE_CSC',
    4: 'S_CURVE',
    5: 'LEFT_CURVE',
    6: 'RIGHT_CURVE',
}

EXPECTED_SPEEDS = {
    'LINEAR': 3.0,
    'CURVE_90': 2.2,
    'CURVE_180': 2.0,
    'CURVE_CSC': 2.2,
    'S_CURVE': 2.3,
    'LEFT_CURVE': 2.2,
    'RIGHT_CURVE': 2.2,
}

def create_test_log(filepath, num_records=1000):
    """테스트용 로그 파일 생성"""
    print(f'테스트 로그 파일 생성 중: {filepath}')

    with open(filepath, 'wb') as f:
        timestamp = 0
        for _ in range(num_records):
            # 랜덤 데이터 생성
            worker_id = np.random.Generator().integers(0, 4)
            fab_id = np.random.Generator().integers(0, 2)
            edge_id = np.random.Generator().integers(0, 100)
            veh_id = np.random.Generator().integers(0, 50)

            # Edge 특성
            edge_type = np.random.Generator().integers(0, 7)
            edge_length = np.random.Generator().uniform(1.0, 5.0)

            # 시간 계산
            expected_speed = list(EXPECTED_SPEEDS.values())[edge_type]
            transit_time_ms = int((edge_length / expected_speed) * 1000 * np.random.Generator().uniform(0.8, 1.5))

            enter_time = timestamp + np.random.Generator().integers(0, 100)
            exit_time = enter_time + transit_time_ms

            # 레코드 작성
            record = struct.pack(
                RECORD_FORMAT,
                timestamp,      # timestamp
                worker_id,      # worker_id
                fab_id,         # fab_id
                edge_id,        # edge_id
                veh_id,         # veh_id
                enter_time,     # enter_time
                exit_time,      # exit_time
                edge_length,    # edge_length
                edge_type,      # edge_type
            )
            f.write(record)

            timestamp += np.random.Generator().integers(10, 50)

    # 파일 크기 확인
    file_size = Path(filepath).stat().st_size
    print(f'생성 완료: {num_records} records, {file_size / 1024:.1f} KB')

def parse_log_file(filepath):
    """바이너리 로그 파일을 Polars DataFrame으로 변환"""
    records = []

    with open(filepath, 'rb') as f:
        data = f.read()

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

    # Polars DataFrame 생성
    df = pl.DataFrame(records)

    if len(df) > 0:
        # Edge type을 문자열로 변환 (when-then 체인 사용)
        edge_type_expr = pl.col('edge_type')
        for type_id, type_name in EDGE_TYPES.items():
            if type_id == 0:
                edge_type_expr = pl.when(pl.col('edge_type') == type_id).then(pl.lit(type_name))
            else:
                edge_type_expr = edge_type_expr.when(pl.col('edge_type') == type_id).then(pl.lit(type_name))
        edge_type_expr = edge_type_expr.otherwise(pl.lit('UNKNOWN')).alias('edge_type_name')

        # 계산 컬럼 추가
        df = df.with_columns([
            # Transit time
            (pl.col('exit_time') - pl.col('enter_time')).alias('transit_time'),
            # Edge type name
            edge_type_expr,
            # 시간을 초 단위로 변환
            (pl.col('timestamp') / 1000.0).alias('timestamp_sec'),
            (pl.col('enter_time') / 1000.0).alias('enter_time_sec'),
            (pl.col('exit_time') / 1000.0).alias('exit_time_sec'),
        ])

        # Speed 계산 (0으로 나누기 방지)
        df = df.with_columns([
            pl.when(pl.col('transit_time') > 0)
              .then(pl.col('edge_length') / (pl.col('transit_time') / 1000.0))
              .otherwise(None)
              .alias('speed')
        ])

        # Edge ID 포맷 추가 (E0001, E0002, ...)
        df = df.with_columns([
            (pl.lit('E') + (pl.col('edge_id') + 1).cast(pl.Utf8).str.zfill(4)).alias('edge_id_fmt')
        ])

    return df

def test_parser():
    """파서 테스트"""
    test_file = Path('test_edge_transit.bin')

    # 테스트 파일 생성
    create_test_log(test_file, num_records=1000)

    # 파싱 테스트
    print('\n파싱 테스트 시작...')
    df = parse_log_file(test_file)

    print(f'✓ 파싱 완료: {len(df):,} records')
    print(f'✓ 컬럼 수: {len(df.columns)}')
    print('\n컬럼 목록:')
    for col in df.columns:
        print(f'  - {col}: {df[col].dtype}')

    print('\n기본 통계:')
    print(f'  Unique Vehicles: {df["veh_id"].n_unique()}')
    print(f'  Unique Edges: {df["edge_id"].n_unique()}')
    print(f'  Unique Fabs: {df["fab_id"].n_unique()}')
    print(f'  Transit Time Mean: {df["transit_time"].mean():.1f} ms')
    print(f'  Speed Mean: {df["speed"].mean():.2f} m/s')

    print('\nEdge Type 분포:')
    edge_type_counts = df.group_by('edge_type_name').agg([
        pl.count().alias('count')
    ]).sort('count', descending=True)
    print(edge_type_counts)

    print('\nEdge ID 포맷 샘플:')
    print(df.select(['edge_id', 'edge_id_fmt']).unique().sort('edge_id').head(10))

    # 정리
    test_file.unlink()
    print('\n✓ 테스트 완료!')

if __name__ == '__main__':
    test_parser()
