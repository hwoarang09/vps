#!/usr/bin/env python3
"""
Edge Transit Log Parser

바이너리 로그 파일(.bin)을 읽어서 분석하는 스크립트

Usage:
    python parse_edge_log.py <log_file.bin>
    python parse_edge_log.py <log_file.bin> --csv output.csv
    python parse_edge_log.py <log_file.bin> --stats
"""

import struct
import sys
import argparse
from dataclasses import dataclass
from typing import List, Optional
from collections import defaultdict

# Record format (28 bytes, little-endian)
# | Field       | Type    | Size    | Offset |
# |-------------|---------|---------|--------|
# | timestamp   | Uint32  | 4 bytes | 0      |
# | workerId    | Uint8   | 1 byte  | 4      |
# | fabId       | Uint8   | 1 byte  | 5      |
# | edgeId      | Uint16  | 2 bytes | 6      |
# | vehId       | Uint32  | 4 bytes | 8      |
# | enterTime   | Uint32  | 4 bytes | 12     |
# | exitTime    | Uint32  | 4 bytes | 16     |
# | edgeLength  | Float32 | 4 bytes | 20     |
# | edgeType    | Uint8   | 1 byte  | 24     |
# | padding     | 3 bytes | 3 bytes | 25     |

RECORD_SIZE = 28
RECORD_FORMAT = '<I BB H I I I f B 3x'  # little-endian

EDGE_TYPES = {
    0: "LINEAR",
    1: "CURVE_90",
    2: "CURVE_180",
    3: "CURVE_CSC",
    4: "S_CURVE",
    5: "LEFT_CURVE",
    6: "RIGHT_CURVE",
}


@dataclass
class EdgeTransitRecord:
    timestamp: int      # ms
    worker_id: int
    fab_id: int
    edge_id: int
    veh_id: int
    enter_time: int     # ms
    exit_time: int      # ms
    edge_length: float  # meters
    edge_type: int

    @property
    def transit_time(self) -> int:
        """Edge 통과 시간 (ms)"""
        return self.exit_time - self.enter_time

    @property
    def speed(self) -> float:
        """평균 속도 (m/s)"""
        if self.transit_time <= 0:
            return 0.0
        return self.edge_length / (self.transit_time / 1000.0)

    @property
    def edge_type_name(self) -> str:
        return EDGE_TYPES.get(self.edge_type, f"UNKNOWN({self.edge_type})")


def parse_log_file(filepath: str) -> List[EdgeTransitRecord]:
    """바이너리 로그 파일 파싱"""
    records = []

    with open(filepath, 'rb') as f:
        while True:
            data = f.read(RECORD_SIZE)
            if len(data) < RECORD_SIZE:
                break

            unpacked = struct.unpack(RECORD_FORMAT, data)
            record = EdgeTransitRecord(
                timestamp=unpacked[0],
                worker_id=unpacked[1],
                fab_id=unpacked[2],
                edge_id=unpacked[3],
                veh_id=unpacked[4],
                enter_time=unpacked[5],
                exit_time=unpacked[6],
                edge_length=unpacked[7],
                edge_type=unpacked[8],
            )
            records.append(record)

    return records


def print_records(records: List[EdgeTransitRecord], limit: Optional[int] = None):
    """레코드 출력"""
    print(f"{'Time':>8} {'Worker':>6} {'Fab':>4} {'Edge':>6} {'Veh':>6} {'Enter':>8} {'Exit':>8} {'Transit':>8} {'Length':>8} {'Speed':>6} {'Type'}")
    print("-" * 100)

    for i, r in enumerate(records):
        if limit and i >= limit:
            print(f"... and {len(records) - limit} more records")
            break

        print(f"{r.timestamp:>8} {r.worker_id:>6} {r.fab_id:>4} {r.edge_id:>6} {r.veh_id:>6} "
              f"{r.enter_time:>8} {r.exit_time:>8} {r.transit_time:>7}ms {r.edge_length:>7.2f}m "
              f"{r.speed:>5.2f} {r.edge_type_name}")


def print_stats(records: List[EdgeTransitRecord]):
    """통계 출력"""
    if not records:
        print("No records found")
        return

    print("\n" + "=" * 60)
    print("STATISTICS")
    print("=" * 60)

    # 기본 통계
    total_records = len(records)
    unique_vehicles = len(set(r.veh_id for r in records))
    unique_edges = len(set(r.edge_id for r in records))
    unique_fabs = len(set(r.fab_id for r in records))
    unique_workers = len(set(r.worker_id for r in records))

    print(f"\nTotal Records: {total_records:,}")
    print(f"Unique Vehicles: {unique_vehicles}")
    print(f"Unique Edges: {unique_edges}")
    print(f"Unique Fabs: {unique_fabs}")
    print(f"Unique Workers: {unique_workers}")

    # 시간 범위
    min_time = min(r.timestamp for r in records)
    max_time = max(r.timestamp for r in records)
    duration = (max_time - min_time) / 1000.0

    print(f"\nTime Range: {min_time}ms ~ {max_time}ms ({duration:.1f}s)")

    # Transit time 통계
    transit_times = [r.transit_time for r in records if r.transit_time > 0]
    if transit_times:
        avg_transit = sum(transit_times) / len(transit_times)
        min_transit = min(transit_times)
        max_transit = max(transit_times)
        print(f"\nTransit Time:")
        print(f"  Avg: {avg_transit:.1f}ms")
        print(f"  Min: {min_transit}ms")
        print(f"  Max: {max_transit}ms")

    # Speed 통계
    speeds = [r.speed for r in records if r.speed > 0]
    if speeds:
        avg_speed = sum(speeds) / len(speeds)
        min_speed = min(speeds)
        max_speed = max(speeds)
        print(f"\nSpeed:")
        print(f"  Avg: {avg_speed:.2f} m/s")
        print(f"  Min: {min_speed:.2f} m/s")
        print(f"  Max: {max_speed:.2f} m/s")

    # Edge Type 분포
    type_counts = defaultdict(int)
    for r in records:
        type_counts[r.edge_type_name] += 1

    print(f"\nEdge Type Distribution:")
    for edge_type, count in sorted(type_counts.items(), key=lambda x: -x[1]):
        pct = count / total_records * 100
        print(f"  {edge_type}: {count:,} ({pct:.1f}%)")

    # Fab별 통계
    fab_counts = defaultdict(int)
    for r in records:
        fab_counts[r.fab_id] += 1

    print(f"\nRecords per Fab:")
    for fab_id, count in sorted(fab_counts.items()):
        pct = count / total_records * 100
        print(f"  Fab {fab_id}: {count:,} ({pct:.1f}%)")


def export_csv(records: List[EdgeTransitRecord], output_path: str):
    """CSV로 내보내기"""
    with open(output_path, 'w') as f:
        # Header
        f.write("timestamp,worker_id,fab_id,edge_id,veh_id,enter_time,exit_time,transit_time,edge_length,speed,edge_type\n")

        # Data
        for r in records:
            f.write(f"{r.timestamp},{r.worker_id},{r.fab_id},{r.edge_id},{r.veh_id},"
                    f"{r.enter_time},{r.exit_time},{r.transit_time},{r.edge_length:.4f},"
                    f"{r.speed:.4f},{r.edge_type_name}\n")

    print(f"Exported {len(records)} records to {output_path}")


def main():
    parser = argparse.ArgumentParser(description='Edge Transit Log Parser')
    parser.add_argument('logfile', help='Path to .bin log file')
    parser.add_argument('--csv', help='Export to CSV file')
    parser.add_argument('--stats', action='store_true', help='Show statistics')
    parser.add_argument('--limit', type=int, default=50, help='Limit number of records to display (default: 50)')
    parser.add_argument('--all', action='store_true', help='Show all records (no limit)')

    args = parser.parse_args()

    print(f"Parsing: {args.logfile}")
    records = parse_log_file(args.logfile)
    print(f"Found {len(records):,} records\n")

    if args.csv:
        export_csv(records, args.csv)
    elif args.stats:
        print_stats(records)
    else:
        limit = None if args.all else args.limit
        print_records(records, limit)
        if not args.all and len(records) > args.limit:
            print(f"\nUse --all to see all records, or --stats for statistics")


if __name__ == '__main__':
    main()
