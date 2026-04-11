// src/config/logConfig.ts
// 로그 시스템 설정

/** MQTT 브로커 (WebSocket) */
export const MQTT_WS_HOST = 'localhost';
export const MQTT_WS_PORT = 9003;
export const MQTT_WS_URL = `ws://${MQTT_WS_HOST}:${MQTT_WS_PORT}`;

/** DB API 서버 (조회 전용) */
export const LOG_DB_HOST = 'localhost';
export const LOG_DB_PORT = 8201;
export const LOG_DB_URL = `http://${LOG_DB_HOST}:${LOG_DB_PORT}`;
