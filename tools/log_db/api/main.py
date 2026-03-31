"""VPS Log DB — FastAPI 서버 (port 8200) + MQTT subscriber (tcp://localhost:9883)"""

from contextlib import asynccontextmanager
from functools import partial
import asyncio
import json
import threading

import paho.mqtt.client as mqtt
import psycopg2
import psycopg2.pool
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from ingest import parse_and_insert

# ---------------------------------------------------------------------------
# DB connection pool (ThreadedConnectionPool for thread-safety)
# ---------------------------------------------------------------------------

pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _get_conn():
    return pool.getconn()


def _put_conn(conn):
    pool.putconn(conn)


async def run_in_thread(fn, *args):
    """동기 DB 작업을 스레드풀에서 실행 (이벤트 루프 블로킹 방지)"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(fn, *args))


# ---------------------------------------------------------------------------
# MQTT subscriber
# ---------------------------------------------------------------------------

MQTT_BROKER_HOST = "localhost"
MQTT_BROKER_PORT = 9883
MQTT_TOPIC_LOGS = "VPS/logs/+/+"       # VPS/logs/{session_id}/{event_type}
MQTT_TOPIC_SESSION = "VPS/logs/session" # 세션 등록

mqtt_client: mqtt.Client | None = None


def _on_mqtt_connect(client, userdata, flags, reason_code, properties=None):
    print(f"[mqtt] connected (rc={reason_code})")
    client.subscribe(MQTT_TOPIC_LOGS, qos=1)
    client.subscribe(MQTT_TOPIC_SESSION, qos=1)
    print(f"[mqtt] subscribed: {MQTT_TOPIC_LOGS}, {MQTT_TOPIC_SESSION}")


def _on_mqtt_message(client, userdata, msg):
    """MQTT 메시지 수신 → DB INSERT"""
    try:
        topic_parts = msg.topic.split("/")

        # 세션 등록: VPS/logs/session
        if msg.topic == MQTT_TOPIC_SESSION:
            body = json.loads(msg.payload)
            _handle_session(body)
            return

        # 로그 데이터: VPS/logs/{session_id}/{event_type}
        if len(topic_parts) == 4 and topic_parts[0] == "VPS" and topic_parts[1] == "logs":
            session_id = topic_parts[2]
            event_type = int(topic_parts[3])
            data = bytes(msg.payload)
            _handle_log_ingest(session_id, event_type, data)

    except Exception as e:
        print(f"[mqtt] error processing message on {msg.topic}: {e}")


def _handle_session(body: dict):
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO sessions (session_id, mode, vehicle_count, map_name, note)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (session_id) DO NOTHING""",
                (body["session_id"], body.get("mode", "ml"),
                 body.get("vehicle_count"), body.get("map_name"), body.get("note")),
            )
        conn.commit()
        print(f"[mqtt] session registered: {body['session_id']}")
    except Exception as e:
        conn.rollback()
        print(f"[mqtt] session error: {e}")
    finally:
        _put_conn(conn)


def _handle_log_ingest(session_id: str, event_type: int, data: bytes):
    if not data:
        return
    conn = _get_conn()
    try:
        count = parse_and_insert(conn, session_id, event_type, data)
        conn.commit()
        if count > 0:
            print(f"[mqtt] ingested {count} records (session={session_id}, event={event_type})")
    except Exception as e:
        conn.rollback()
        print(f"[mqtt] ingest error: {e}")
    finally:
        _put_conn(conn)


def _start_mqtt():
    global mqtt_client
    mqtt_client = mqtt.Client(
        client_id="vps_logdb_subscriber",
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    )
    mqtt_client.on_connect = _on_mqtt_connect
    mqtt_client.on_message = _on_mqtt_message
    mqtt_client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=60)
    mqtt_client.loop_start()
    print(f"[mqtt] connecting to {MQTT_BROKER_HOST}:{MQTT_BROKER_PORT}")


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_app: FastAPI):
    global pool
    pool = psycopg2.pool.ThreadedConnectionPool(
        minconn=2,
        maxconn=8,
        dbname="vps_logs",
        user="vps",
        password="vps",
        host="localhost",
        port=5433,
    )
    print("[log_db] PostgreSQL pool ready")

    _start_mqtt()

    yield

    if mqtt_client:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()
        print("[mqtt] disconnected")
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


@app.middleware("http")
async def add_corp_header(request, call_next):
    response = await call_next(request)
    response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
    return response

# ---------------------------------------------------------------------------
# HTTP Routes (Query APIs — 조회용만 유지)
# ---------------------------------------------------------------------------


def _query(sql, params=()):
    """동기 쿼리 실행 → list[dict] 반환"""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        _put_conn(conn)


@app.get("/api/sessions")
async def list_sessions():
    """세션 목록 (최신순)"""
    return await run_in_thread(
        _query,
        "SELECT session_id, started_at, mode, vehicle_count, map_name, note "
        "FROM sessions ORDER BY started_at DESC LIMIT 50",
    )


@app.get("/api/vehicle/{veh_id}/snapshots")
async def vehicle_snapshots(veh_id: int, session_id: str, from_ts: int = 0, to_ts: int = 2147483647, limit: int = 5000):
    """차량 위치/속도 이력 (replay_snapshot)"""
    return await run_in_thread(
        _query,
        "SELECT ts, x, y, z, edge_idx, ratio, speed, status "
        "FROM ml_replay_snapshot "
        "WHERE session_id = %s AND veh_id = %s AND ts BETWEEN %s AND %s "
        "ORDER BY ts LIMIT %s",
        (session_id, veh_id, from_ts, to_ts, limit),
    )


@app.get("/api/vehicle/{veh_id}/edges")
async def vehicle_edges(veh_id: int, session_id: str, limit: int = 5000):
    """차량 edge 통과 이력"""
    return await run_in_thread(
        _query,
        "SELECT ts, edge_id, enter_ts, exit_ts, edge_len "
        "FROM ml_edge_transit "
        "WHERE session_id = %s AND veh_id = %s "
        "ORDER BY ts LIMIT %s",
        (session_id, veh_id, limit),
    )


@app.get("/api/lock/by-node/{node_idx}")
async def lock_by_node(node_idx: int, session_id: str, limit: int = 5000):
    """노드별 lock 이벤트 이력"""
    return await run_in_thread(
        _query,
        "SELECT ts, veh_id, event_type, wait_ms "
        "FROM ml_lock "
        "WHERE session_id = %s AND node_idx = %s "
        "ORDER BY ts LIMIT %s",
        (session_id, node_idx, limit),
    )


@app.get("/api/lock/by-vehicle/{veh_id}")
async def lock_by_vehicle(veh_id: int, session_id: str, limit: int = 5000):
    """차량별 lock 대기 이력"""
    return await run_in_thread(
        _query,
        "SELECT ts, node_idx, event_type, wait_ms "
        "FROM ml_lock "
        "WHERE session_id = %s AND veh_id = %s "
        "ORDER BY ts LIMIT %s",
        (session_id, veh_id, limit),
    )


@app.get("/api/lock/top-wait")
async def lock_top_wait(session_id: str, limit: int = 20):
    """평균 대기시간 Top N 노드"""
    return await run_in_thread(
        _query,
        "SELECT node_idx, COUNT(*) as cnt, AVG(wait_ms) as avg_wait_ms, MAX(wait_ms) as max_wait_ms "
        "FROM ml_lock "
        "WHERE session_id = %s AND event_type = 3 AND wait_ms > 0 "
        "GROUP BY node_idx ORDER BY avg_wait_ms DESC LIMIT %s",
        (session_id, limit),
    )


@app.get("/health")
async def health():
    return {"status": "ok", "mqtt": mqtt_client.is_connected() if mqtt_client else False}
