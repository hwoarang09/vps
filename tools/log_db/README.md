# Log DB 시스템

시뮬레이션 로그를 MQTT로 수집하여 PostgreSQL에 저장하고, HTTP API로 조회하는 시스템.

## 아키텍처

```
브라우저(Worker) --ws://localhost:9003--> mosquitto 브로커
                                              |
FastAPI(subscriber) <---tcp://localhost:9883---┘
        |
        └──> PostgreSQL (localhost:5433)

브라우저(React) --http://localhost:8200--> FastAPI (조회 API)
```

## 폴더 구조

```
tools/log_db/
├── broker/    # MQTT 브로커 (mosquitto)
├── db/        # PostgreSQL (Docker)
├── api/       # FastAPI 서버 (MQTT 구독 + 조회 API)
└── README.md
```

## MQTT 토픽

| 토픽 | 방향 | payload |
|------|------|---------|
| `VPS/logs/session` | Worker → broker → API | JSON (`session_id`, `mode`, `vehicle_count`, `map_name`) |
| `VPS/logs/{session_id}/{event_type}` | Worker → broker → API | binary (protocol.ts 포맷) |

## 포트 정리

| 서비스 | 포트 | 프로토콜 |
|--------|------|----------|
| mosquitto (WebSocket) | 9003 | ws:// (브라우저용) |
| mosquitto (TCP) | 9883 | mqtt:// (백엔드/CLI용) |
| PostgreSQL | 5433 | tcp |
| FastAPI | 8200 | http |

## systemd 서비스 (WSL 자동 시작)

3개 서비스가 등록되어 있으며, WSL 시작 시 자동 실행됩니다.

| 서비스명 | 설명 |
|----------|------|
| `vps-mosquitto` | MQTT 브로커 |
| `vps-logdb` | PostgreSQL (Docker) |
| `vps-logapi` | FastAPI + MQTT subscriber |

### 상태 확인

```bash
systemctl --user status vps-mosquitto vps-logdb vps-logapi
```

### 전체 재시작

```bash
systemctl --user restart vps-mosquitto vps-logdb vps-logapi
```

### 로그 보기 (실시간)

```bash
journalctl --user -u vps-logapi -f
```

### 서비스 등록/해제 방법

서비스 파일 위치: `~/.config/systemd/user/`

```bash
# 등록 (최초 1회)
systemctl --user daemon-reload
systemctl --user enable vps-mosquitto vps-logdb vps-logapi

# 해제
systemctl --user disable vps-mosquitto vps-logdb vps-logapi
```

### 수동 실행 (터미널에서 로그 보면서)

```bash
# 1) systemd 서비스 중지
systemctl --user stop vps-logapi

# 2) 직접 실행
cd tools/log_db/api
uvicorn main:app --host 0.0.0.0 --port 8200
```

## DB 데이터 확인

```bash
# psql 접속
docker exec -it vps_logs_db psql -U vps -d vps_logs

# 테이블 목록
\dt

# 세션 목록
SELECT * FROM sessions;

# 레코드 수 확인
SELECT count(*) FROM ml_replay_snapshot;
SELECT count(*) FROM ml_lock;
SELECT count(*) FROM ml_edge_transit;
```
