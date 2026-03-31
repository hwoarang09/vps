# PostgreSQL (Docker)

VPS 시뮬레이션 로그 저장용 DB.

## 포트

- **5433** (호스트) → 5432 (컨테이너)
- WSL mirrored networking 모드에서 5432 충돌 방지를 위해 5433 사용

## 접속 정보

| 항목 | 값 |
|------|-----|
| host | localhost |
| port | 5433 |
| database | vps_logs |
| user | vps |
| password | vps |

## Docker 명령어

```bash
cd tools/log_db/db

# 컨테이너 시작
docker-compose up -d

# 컨테이너 중지
docker-compose down

# 컨테이너 + 데이터 삭제 (주의: DB 데이터 날아감)
docker-compose down -v

# 로그 확인
docker logs vps_logs_db
```

## psql 접속

```bash
# Docker 컨테이너 내부에서
docker exec -it vps_logs_db psql -U vps -d vps_logs

# 또는 호스트에서 직접 (psql 설치 필요)
psql -h localhost -p 5433 -U vps -d vps_logs
```

## 테이블 구조

`schema.sql` 참고. 주요 테이블:

| 테이블 | 설명 |
|--------|------|
| sessions | 시뮬레이션 세션 목록 |
| ml_replay_snapshot | 차량 위치/속도 스냅샷 |
| ml_edge_transit | Edge 통과 이력 |
| ml_lock | Lock 이벤트 |
| dev_path | 경로 탐색 이력 |
| dev_transfer | Transfer 이력 |

## systemd 서비스

파일: `~/.config/systemd/user/vps-logdb.service`

```ini
[Unit]
Description=VPS Log DB (PostgreSQL via Docker)
After=default.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/vosui/vosui/vps/tools/log_db/db
ExecStart=/snap/bin/docker-compose up -d
ExecStop=/snap/bin/docker-compose down

[Install]
WantedBy=default.target
```

```bash
# 서비스 등록
cp 위_내용 ~/.config/systemd/user/vps-logdb.service
systemctl --user daemon-reload
systemctl --user enable --now vps-logdb
```

## DB 초기화 (데이터 리셋)

```bash
cd tools/log_db/db
docker-compose down -v
docker-compose up -d
# schema.sql이 자동 실행되어 테이블 재생성
```
