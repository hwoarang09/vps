#!/usr/bin/env python3
"""
Simulation Text Log Parser for VPS Simulator
텍스트 로그 파일 (.txt) 파싱 및 분석 도구
1GB+ 파일 지원 (스트리밍 처리)
"""

import re
import argparse
from pathlib import Path
from dataclasses import dataclass
from typing import Optional, Iterator, List, Dict, Set
from collections import defaultdict
from datetime import datetime
import sys

# 로그 라인 정규표현식
# [00:05:08.469] [INFO ] [global] [LockMgr.ts:238] [LockMgr] message
LOG_PATTERN = re.compile(
    r'\[(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*'  # timestamp
    r'\[(\w+)\s*\]\s*'                      # level (INFO, DEBUG, WARN, ERROR)
    r'\[([^\]]+)\]\s*'                      # scope (global, veh:N)
    r'\[([^\]]+)\]\s*'                      # source (file:line)
    r'\[([^\]]+)\]\s*'                      # tag
    r'(.*)'                                 # message
)

# veh:N 패턴
VEH_PATTERN = re.compile(r'veh:(\d+)')


@dataclass
class LogEntry:
    timestamp: str      # HH:MM:SS.mmm
    level: str          # DEBUG, INFO, WARN, ERROR
    scope: str          # global, veh:N
    source: str         # file:line
    tag: str            # [Tag]
    message: str        # 메시지 내용
    line_num: int       # 원본 라인 번호

    @property
    def veh_id(self) -> Optional[int]:
        """veh:N에서 N 추출"""
        match = VEH_PATTERN.match(self.scope)
        return int(match.group(1)) if match else None

    @property
    def is_global(self) -> bool:
        return self.scope == "global"

    @property
    def file_name(self) -> str:
        """source에서 파일명만 추출"""
        return self.source.split(':')[0] if ':' in self.source else self.source

    @property
    def time_ms(self) -> int:
        """타임스탬프를 밀리초로 변환"""
        parts = self.timestamp.split(':')
        h, m = int(parts[0]), int(parts[1])
        s_parts = parts[2].split('.')
        s, ms = int(s_parts[0]), int(s_parts[1])
        return ((h * 60 + m) * 60 + s) * 1000 + ms

    def __str__(self) -> str:
        return f"[{self.timestamp}] [{self.level:5}] [{self.scope}] [{self.source}] [{self.tag}] {self.message}"


def parse_line(line: str, line_num: int) -> Optional[LogEntry]:
    """단일 라인 파싱"""
    match = LOG_PATTERN.match(line.strip())
    if not match:
        return None

    return LogEntry(
        timestamp=match.group(1),
        level=match.group(2).strip(),
        scope=match.group(3),
        source=match.group(4),
        tag=match.group(5),
        message=match.group(6),
        line_num=line_num
    )


def stream_log_file(file_path: Path) -> Iterator[LogEntry]:
    """로그 파일 스트리밍 파싱 (메모리 효율)"""
    with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
        for line_num, line in enumerate(f, 1):
            entry = parse_line(line, line_num)
            if entry:
                yield entry


def filter_entries(
    entries: Iterator[LogEntry],
    levels: Optional[Set[str]] = None,
    veh_ids: Optional[Set[int]] = None,
    tags: Optional[Set[str]] = None,
    files: Optional[Set[str]] = None,
    include_global: bool = True,
    time_start: Optional[str] = None,
    time_end: Optional[str] = None,
    search: Optional[str] = None,
) -> Iterator[LogEntry]:
    """필터링된 엔트리 스트리밍"""

    time_start_ms = None
    time_end_ms = None

    if time_start:
        parts = time_start.split(':')
        if len(parts) >= 2:
            h, m = int(parts[0]), int(parts[1])
            s = int(parts[2].split('.')[0]) if len(parts) > 2 else 0
            time_start_ms = ((h * 60 + m) * 60 + s) * 1000

    if time_end:
        parts = time_end.split(':')
        if len(parts) >= 2:
            h, m = int(parts[0]), int(parts[1])
            s = int(parts[2].split('.')[0]) if len(parts) > 2 else 0
            time_end_ms = ((h * 60 + m) * 60 + s) * 1000

    for entry in entries:
        # Level filter
        if levels and entry.level not in levels:
            continue

        # Veh filter
        if veh_ids is not None:
            if entry.is_global:
                if not include_global:
                    continue
            elif entry.veh_id not in veh_ids:
                continue

        # Tag filter
        if tags and entry.tag not in tags:
            continue

        # File filter
        if files and entry.file_name not in files:
            continue

        # Time filter
        if time_start_ms and entry.time_ms < time_start_ms:
            continue
        if time_end_ms and entry.time_ms > time_end_ms:
            continue

        # Search filter
        if search and search.lower() not in entry.message.lower():
            continue

        yield entry


def print_summary(file_path: Path):
    """전체 요약 출력 (스트리밍)"""
    level_counts: Dict[str, int] = defaultdict(int)
    veh_ids: Set[int] = set()
    tags: Set[str] = set()
    files: Set[str] = set()
    total = 0
    first_time = None
    last_time = None

    print(f"Analyzing: {file_path}")
    print("Scanning...", end='', flush=True)

    for entry in stream_log_file(file_path):
        total += 1
        level_counts[entry.level] += 1

        if entry.veh_id is not None:
            veh_ids.add(entry.veh_id)

        tags.add(entry.tag)
        files.add(entry.file_name)

        if first_time is None:
            first_time = entry.timestamp
        last_time = entry.timestamp

        if total % 1000000 == 0:
            print(f"\rScanning... {total:,} lines", end='', flush=True)

    print(f"\rScanning... Done!{' ' * 20}")

    print("\n" + "=" * 60)
    print("LOG SUMMARY")
    print("=" * 60)
    print(f"Total entries     : {total:,}")
    print(f"Time range        : {first_time} ~ {last_time}")
    print(f"Unique vehicles   : {len(veh_ids):,}")
    print(f"Unique tags       : {len(tags)}")
    print(f"Unique files      : {len(files)}")
    print()
    print("Level distribution:")
    for level in ['DEBUG', 'INFO', 'WARN', 'ERROR']:
        count = level_counts.get(level, 0)
        pct = count / total * 100 if total > 0 else 0
        bar = '█' * int(pct / 2)
        print(f"  {level:6}: {count:>12,} ({pct:5.1f}%) {bar}")
    print()
    print(f"Vehicles: {sorted(veh_ids)[:20]}{'...' if len(veh_ids) > 20 else ''}")
    print(f"Tags: {sorted(tags)[:10]}{'...' if len(tags) > 10 else ''}")
    print(f"Files: {sorted(files)[:10]}{'...' if len(files) > 10 else ''}")
    print("=" * 60)


def print_veh_summary(file_path: Path):
    """차량별 요약"""
    veh_counts: Dict[int, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    global_counts: Dict[str, int] = defaultdict(int)
    total = 0

    print(f"Analyzing vehicles: {file_path}")
    print("Scanning...", end='', flush=True)

    for entry in stream_log_file(file_path):
        total += 1
        if entry.veh_id is not None:
            veh_counts[entry.veh_id][entry.level] += 1
        else:
            global_counts[entry.level] += 1

        if total % 1000000 == 0:
            print(f"\rScanning... {total:,} lines", end='', flush=True)

    print(f"\rScanning... Done!{' ' * 20}")

    print("\n" + "=" * 70)
    print("VEHICLE LOG SUMMARY")
    print("=" * 70)
    print(f"{'VehID':>8} {'Total':>10} {'DEBUG':>10} {'INFO':>10} {'WARN':>10} {'ERROR':>10}")
    print("-" * 70)

    # Global first
    g_total = sum(global_counts.values())
    print(f"{'global':>8} {g_total:>10,} {global_counts['DEBUG']:>10,} {global_counts['INFO']:>10,} {global_counts['WARN']:>10,} {global_counts['ERROR']:>10,}")

    # Then vehicles
    for veh_id in sorted(veh_counts.keys()):
        counts = veh_counts[veh_id]
        v_total = sum(counts.values())
        print(f"{veh_id:>8} {v_total:>10,} {counts['DEBUG']:>10,} {counts['INFO']:>10,} {counts['WARN']:>10,} {counts['ERROR']:>10,}")


def print_tag_summary(file_path: Path):
    """태그별 요약"""
    tag_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    total = 0

    print(f"Analyzing tags: {file_path}")
    print("Scanning...", end='', flush=True)

    for entry in stream_log_file(file_path):
        total += 1
        tag_counts[entry.tag][entry.level] += 1

        if total % 1000000 == 0:
            print(f"\rScanning... {total:,} lines", end='', flush=True)

    print(f"\rScanning... Done!{' ' * 20}")

    print("\n" + "=" * 80)
    print("TAG LOG SUMMARY")
    print("=" * 80)
    print(f"{'Tag':<30} {'Total':>10} {'DEBUG':>10} {'INFO':>10} {'WARN':>10} {'ERROR':>10}")
    print("-" * 80)

    sorted_tags = sorted(tag_counts.items(), key=lambda x: sum(x[1].values()), reverse=True)
    for tag, counts in sorted_tags[:30]:
        t_total = sum(counts.values())
        tag_display = tag[:28] + '..' if len(tag) > 30 else tag
        print(f"{tag_display:<30} {t_total:>10,} {counts['DEBUG']:>10,} {counts['INFO']:>10,} {counts['WARN']:>10,} {counts['ERROR']:>10,}")


def print_entries(
    file_path: Path,
    levels: Optional[Set[str]] = None,
    veh_ids: Optional[Set[int]] = None,
    tags: Optional[Set[str]] = None,
    files: Optional[Set[str]] = None,
    include_global: bool = True,
    time_start: Optional[str] = None,
    time_end: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 100,
    tail: bool = False,
):
    """필터링된 로그 출력"""
    entries = stream_log_file(file_path)
    filtered = filter_entries(
        entries, levels, veh_ids, tags, files,
        include_global, time_start, time_end, search
    )

    if tail:
        # tail 모드: 마지막 N개
        buffer = []
        for entry in filtered:
            buffer.append(entry)
            if len(buffer) > limit:
                buffer.pop(0)
        for entry in buffer:
            print(entry)
        print(f"\n--- Showing last {len(buffer)} entries ---")
    else:
        # head 모드: 처음 N개
        count = 0
        for entry in filtered:
            print(entry)
            count += 1
            if count >= limit:
                print(f"\n--- Showing first {limit} entries (use --limit to see more) ---")
                break


def export_veh(file_path: Path, veh_id: int, output_path: Path):
    """특정 차량 로그 추출"""
    entries = stream_log_file(file_path)
    filtered = filter_entries(entries, veh_ids={veh_id}, include_global=False)

    count = 0
    with open(output_path, 'w', encoding='utf-8') as f:
        for entry in filtered:
            f.write(str(entry) + '\n')
            count += 1
            if count % 100000 == 0:
                print(f"\rExporting... {count:,} lines", end='', flush=True)

    print(f"\rExported {count:,} lines to: {output_path}")


def export_filtered(
    file_path: Path,
    output_path: Path,
    levels: Optional[Set[str]] = None,
    veh_ids: Optional[Set[int]] = None,
    tags: Optional[Set[str]] = None,
    time_start: Optional[str] = None,
    time_end: Optional[str] = None,
    search: Optional[str] = None,
):
    """필터링된 로그 파일로 추출"""
    entries = stream_log_file(file_path)
    filtered = filter_entries(
        entries, levels, veh_ids, tags, None, True, time_start, time_end, search
    )

    count = 0
    with open(output_path, 'w', encoding='utf-8') as f:
        for entry in filtered:
            f.write(str(entry) + '\n')
            count += 1
            if count % 100000 == 0:
                print(f"\rExporting... {count:,} lines", end='', flush=True)

    print(f"\rExported {count:,} lines to: {output_path}")


def split_by_veh(file_path: Path, output_dir: Path):
    """veh별로 파일 분리 (스트리밍, 1회 스캔)"""
    output_dir.mkdir(parents=True, exist_ok=True)

    # 파일 핸들 관리
    veh_files: Dict[int, any] = {}
    global_file = None
    veh_counts: Dict[int, int] = defaultdict(int)
    global_count = 0
    total = 0
    skipped = 0

    print(f"Splitting: {file_path}")
    print(f"Output dir: {output_dir}")
    print("Processing...", end='', flush=True)

    try:
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            for line_num, line in enumerate(f, 1):
                total += 1

                entry = parse_line(line, line_num)
                if entry is None:
                    # 파싱 안 되는 라인은 global에 저장
                    if global_file is None:
                        global_file = open(output_dir / "global.txt", 'w', encoding='utf-8')
                    global_file.write(line)
                    skipped += 1
                    continue

                veh_id = entry.veh_id

                if veh_id is not None:
                    # veh별 파일에 저장
                    if veh_id not in veh_files:
                        veh_files[veh_id] = open(output_dir / f"veh_{veh_id}.txt", 'w', encoding='utf-8')
                    veh_files[veh_id].write(str(entry) + '\n')
                    veh_counts[veh_id] += 1
                else:
                    # global 파일에 저장
                    if global_file is None:
                        global_file = open(output_dir / "global.txt", 'w', encoding='utf-8')
                    global_file.write(str(entry) + '\n')
                    global_count += 1

                if total % 1000000 == 0:
                    print(f"\rProcessing... {total:,} lines, {len(veh_files)} vehicles", end='', flush=True)

    finally:
        # 모든 파일 핸들 닫기
        for f in veh_files.values():
            f.close()
        if global_file:
            global_file.close()

    print(f"\rProcessing... Done!{' ' * 30}")
    print()
    print("=" * 60)
    print("SPLIT SUMMARY")
    print("=" * 60)
    print(f"Total lines       : {total:,}")
    print(f"Skipped (unparsed): {skipped:,}")
    print(f"Global logs       : {global_count:,} -> global.txt")
    print(f"Vehicle files     : {len(veh_files)}")
    print()

    # 차량별 통계 (상위 20개)
    sorted_vehs = sorted(veh_counts.items(), key=lambda x: x[1], reverse=True)
    print(f"{'VehID':>8} {'Lines':>12} {'File':<30}")
    print("-" * 60)
    for veh_id, count in sorted_vehs[:20]:
        print(f"{veh_id:>8} {count:>12,} veh_{veh_id}.txt")
    if len(sorted_vehs) > 20:
        print(f"... and {len(sorted_vehs) - 20} more vehicles")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="VPS Simulation Text Log Parser (1GB+ 지원)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # 기본 요약
  %(prog)s sim.txt

  # 차량별 요약
  %(prog)s sim.txt --veh-summary

  # 특정 차량 로그만 보기
  %(prog)s sim.txt --veh 123

  # ERROR/WARN만 보기
  %(prog)s sim.txt --level ERROR WARN

  # 특정 태그만 보기
  %(prog)s sim.txt --tag LockMgr

  # 시간 범위 필터링
  %(prog)s sim.txt --from 00:10:00 --to 00:15:00

  # 메시지 검색
  %(prog)s sim.txt --search "deadlock"

  # 특정 차량 로그 추출
  %(prog)s sim.txt --export-veh 123 --output veh_123.txt

  # 필터링된 로그 추출
  %(prog)s sim.txt --level ERROR WARN --output errors.txt

  # veh별로 파일 분리
  %(prog)s sim.txt --split ./output_dir
"""
    )
    parser.add_argument("log_file", type=Path, help="로그 파일 경로 (.txt)")

    # Summary options
    parser.add_argument("--veh-summary", action="store_true", help="차량별 요약")
    parser.add_argument("--tag-summary", action="store_true", help="태그별 요약")

    # Filter options
    parser.add_argument("--veh", type=int, nargs='+', help="특정 차량 ID 필터")
    parser.add_argument("--level", type=str, nargs='+', choices=['DEBUG', 'INFO', 'WARN', 'ERROR'], help="로그 레벨 필터")
    parser.add_argument("--tag", type=str, nargs='+', help="태그 필터")
    parser.add_argument("--file", type=str, nargs='+', help="소스 파일 필터")
    parser.add_argument("--no-global", action="store_true", help="global 로그 제외")
    parser.add_argument("--from", dest="time_start", type=str, help="시작 시간 (HH:MM:SS)")
    parser.add_argument("--to", dest="time_end", type=str, help="종료 시간 (HH:MM:SS)")
    parser.add_argument("--search", "-s", type=str, help="메시지 검색")

    # Output options
    parser.add_argument("--limit", "-n", type=int, default=100, help="출력 라인 수 (default: 100)")
    parser.add_argument("--tail", action="store_true", help="마지막 N개 출력")
    parser.add_argument("--output", "-o", type=Path, help="출력 파일")
    parser.add_argument("--export-veh", type=int, help="특정 차량 로그 추출")
    parser.add_argument("--split", type=Path, help="veh별로 파일 분리 (출력 디렉토리)")

    args = parser.parse_args()

    if not args.log_file.exists():
        print(f"Error: File not found: {args.log_file}")
        return 1

    # Split by veh
    if args.split:
        split_by_veh(args.log_file, args.split)
        return 0

    # Export specific vehicle
    if args.export_veh is not None:
        output = args.output or Path(f"veh_{args.export_veh}.txt")
        export_veh(args.log_file, args.export_veh, output)
        return 0

    # Export filtered
    if args.output:
        export_filtered(
            args.log_file,
            args.output,
            levels=set(args.level) if args.level else None,
            veh_ids=set(args.veh) if args.veh else None,
            tags=set(args.tag) if args.tag else None,
            time_start=args.time_start,
            time_end=args.time_end,
            search=args.search,
        )
        return 0

    # Summary modes
    if args.veh_summary:
        print_veh_summary(args.log_file)
        return 0

    if args.tag_summary:
        print_tag_summary(args.log_file)
        return 0

    # Any filter specified? Show entries
    has_filter = any([args.veh, args.level, args.tag, args.file,
                      args.time_start, args.time_end, args.search])

    if has_filter:
        print_entries(
            args.log_file,
            levels=set(args.level) if args.level else None,
            veh_ids=set(args.veh) if args.veh else None,
            tags=set(args.tag) if args.tag else None,
            files=set(args.file) if args.file else None,
            include_global=not args.no_global,
            time_start=args.time_start,
            time_end=args.time_end,
            search=args.search,
            limit=args.limit,
            tail=args.tail,
        )
    else:
        # Default: summary
        print_summary(args.log_file)

    return 0


if __name__ == "__main__":
    exit(main())
