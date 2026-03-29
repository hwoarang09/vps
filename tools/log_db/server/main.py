"""VPS Log DB — FastAPI 서버 (port 8100)"""

from contextlib import asynccontextmanager

import psycopg2
import psycopg2.pool
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from ingest import parse_and_insert

# ---------------------------------------------------------------------------
# DB connection pool
# ---------------------------------------------------------------------------

pool: psycopg2.pool.SimpleConnectionPool | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global pool
    pool = psycopg2.pool.SimpleConnectionPool(
        minconn=1,
        maxconn=4,
        dbname="vps_logs",
        user="vps",
        password="vps",
        host="localhost",
        port=5432,
    )
    print("[log_db] PostgreSQL pool ready")
    yield
    if pool:
        pool.closeall()
        print("[log_db] PostgreSQL pool closed")


app = FastAPI(title="VPS Log DB", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.post("/sessions")
async def create_session(request: Request):
    """세션 등록 (시뮬 시작 시)"""
    body = await request.json()
    session_id = body["session_id"]
    mode = body.get("mode", "ml")
    vehicle_count = body.get("vehicle_count")
    map_name = body.get("map_name")
    note = body.get("note")

    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO sessions (session_id, mode, vehicle_count, map_name, note)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (session_id) DO NOTHING""",
                (session_id, mode, vehicle_count, map_name, note),
            )
        conn.commit()
    finally:
        pool.putconn(conn)

    return {"ok": True, "session_id": session_id}


@app.post("/logs/ingest")
async def ingest_logs(request: Request):
    """binary batch 수신 → DB INSERT

    Headers:
      X-Session-Id: session_id
      X-Event-Type: event_type (int)
    """
    session_id = request.headers.get("X-Session-Id")
    event_type = int(request.headers.get("X-Event-Type", "0"))
    data = await request.body()

    if not session_id or not event_type or not data:
        return Response(status_code=400, content="missing session_id, event_type, or body")

    conn = pool.getconn()
    try:
        count = parse_and_insert(conn, session_id, event_type, data)
        conn.commit()
    except Exception as e:
        conn.rollback()
        return Response(status_code=500, content=str(e))
    finally:
        pool.putconn(conn)

    return {"ok": True, "inserted": count}


# ---------------------------------------------------------------------------
# Query APIs
# ---------------------------------------------------------------------------


@app.get("/api/sessions")
async def list_sessions():
    """세션 목록 (최신순)"""
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT session_id, started_at, mode, vehicle_count, map_name, note "
                "FROM sessions ORDER BY started_at DESC LIMIT 50"
            )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        pool.putconn(conn)


@app.get("/api/vehicle/{veh_id}/snapshots")
async def vehicle_snapshots(veh_id: int, session_id: str, from_ts: int = 0, to_ts: int = 2147483647, limit: int = 5000):
    """차량 위치/속도 이력 (replay_snapshot)"""
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ts, x, y, z, edge_idx, ratio, speed, status "
                "FROM ml_replay_snapshot "
                "WHERE session_id = %s AND veh_id = %s AND ts BETWEEN %s AND %s "
                "ORDER BY ts LIMIT %s",
                (session_id, veh_id, from_ts, to_ts, limit),
            )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        pool.putconn(conn)


@app.get("/api/vehicle/{veh_id}/edges")
async def vehicle_edges(veh_id: int, session_id: str, limit: int = 5000):
    """차량 edge 통과 이력"""
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ts, edge_id, enter_ts, exit_ts, edge_len "
                "FROM ml_edge_transit "
                "WHERE session_id = %s AND veh_id = %s "
                "ORDER BY ts LIMIT %s",
                (session_id, veh_id, limit),
            )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        pool.putconn(conn)


@app.get("/api/lock/by-node/{node_idx}")
async def lock_by_node(node_idx: int, session_id: str, limit: int = 5000):
    """노드별 lock 이벤트 이력"""
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ts, veh_id, event_type, wait_ms "
                "FROM ml_lock "
                "WHERE session_id = %s AND node_idx = %s "
                "ORDER BY ts LIMIT %s",
                (session_id, node_idx, limit),
            )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        pool.putconn(conn)


@app.get("/api/lock/by-vehicle/{veh_id}")
async def lock_by_vehicle(veh_id: int, session_id: str, limit: int = 5000):
    """차량별 lock 대기 이력"""
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ts, node_idx, event_type, wait_ms "
                "FROM ml_lock "
                "WHERE session_id = %s AND veh_id = %s "
                "ORDER BY ts LIMIT %s",
                (session_id, veh_id, limit),
            )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        pool.putconn(conn)


@app.get("/api/lock/top-wait")
async def lock_top_wait(session_id: str, limit: int = 20):
    """평균 대기시간 Top N 노드"""
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT node_idx, COUNT(*) as cnt, AVG(wait_ms) as avg_wait_ms, MAX(wait_ms) as max_wait_ms "
                "FROM ml_lock "
                "WHERE session_id = %s AND event_type = 3 AND wait_ms > 0 "
                "GROUP BY node_idx ORDER BY avg_wait_ms DESC LIMIT %s",
                (session_id, limit),
            )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        pool.putconn(conn)


@app.get("/health")
async def health():
    return {"status": "ok"}
