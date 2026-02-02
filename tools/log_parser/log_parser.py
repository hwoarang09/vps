#!/usr/bin/env python3
"""
Edge Transit Log Parser for VPS Simulator
바이너리 로그 파일 (.bin) 파싱 및 분석 도구
"""

import struct
import argparse
from pathlib import Path
from dataclasses import dataclass
from typing import List, Dict, Optional
from collections import defaultdict

# 28 bytes per record
RECORD_SIZE = 28
RECORD_FORMAT = '<IBBHIIIfB3x'  # little-endian

# EdgeType enum mapping
EDGE_TYPES = {
    0: "LINEAR",
    1: "CURVE",
    2: "UNKNOWN"
}


@dataclass
class EdgeTransitRecord:
    timestamp: int      # 기록 시점 (ms)
    worker_id: int      # 워커 ID
    fab_id: int         # Fab ID
    edge_id: int        # Edge 인덱스
    veh_id: int         # Vehicle ID
    enter_time: int     # Edge 진입 시점
    exit_time: int      # Edge 통과 시점
    edge_length: float  # Edge 길이 (m)
    edge_type: int      # EdgeType enum

    @property
    def edge_type_name(self) -> str:
        return EDGE_TYPES.get(self.edge_type, f"TYPE_{self.edge_type}")

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

    def __str__(self) -> str:
        return (
            f"[{self.timestamp:>8}ms] veh={self.veh_id:>5} "
            f"edge={self.edge_id:>5} ({self.edge_type_name:>7}) "
            f"len={self.edge_length:>6.2f}m "
            f"transit={self.transit_time:>5}ms "
            f"speed={self.speed:>5.2f}m/s"
        )


def parse_log_file(file_path: Path) -> List[EdgeTransitRecord]:
    """바이너리 로그 파일 파싱"""
    records = []

    with open(file_path, 'rb') as f:
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
                edge_type=unpacked[8]
            )
            records.append(record)

    return records


def group_by_veh(records: List[EdgeTransitRecord]) -> Dict[int, List[EdgeTransitRecord]]:
    """vehId별로 그룹핑"""
    grouped = defaultdict(list)
    for r in records:
        grouped[r.veh_id].append(r)
    return dict(grouped)


def group_by_edge(records: List[EdgeTransitRecord]) -> Dict[int, List[EdgeTransitRecord]]:
    """edgeId별로 그룹핑"""
    grouped = defaultdict(list)
    for r in records:
        grouped[r.edge_id].append(r)
    return dict(grouped)


def print_summary(records: List[EdgeTransitRecord]):
    """전체 요약 출력"""
    if not records:
        print("No records found.")
        return

    veh_ids = set(r.veh_id for r in records)
    edge_ids = set(r.edge_id for r in records)
    fab_ids = set(r.fab_id for r in records)

    total_distance = sum(r.edge_length for r in records)
    total_transit_time = sum(r.transit_time for r in records)

    min_ts = min(r.timestamp for r in records)
    max_ts = max(r.timestamp for r in records)

    print("=" * 60)
    print("LOG SUMMARY")
    print("=" * 60)
    print(f"Total records     : {len(records):,}")
    print(f"Unique vehicles   : {len(veh_ids):,}")
    print(f"Unique edges      : {len(edge_ids):,}")
    print(f"Fab IDs           : {sorted(fab_ids)}")
    print(f"Time range        : {min_ts:,}ms ~ {max_ts:,}ms ({(max_ts-min_ts)/1000:.1f}s)")
    print(f"Total distance    : {total_distance:,.2f}m")
    print(f"Total transit time: {total_transit_time:,}ms ({total_transit_time/1000:.1f}s)")
    if total_transit_time > 0:
        avg_speed = total_distance / (total_transit_time / 1000)
        print(f"Average speed     : {avg_speed:.2f}m/s")
    print("=" * 60)


def print_veh_summary(records: List[EdgeTransitRecord], veh_id: Optional[int] = None):
    """차량별 요약 출력"""
    grouped = group_by_veh(records)

    if veh_id is not None:
        if veh_id not in grouped:
            print(f"Vehicle {veh_id} not found.")
            return
        grouped = {veh_id: grouped[veh_id]}

    print("\n" + "=" * 60)
    print("VEHICLE SUMMARY")
    print("=" * 60)
    print(f"{'VehID':>8} {'Records':>8} {'Distance':>12} {'Time(ms)':>10} {'Avg Speed':>10}")
    print("-" * 60)

    for vid in sorted(grouped.keys()):
        veh_records = grouped[vid]
        total_dist = sum(r.edge_length for r in veh_records)
        total_time = sum(r.transit_time for r in veh_records)
        avg_speed = total_dist / (total_time / 1000) if total_time > 0 else 0

        print(f"{vid:>8} {len(veh_records):>8} {total_dist:>12.2f}m {total_time:>10,} {avg_speed:>9.2f}m/s")


def print_edge_summary(records: List[EdgeTransitRecord], top_n: int = 20):
    """엣지별 통계 출력 (통과 횟수 기준 상위)"""
    grouped = group_by_edge(records)

    print("\n" + "=" * 60)
    print(f"EDGE SUMMARY (Top {top_n} by transit count)")
    print("=" * 60)
    print(f"{'EdgeID':>8} {'Count':>8} {'Length':>10} {'Avg Time':>10} {'Avg Speed':>10}")
    print("-" * 60)

    sorted_edges = sorted(grouped.items(), key=lambda x: len(x[1]), reverse=True)[:top_n]

    for edge_id, edge_records in sorted_edges:
        count = len(edge_records)
        length = edge_records[0].edge_length
        avg_time = sum(r.transit_time for r in edge_records) / count
        avg_speed = length / (avg_time / 1000) if avg_time > 0 else 0

        print(f"{edge_id:>8} {count:>8} {length:>10.2f}m {avg_time:>9.1f}ms {avg_speed:>9.2f}m/s")


def print_records(records: List[EdgeTransitRecord], limit: int = 100):
    """레코드 목록 출력"""
    print("\n" + "=" * 60)
    print(f"RECORDS (showing {min(limit, len(records))} of {len(records)})")
    print("=" * 60)

    for r in records[:limit]:
        print(r)


def split_by_veh(records: List[EdgeTransitRecord], output_dir: Path):
    """vehId별로 파일 분리 저장"""
    output_dir.mkdir(parents=True, exist_ok=True)
    grouped = group_by_veh(records)

    for veh_id, veh_records in grouped.items():
        output_path = output_dir / f"veh_{veh_id}.bin"
        with open(output_path, 'wb') as f:
            for r in veh_records:
                data = struct.pack(
                    RECORD_FORMAT,
                    r.timestamp, r.worker_id, r.fab_id, r.edge_id,
                    r.veh_id, r.enter_time, r.exit_time, r.edge_length, r.edge_type
                )
                f.write(data)
        print(f"Saved: {output_path} ({len(veh_records)} records)")


def export_csv(records: List[EdgeTransitRecord], output_path: Path):
    """CSV로 내보내기"""
    with open(output_path, 'w') as f:
        f.write("timestamp,worker_id,fab_id,edge_id,veh_id,enter_time,exit_time,edge_length,edge_type,transit_time,speed\n")
        for r in records:
            f.write(f"{r.timestamp},{r.worker_id},{r.fab_id},{r.edge_id},{r.veh_id},"
                    f"{r.enter_time},{r.exit_time},{r.edge_length:.4f},{r.edge_type_name},"
                    f"{r.transit_time},{r.speed:.4f}\n")
    print(f"Exported to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="VPS Edge Transit Log Parser")
    parser.add_argument("log_file", type=Path, help="로그 파일 경로 (.bin)")
    parser.add_argument("--veh", type=int, help="특정 차량 ID만 필터링")
    parser.add_argument("--edge", type=int, help="특정 엣지 ID만 필터링")
    parser.add_argument("--summary", action="store_true", help="요약만 출력")
    parser.add_argument("--veh-summary", action="store_true", help="차량별 요약")
    parser.add_argument("--edge-summary", action="store_true", help="엣지별 요약")
    parser.add_argument("--records", action="store_true", help="레코드 목록 출력")
    parser.add_argument("--limit", type=int, default=100, help="레코드 출력 제한 (default: 100)")
    parser.add_argument("--split-veh", type=Path, help="vehId별로 파일 분리 (출력 디렉토리)")
    parser.add_argument("--csv", type=Path, help="CSV로 내보내기")

    args = parser.parse_args()

    if not args.log_file.exists():
        print(f"Error: File not found: {args.log_file}")
        return 1

    print(f"Parsing: {args.log_file}")
    records = parse_log_file(args.log_file)
    print(f"Loaded {len(records):,} records")

    # 필터링
    if args.veh is not None:
        records = [r for r in records if r.veh_id == args.veh]
        print(f"Filtered to {len(records):,} records for veh={args.veh}")

    if args.edge is not None:
        records = [r for r in records if r.edge_id == args.edge]
        print(f"Filtered to {len(records):,} records for edge={args.edge}")

    # 출력
    if args.split_veh:
        split_by_veh(records, args.split_veh)
    elif args.csv:
        export_csv(records, args.csv)
    else:
        print_summary(records)

        if args.veh_summary:
            print_veh_summary(records)

        if args.edge_summary:
            print_edge_summary(records)

        if args.records:
            print_records(records, args.limit)

    return 0


if __name__ == "__main__":
    exit(main())
