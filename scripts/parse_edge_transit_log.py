#!/usr/bin/env python3
"""
Edge Transit Log Parser

바이너리 로그 파일(.bin)을 읽어서 분석하는 스크립트.
numpy와 polars를 사용하여 Zero-Copy로 대용량 파일도 빠르게 처리.

Usage:
    python parse_edge_transit_log.py <log_file.bin> [--output csv|parquet|summary]

Record Format (28 bytes):
    | Field       | Type    | Size    | Offset |
    |-------------|---------|---------|--------|
    | timestamp   | Uint32  | 4 bytes | 0      |
    | workerId    | Uint8   | 1 byte  | 4      |
    | fabId       | Uint8   | 1 byte  | 5      |
    | edgeId      | Uint16  | 2 bytes | 6      |
    | vehId       | Uint32  | 4 bytes | 8      |
    | enterTime   | Uint32  | 4 bytes | 12     |
    | exitTime    | Uint32  | 4 bytes | 16     |
    | edgeLength  | Float32 | 4 bytes | 20     |
    | edgeType    | Uint8   | 1 byte  | 24     |
    | padding     | Uint8x3 | 3 bytes | 25     |
"""

import argparse
import sys
from pathlib import Path

import numpy as np

try:
    import polars as pl
    HAS_POLARS = True
except ImportError:
    HAS_POLARS = False
    print("Warning: polars not installed, falling back to pandas")
    import pandas as pd

# Record structure
RECORD_SIZE = 28
RECORD_DTYPE = np.dtype([
    ('timestamp', '<u4'),    # Little-endian Uint32
    ('workerId', 'u1'),      # Uint8
    ('fabId', 'u1'),         # Uint8
    ('edgeId', '<u2'),       # Little-endian Uint16
    ('vehId', '<u4'),        # Little-endian Uint32
    ('enterTime', '<u4'),    # Little-endian Uint32
    ('exitTime', '<u4'),     # Little-endian Uint32
    ('edgeLength', '<f4'),   # Little-endian Float32
    ('edgeType', 'u1'),      # Uint8
    ('_pad1', 'u1'),         # Padding
    ('_pad2', 'u1'),         # Padding
    ('_pad3', 'u1'),         # Padding
])

EDGE_TYPE_NAMES = {
    0: "LINEAR",
    1: "CURVE_90",
    2: "CURVE_180",
    3: "CURVE_CSC",
    4: "S_CURVE",
    5: "LEFT_CURVE",
    6: "RIGHT_CURVE",
}


def load_log(filepath: str) -> np.ndarray:
    """Load binary log file as numpy structured array (memory-mapped for large files)."""
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Log file not found: {filepath}")

    file_size = path.stat().st_size
    record_count = file_size // RECORD_SIZE

    if file_size % RECORD_SIZE != 0:
        print(f"Warning: File size ({file_size}) is not a multiple of record size ({RECORD_SIZE})")
        print(f"  Expected: {record_count * RECORD_SIZE} bytes, extra: {file_size % RECORD_SIZE} bytes")

    # Use memory mapping for large files
    if file_size > 100 * 1024 * 1024:  # > 100MB
        data = np.memmap(filepath, dtype=RECORD_DTYPE, mode='r', shape=(record_count,))
    else:
        data = np.fromfile(filepath, dtype=RECORD_DTYPE, count=record_count)

    return data


def to_dataframe(data: np.ndarray):
    """Convert numpy array to DataFrame (Polars or Pandas)."""
    # Calculate travel time
    travel_time = data['exitTime'].astype(np.int64) - data['enterTime'].astype(np.int64)

    if HAS_POLARS:
        df = pl.DataFrame({
            'timestamp': data['timestamp'],
            'workerId': data['workerId'],
            'fabId': data['fabId'],
            'edgeId': data['edgeId'],
            'vehId': data['vehId'],
            'enterTime': data['enterTime'],
            'exitTime': data['exitTime'],
            'travelTime': travel_time,
            'edgeLength': data['edgeLength'],
            'edgeType': data['edgeType'],
        })
    else:
        df = pd.DataFrame({
            'timestamp': data['timestamp'],
            'workerId': data['workerId'],
            'fabId': data['fabId'],
            'edgeId': data['edgeId'],
            'vehId': data['vehId'],
            'enterTime': data['enterTime'],
            'exitTime': data['exitTime'],
            'travelTime': travel_time,
            'edgeLength': data['edgeLength'],
            'edgeType': data['edgeType'],
        })

    return df


def print_summary(df, data: np.ndarray):
    """Print summary statistics."""
    record_count = len(data)
    print(f"\n{'='*60}")
    print("Edge Transit Log Summary")
    print(f"{'='*60}")
    print(f"Total Records: {record_count:,}")
    print(f"File Size: {record_count * RECORD_SIZE / 1024 / 1024:.2f} MB")

    if record_count == 0:
        print("No records to analyze.")
        return

    print(f"\n--- Time Range ---")
    print(f"First timestamp: {data['timestamp'].min()} ms")
    print(f"Last timestamp:  {data['timestamp'].max()} ms")
    duration_sec = (data['timestamp'].max() - data['timestamp'].min()) / 1000
    print(f"Duration: {duration_sec:.2f} seconds")

    print(f"\n--- Vehicle Stats ---")
    unique_vehicles = np.unique(data['vehId'])
    print(f"Unique Vehicles: {len(unique_vehicles):,}")

    print(f"\n--- Edge Stats ---")
    unique_edges = np.unique(data['edgeId'])
    print(f"Unique Edges: {len(unique_edges):,}")

    print(f"\n--- Worker/Fab Distribution ---")
    unique_workers = np.unique(data['workerId'])
    unique_fabs = np.unique(data['fabId'])
    print(f"Workers: {list(unique_workers)}")
    print(f"Fabs: {list(unique_fabs)}")

    print(f"\n--- Travel Time Stats (ms) ---")
    travel_times = data['exitTime'].astype(np.int64) - data['enterTime'].astype(np.int64)
    valid_times = travel_times[travel_times > 0]
    if len(valid_times) > 0:
        print(f"Min:    {valid_times.min():,.0f}")
        print(f"Max:    {valid_times.max():,.0f}")
        print(f"Mean:   {valid_times.mean():,.2f}")
        print(f"Median: {np.median(valid_times):,.2f}")
        print(f"Std:    {valid_times.std():,.2f}")
    else:
        print("No valid travel times found.")

    print(f"\n--- Edge Type Distribution ---")
    edge_types, counts = np.unique(data['edgeType'], return_counts=True)
    for et, cnt in zip(edge_types, counts):
        type_name = EDGE_TYPE_NAMES.get(et, f"UNKNOWN({et})")
        pct = cnt / record_count * 100
        print(f"  {type_name}: {cnt:,} ({pct:.1f}%)")

    print(f"\n{'='*60}")


def export_csv(df, output_path: str):
    """Export to CSV."""
    if HAS_POLARS:
        df.write_csv(output_path)
    else:
        df.to_csv(output_path, index=False)
    print(f"Exported to: {output_path}")


def export_parquet(df, output_path: str):
    """Export to Parquet (efficient columnar format)."""
    if HAS_POLARS:
        df.write_parquet(output_path)
    else:
        df.to_parquet(output_path, index=False)
    print(f"Exported to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Parse Edge Transit binary log files")
    parser.add_argument("logfile", help="Path to the binary log file (.bin)")
    parser.add_argument(
        "--output", "-o",
        choices=["csv", "parquet", "summary"],
        default="summary",
        help="Output format (default: summary)"
    )
    parser.add_argument(
        "--outfile", "-f",
        help="Output file path (auto-generated if not specified)"
    )

    args = parser.parse_args()

    try:
        print(f"Loading: {args.logfile}")
        data = load_log(args.logfile)
        print(f"Loaded {len(data):,} records")

        df = to_dataframe(data)

        if args.output == "summary":
            print_summary(df, data)
        elif args.output == "csv":
            out_path = args.outfile or args.logfile.replace('.bin', '.csv')
            export_csv(df, out_path)
        elif args.output == "parquet":
            out_path = args.outfile or args.logfile.replace('.bin', '.parquet')
            export_parquet(df, out_path)

    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
