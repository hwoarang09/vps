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


@app.get("/health")
async def health():
    return {"status": "ok"}
