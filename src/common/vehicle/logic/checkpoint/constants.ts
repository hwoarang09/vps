// common/vehicle/logic/checkpoint/constants.ts
// Checkpoint builder 공용 상수

/**
 * waiting_offset 기본값 (m)
 * - edges.cfg에 명시 안 된 merge 진입 edge에 대해 fallback
 * - cfgStore의 정규화(<=0 → undefined)와 builder의 fallback 둘 다 이 값 사용
 */
export const DEFAULT_WAITING_OFFSET = 1.89;

/**
 * 정적 DZ entry edge 끝에서 wait CP까지 offset (m)
 * - branch node 직전에서 정지하기 위한 거리
 */
export const DZ_ENTRY_WAIT_OFFSET = 0.5;
