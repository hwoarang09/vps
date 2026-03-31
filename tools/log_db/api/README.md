# FastAPI 서버 (조회 API + MQTT Subscriber)

MQTT로 로그를 수신하여 DB에 저장하고, HTTP API로 조회하는 서버.

## 포트

- **8200** (HTTP)

## 역할

1. **MQTT Subscriber**: `VPS/logs/#` 토픽 구독 → binary 파싱 → DB INSERT
2. **HTTP API**: 브라우저 DataPanel에서 DB 데이터 조회

## 의존성 설치

```bash
cd tools/log_db/api
pip install -r requirements.txt
```

## 수동 실행 (터미널에서 로그 보기)

```bash
# systemd 서비스 먼저 중지
systemctl --user stop vps-logapi

# 직접 실행
cd tools/log_db/api
uvicorn main:app --host 0.0.0.0 --port 8200

# 또는 auto-reload 모드 (개발 시)
uvicorn main:app --host 0.0.0.0 --port 8200 --reload
```

## API 엔드포인트

### 상태 확인

```
GET /health
→ {"status": "ok", "mqtt": true}
```

### 세션 목록

```
GET /api/sessions
→ [{"session_id": "...", "started_at": "...", "mode": "ml", ...}]
```

### 차량 위치/속도 이력

```
GET /api/vehicle/{veh_id}/snapshots?session_id={sid}&from_ts=0&to_ts=999999&limit=5000
```

### 차량 Edge 통과 이력

```
GET /api/vehicle/{veh_id}/edges?session_id={sid}&limit=5000
```

### Lock 이벤트 (노드별)

```
GET /api/lock/by-node/{node_idx}?session_id={sid}&limit=5000
```

### Lock 이벤트 (차량별)

```
GET /api/lock/by-vehicle/{veh_id}?session_id={sid}&limit=5000
```

### Lock 대기시간 Top N

```
GET /api/lock/top-wait?session_id={sid}&limit=20
```

## systemd 서비스

파일: `~/.config/systemd/user/vps-logapi.service`

```ini
[Unit]
Description=VPS Log API (FastAPI port 8200)
After=vps-logdb.service vps-mosquitto.service
Requires=vps-logdb.service vps-mosquitto.service

[Service]
Type=simple
WorkingDirectory=/home/vosui/vosui/vps/tools/log_db/api
ExecStart=/home/vosui/.local/bin/uvicorn main:app --host 0.0.0.0 --port 8200
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

```bash
# 서비스 등록
cp 위_내용 ~/.config/systemd/user/vps-logapi.service
systemctl --user daemon-reload
systemctl --user enable --now vps-logapi
```

## 테스트

```bash
# health 확인
curl http://localhost:8200/health

# 세션 목록
curl http://localhost:8200/api/sessions

# 차량 0번 스냅샷
curl "http://localhost:8200/api/vehicle/0/snapshots?session_id=SESSION_ID"
```
