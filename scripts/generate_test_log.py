#!/usr/bin/env python3
"""
테스트용 바이너리 로그 파일 생성 (polars 없이)
"""

import struct
import random
from pathlib import Path

# Binary Format
RECORD_SIZE = 28
RECORD_FORMAT = '<I BB H I I I f B 3x'

def create_test_log(filepath, num_records=5000):
    """테스트용 로그 파일 생성"""
    print(f'테스트 로그 파일 생성 중: {filepath}')

    # Edge Type별 기대 속도 (m/s)
    speeds = [3.0, 2.2, 2.0, 2.2, 2.3, 2.2, 2.2]

    with open(filepath, 'wb') as f:
        timestamp = 0
        for i in range(num_records):
            # 랜덤 데이터 생성
            worker_id = random.randint(0, 3)
            fab_id = random.randint(0, 1)
            edge_id = random.randint(0, 199)
            veh_id = random.randint(0, 99)

            # Edge 특성
            edge_type = random.randint(0, 6)
            edge_length = random.uniform(1.0, 5.0)

            # 시간 계산
            expected_speed = speeds[edge_type]
            transit_time_ms = int((edge_length / expected_speed) * 1000 * random.uniform(0.8, 1.5))

            enter_time = timestamp + random.randint(0, 100)
            exit_time = enter_time + transit_time_ms

            # 레코드 작성
            record = struct.pack(
                RECORD_FORMAT,
                timestamp,      # timestamp (u32)
                worker_id,      # worker_id (u8)
                fab_id,         # fab_id (u8)
                edge_id,        # edge_id (u16)
                veh_id,         # veh_id (u32)
                enter_time,     # enter_time (u32)
                exit_time,      # exit_time (u32)
                edge_length,    # edge_length (f32)
                edge_type,      # edge_type (u8)
            )
            f.write(record)

            timestamp += random.randint(10, 100)

    # 파일 크기 확인
    file_size = Path(filepath).stat().st_size
    expected_size = num_records * RECORD_SIZE

    print(f'생성 완료:')
    print(f'  - Records: {num_records:,}')
    print(f'  - File size: {file_size:,} bytes ({file_size / 1024:.1f} KB)')
    print(f'  - Expected: {expected_size:,} bytes')
    print(f'  - Match: {"✓" if file_size == expected_size else "✗"}')

    # 첫 레코드 읽어서 검증
    with open(filepath, 'rb') as f:
        first_record = f.read(RECORD_SIZE)
        data = struct.unpack(RECORD_FORMAT, first_record)
        print(f'\n첫 번째 레코드 검증:')
        print(f'  timestamp: {data[0]}')
        print(f'  worker_id: {data[1]}')
        print(f'  fab_id: {data[2]}')
        print(f'  edge_id: {data[3]}')
        print(f'  veh_id: {data[4]}')
        print(f'  enter_time: {data[5]}')
        print(f'  exit_time: {data[6]}')
        print(f'  edge_length: {data[7]:.2f}')
        print(f'  edge_type: {data[8]}')

if __name__ == '__main__':
    output_file = Path('/home/vosui/vosui/vps/scripts/test_edge_transit_5k.bin')
    create_test_log(output_file, num_records=5000)
    print(f'\n파일이 생성되었습니다: {output_file}')
    print('이 파일을 구글 코랩에 업로드해서 노트북을 테스트하세요.')
