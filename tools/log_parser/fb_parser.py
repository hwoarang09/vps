#!/usr/bin/env python3
"""
FlatBuffers Log Parser
Parses FlatBuffers-based dev logs from VPS simulator
"""

import sys
import argparse
from pathlib import Path

# Add generated FlatBuffers code to path
sys.path.append(str(Path(__file__).parent / "generated"))

from VpsDevLog import LogBatch, LogEntry, LogLevel, LogContent
from VpsDevLog import DebugLog, CheckpointLog, EdgeTransitionLog, LockEventLog, ErrorLog, PerfLog


def format_timestamp(ts_ms: float) -> str:
    """Format timestamp as HH:MM:SS.mmm"""
    ts_s = ts_ms / 1000.0
    hours = int(ts_s // 3600)
    minutes = int((ts_s % 3600) // 60)
    seconds = int(ts_s % 60)
    millis = int((ts_ms % 1000))
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"


def format_log_level(level: int) -> str:
    """Format log level as string"""
    levels = ["DEBUG", "INFO", "WARN", "ERROR"]
    return levels[level] if level < len(levels) else f"LEVEL{level}"


def decode_checkpoint_flags(flags: int) -> str:
    """Decode checkpoint flags to human-readable format

    flags = 0 means all flags have been processed and cleared.
    The checkpoint is complete and ready to move to the next one.
    """
    if flags == 0:
        return "COMPLETED"  # All flags processed, ready for next CP

    names = []
    if flags & 0x01:
        names.append("LOCK_REQUEST")
    if flags & 0x02:
        names.append("LOCK_WAIT")
    if flags & 0x04:
        names.append("LOCK_RELEASE")
    if flags & 0x08:
        names.append("MOVE_PREPARE")

    return "|".join(names) if names else f"UNKNOWN({flags})"


def format_edge_name(edge_id: int) -> str:
    """Format edge ID to edge name"""
    return f"E{edge_id}" if edge_id > 0 else "E0(none)"


def parse_log_entry(entry: LogEntry.LogEntry) -> dict:
    """Parse a single log entry"""
    timestamp = entry.Timestamp()
    level = entry.Level()
    location = entry.Location().decode("utf-8") if entry.Location() else "unknown"
    content_type = entry.ContentType()

    result = {
        "timestamp": timestamp,
        "time_str": format_timestamp(timestamp),
        "level": format_log_level(level),
        "location": location,
        "content_type": content_type,
    }

    # Parse content based on type
    if content_type == LogContent.LogContent.DebugLog:
        content = DebugLog.DebugLog()
        content.Init(entry.Content().Bytes, entry.Content().Pos)
        result["veh_id"] = content.VehId()
        result["tag"] = content.Tag().decode("utf-8") if content.Tag() else ""
        result["message"] = content.Message().decode("utf-8") if content.Message() else ""
        result["type_name"] = "DebugLog"

    elif content_type == LogContent.LogContent.CheckpointLog:
        content = CheckpointLog.CheckpointLog()
        content.Init(entry.Content().Bytes, entry.Content().Pos)
        result["veh_id"] = content.VehId()
        result["cp_index"] = content.CpIndex()
        result["edge_id"] = content.EdgeId()
        result["edge_name"] = format_edge_name(content.EdgeId())
        result["ratio"] = content.Ratio()
        result["flags"] = content.Flags()
        result["flags_decoded"] = decode_checkpoint_flags(content.Flags())
        result["action"] = content.Action().decode("utf-8") if content.Action() else ""
        result["details"] = content.Details().decode("utf-8") if content.Details() else ""
        result["type_name"] = "CheckpointLog"

    elif content_type == LogContent.LogContent.EdgeTransitionLog:
        content = EdgeTransitionLog.EdgeTransitionLog()
        content.Init(entry.Content().Bytes, entry.Content().Pos)
        result["veh_id"] = content.VehId()
        result["from_edge"] = content.FromEdge()
        result["from_edge_name"] = format_edge_name(content.FromEdge())
        result["to_edge"] = content.ToEdge()
        result["to_edge_name"] = format_edge_name(content.ToEdge())
        result["next_edges"] = [content.NextEdges(i) for i in range(content.NextEdgesLength())]
        result["path_buf_len"] = content.PathBufLen()
        result["type_name"] = "EdgeTransitionLog"

    elif content_type == LogContent.LogContent.LockEventLog:
        content = LockEventLog.LockEventLog()
        content.Init(entry.Content().Bytes, entry.Content().Pos)
        result["veh_id"] = content.VehId()
        result["lock_id"] = content.LockId()
        result["event_type"] = content.EventType().decode("utf-8") if content.EventType() else ""
        result["edge_id"] = content.EdgeId()
        result["wait_time_ms"] = content.WaitTimeMs()
        result["type_name"] = "LockEventLog"

    elif content_type == LogContent.LogContent.ErrorLog:
        content = ErrorLog.ErrorLog()
        content.Init(entry.Content().Bytes, entry.Content().Pos)
        result["veh_id"] = content.VehId()
        result["error_code"] = content.ErrorCode().decode("utf-8") if content.ErrorCode() else ""
        result["message"] = content.Message().decode("utf-8") if content.Message() else ""
        result["stack_trace"] = content.StackTrace().decode("utf-8") if content.StackTrace() else ""
        result["type_name"] = "ErrorLog"

    elif content_type == LogContent.LogContent.PerfLog:
        content = PerfLog.PerfLog()
        content.Init(entry.Content().Bytes, entry.Content().Pos)
        result["fps"] = content.Fps()
        result["memory_mb"] = content.MemoryMb()
        result["active_vehicles"] = content.ActiveVehicles()
        result["lock_queue_size"] = content.LockQueueSize()
        result["type_name"] = "PerfLog"

    else:
        result["type_name"] = f"Unknown({content_type})"

    return result


def format_log_line(log: dict) -> str:
    """Format log entry as text line"""
    veh_str = f"veh:{log['veh_id']}" if "veh_id" in log and log["veh_id"] > 0 else "global"
    type_str = log.get("type_name", "?")

    line = f"[{log['time_str']}] [{log['level']:5s}] [{veh_str:10s}] [{log['location']}] [{type_str}]"

    # Add type-specific details
    if log["type_name"] == "DebugLog":
        line += f" [{log['tag']}] {log['message']}"
    elif log["type_name"] == "CheckpointLog":
        line += f" CP#{log['cp_index']} {log['edge_name']}@{log['ratio']:.3f} "
        line += f"flags={log['flags']}({log['flags_decoded']}) {log['action']}"
        if log.get("details"):
            line += f" | {log['details']}"
    elif log["type_name"] == "EdgeTransitionLog":
        next_edges_str = ",".join([format_edge_name(e) for e in log['next_edges'][:5]])
        line += f" {log['from_edge_name']}→{log['to_edge_name']} next=[{next_edges_str}] pathLen={log['path_buf_len']}"
    elif log["type_name"] == "LockEventLog":
        edge_name = format_edge_name(log['edge_id'])
        line += f" Lock#{log['lock_id']} {log['event_type']} {edge_name} wait={log['wait_time_ms']}ms"
    elif log["type_name"] == "ErrorLog":
        line += f" [{log['error_code']}] {log['message']}"
    elif log["type_name"] == "PerfLog":
        line += f" FPS={log['fps']:.1f} MEM={log['memory_mb']:.1f}MB VEH={log['active_vehicles']} LOCK={log['lock_queue_size']}"

    return line


def parse_file(file_path: str, args):
    """Parse FlatBuffers log file"""
    with open(file_path, "rb") as f:
        data = f.read()

    # Parse LogBatch
    batch = LogBatch.LogBatch.GetRootAs(data, 0)

    print(f"Session ID: {batch.SessionId().decode('utf-8') if batch.SessionId() else 'N/A'}")
    print(f"Worker ID: {batch.WorkerId()}")
    print(f"Total Entries: {batch.LogsLength()}")
    print("-" * 100)

    # Statistics
    stats = {
        "total": 0,
        "by_level": {},
        "by_type": {},
        "by_veh": {},
    }

    # Parse entries
    for i in range(batch.LogsLength()):
        entry = batch.Logs(i)
        log = parse_log_entry(entry)

        # Update stats
        stats["total"] += 1
        stats["by_level"][log["level"]] = stats["by_level"].get(log["level"], 0) + 1
        stats["by_type"][log["type_name"]] = stats["by_type"].get(log["type_name"], 0) + 1
        if "veh_id" in log:
            stats["by_veh"][log["veh_id"]] = stats["by_veh"].get(log["veh_id"], 0) + 1

        # Filter by vehicle
        if args.veh is not None and log.get("veh_id") != args.veh:
            continue

        # Filter by level
        if args.level and log["level"] not in args.level:
            continue

        # Filter by type
        if args.type and log["type_name"] not in args.type:
            continue

        # Print log
        if not args.summary:
            print(format_log_line(log))

    # Print summary
    if args.summary or args.stats:
        print("\n" + "=" * 100)
        print("SUMMARY:")
        print(f"  Total Entries: {stats['total']}")
        print(f"\n  By Level:")
        for level, count in sorted(stats["by_level"].items()):
            print(f"    {level:8s}: {count:6d}")
        print(f"\n  By Type:")
        for type_name, count in sorted(stats["by_type"].items()):
            print(f"    {type_name:20s}: {count:6d}")
        if not args.no_veh_summary:
            print(f"\n  By Vehicle (top 10):")
            for veh_id, count in sorted(stats["by_veh"].items(), key=lambda x: x[1], reverse=True)[:10]:
                veh_str = f"veh:{veh_id}" if veh_id > 0 else "global"
                print(f"    {veh_str:15s}: {count:6d}")


def main():
    parser = argparse.ArgumentParser(description="Parse FlatBuffers-based VPS dev logs")
    parser.add_argument("file", help="FlatBuffers log file (.bin)")
    parser.add_argument("--veh", type=int, help="Filter by vehicle ID")
    parser.add_argument("--level", nargs="+", choices=["DEBUG", "INFO", "WARN", "ERROR"], help="Filter by log level")
    parser.add_argument("--type", nargs="+", help="Filter by log type (DebugLog, CheckpointLog, etc.)")
    parser.add_argument("--summary", action="store_true", help="Show only summary")
    parser.add_argument("--stats", action="store_true", help="Show statistics at the end")
    parser.add_argument("--no-veh-summary", action="store_true", help="Don't show vehicle summary")

    args = parser.parse_args()

    if not Path(args.file).exists():
        print(f"Error: File not found: {args.file}")
        sys.exit(1)

    parse_file(args.file, args)


if __name__ == "__main__":
    main()
