// src/config/logConfig.ts
// 로그 시스템 설정 — DB 주소, 포트 등

/** DB API 서버 주소 (브라우저 기준) */
export const LOG_DB_HOST = typeof window !== 'undefined'
  ? window.location.hostname
  : 'localhost';

export const LOG_DB_PORT = 8100;

/** 브라우저에서 사용할 DB API URL */
export const LOG_DB_URL = `http://${LOG_DB_HOST}:${LOG_DB_PORT}`;
