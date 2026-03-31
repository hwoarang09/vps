# MQTT 브로커 (Mosquitto)

VPS 시뮬레이션 로그 전송용 MQTT 브로커.

## 포트

| 포트 | 프로토콜 | 용도 |
|------|----------|------|
| 9003 | WebSocket | 브라우저 Worker (mqtt.js) |
| 9883 | TCP | FastAPI subscriber, mosquitto_pub/sub CLI |

## 설치

```bash
sudo apt install mosquitto mosquitto-clients
```

## 수동 실행

```bash
mosquitto -c tools/log_db/broker/mosquitto.conf
```

## systemd 서비스

파일: `~/.config/systemd/user/vps-mosquitto.service`

```ini
[Unit]
Description=VPS Mosquitto MQTT Broker (9003/ws, 9883/tcp)
Before=vps-logapi.service

[Service]
Type=simple
ExecStart=/usr/sbin/mosquitto -c /home/vosui/vosui/vps/tools/log_db/broker/mosquitto.conf
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

```bash
# 서비스 등록
cp 위_내용 ~/.config/systemd/user/vps-mosquitto.service
systemctl --user daemon-reload
systemctl --user enable --now vps-mosquitto
```

## 테스트

```bash
# 터미널 1: 구독
mosquitto_sub -h localhost -p 9883 -t "VPS/logs/#" -v

# 터미널 2: 발행
mosquitto_pub -h localhost -p 9883 -t "VPS/logs/session" -m '{"session_id":"test","mode":"ml"}'
```
