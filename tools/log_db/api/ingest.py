"""binary batch 파싱 + DB batch INSERT

protocol.ts의 RECORD_SIZE / struct 포맷 기반.
"""

import struct

# ---------------------------------------------------------------------------
# Event type → (record_size, struct_format, table_name, columns)
# struct format: little-endian (<)
#   i = int32, I = uint32, h = short(int16), H = ushort, b = byte, f = float32
# ---------------------------------------------------------------------------

# ML_EDGE_TRANSIT = 3, 24B: ts(i4) vehId(i4) edgeId(i4) enterTs(i4) exitTs(i4) edgeLen(f4)
# ML_LOCK = 4, 16B: ts(i4) vehId(i4) nodeIdx(h2) eventType(b1) pad(b1) waitMs(i4)
# DEV_TRANSFER = 13, 16B: ts(i4) vehId(i4) fromEdge(i4) toEdge(i4)
# DEV_PATH = 11, 16B: ts(i4) vehId(i4) destEdge(i4) pathLen(i4)

EVENT_CONFIG = {
    # ML_EDGE_TRANSIT (24B): all Uint32 except edgeLen(Float32)
    3: {
        "size": 24,
        "fmt": "<IIIIIf",
        "table": "ml_edge_transit",
        "columns": ["ts", "veh_id", "edge_id", "enter_ts", "exit_ts", "edge_len"],
    },
    # ML_LOCK (16B): Uint32 Uint32 Uint16 Uint8 Uint8(pad) Uint32
    4: {
        "size": 16,
        "fmt": "<IIHBBI",
        "table": "ml_lock",
        "columns": ["ts", "veh_id", "node_idx", "event_type", "_pad", "wait_ms"],
    },
    # ML_REPLAY_SNAPSHOT (36B): Uint32 Uint32 Float32×5 Uint32 Float32 Float32 Uint32
    5: {
        "size": 36,
        "fmt": "<IIfffIffI",
        "table": "ml_replay_snapshot",
        "columns": ["ts", "veh_id", "x", "y", "z", "edge_idx", "ratio", "speed", "status"],
    },
    # DEV_PATH (16B): all Uint32
    11: {
        "size": 16,
        "fmt": "<IIII",
        "table": "dev_path",
        "columns": ["ts", "veh_id", "dest_edge", "path_len"],
    },
    # DEV_TRANSFER (16B): all Uint32
    13: {
        "size": 16,
        "fmt": "<IIII",
        "table": "dev_transfer",
        "columns": ["ts", "veh_id", "from_edge", "to_edge"],
    },
}


def parse_and_insert(conn, session_id: str, event_type: int, data: bytes) -> int:
    """binary data를 파싱하여 DB에 batch INSERT. 삽입된 레코드 수 반환."""

    cfg = EVENT_CONFIG.get(event_type)
    if cfg is None:
        raise ValueError(f"unknown event_type: {event_type}")

    record_size = cfg["size"]
    fmt = cfg["fmt"]
    table = cfg["table"]
    columns = cfg["columns"]

    if len(data) % record_size != 0:
        raise ValueError(
            f"data size {len(data)} not divisible by record_size {record_size}"
        )

    record_count = len(data) // record_size
    if record_count == 0:
        return 0

    # pad 컬럼 제외
    insert_columns = [c for c in columns if not c.startswith("_")]
    placeholders = ", ".join(["%s"] * (len(insert_columns) + 1))  # +1 for session_id
    col_str = ", ".join(["session_id"] + insert_columns)

    sql = f"INSERT INTO {table} ({col_str}) VALUES ({placeholders})"

    rows = []
    for i in range(record_count):
        offset = i * record_size
        values = struct.unpack_from(fmt, data, offset)
        # pad 컬럼 제외한 값만 추출
        row = [session_id]
        for col, val in zip(columns, values):
            if not col.startswith("_"):
                row.append(val)
        rows.append(tuple(row))

    with conn.cursor() as cur:
        cur.executemany(sql, rows)

    return record_count
