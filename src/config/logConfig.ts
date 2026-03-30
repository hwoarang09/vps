// src/config/logConfig.ts
// 로그 시스템 설정 — DB 주소, 포트 등

/** DB API 서버 포트 (Worker에서 직접 fetch 시 사용) */
export const LOG_DB_PORT = 8100;

/**
 * 브라우저(Main Thread)에서 사용할 DB API URL
 * - dev: vite proxy (/logdb → localhost:8100)
 * - prod: 직접 접근
 */
export const LOG_DB_URL = '/logdb';
