// components/react/menu/data/tooltipConfig.tsx (새로운 파일)
import { MainMenuType } from "@/types";

export const tooltipsByLevel: {
  1: Record<MainMenuType, string>;
  2: Record<string, string>;
  3: Record<string, string>;
} = {
  1: {
    // 메인메뉴 레벨
    MapLoader: "맵 불러오기",
    Statistics: "통계 및 분석",
    Search: "검색",
    Operation: "운영 관리",
    MapBuilder: "도로 편집기",
    LayoutBuilder: "레이아웃 편집기",
    MQTT: "MQTT 연결 관리",
    Visualization: "시각화 옵션",
    DevTools: "개발자 도구",
  },
  2: {
    // 서브메뉴 레벨
    "maploader-menu-1": "CFG 파일 불러오기",
    "maploader-menu-2": "맵 데이터 가져오기",
    "maploader-menu-3": "맵 데이터 내보내기",

    "stats-realtime": "Fab별 실시간 통계 (평균속도 등)",
    "stats-db": "DB 이력 조회 (운행/반송/Lock)",

    "vehicle-menu-1": "전체 차량 현황",
    "vehicle-menu-2": "운행중인 차량",
    "vehicle-menu-3": "대기중인 차량",
    "vehicle-menu-4": "정비중인 차량",
    "vehicle-menu-5": "차량 이력 관리",

    "operation-menu-1": "경로 관리",
    "operation-menu-2": "스케줄 관리",
    "operation-menu-3": "실시간 모니터링",
    "operation-menu-4": "알림 관리",
    "operation-menu-5": "운영 로그",
    "operation-menu-6": "레이아웃 불러오기",
    "operation-menu-8": "시뮬레이션 파라미터",

    "map-menu-1": "직선 도로 생성",
    "map-menu-2": "90° 곡선 도로",
    "map-menu-3": "180° 곡선 도로",
    "map-menu-4": "S자 곡선 도로",
    "map-menu-5": "H자 교차로",
    "map-menu-6": "R자 회전교차로",
    "map-menu-7": "다중 교차로",
    "map-menu-8": "교량 및 고가도로",
    "map-menu-9": "사용자 정의 도로",

    "layout-menu-1": "Bay 생성기",
    "layout-menu-2": "Station 생성기",
    "layout-menu-3": "Equipment 생성기",

    "mqtt-connection": "MQTT 브로커 연결 관리",

    "vis-performance": "성능 모니터 표시/숨기기",
    "vis-bay-label": "Bay 라벨 표시/숨기기",
    "vis-heatmap": "트래픽 히트맵",
    "vis-traffic-flow": "트래픽 흐름 시각화",
    "vis-deadlock-zone": "데드락 존 표시",
    "vis-sensor-box": "차량 센서 박스 표시/숨기기",
    "vis-fab-labels": "Fab 라벨 오버레이 표시/숨기기",

    "devtools-lock": "노드별 Lock 상태 확인",

    "search-vehicle": "차량 ID로 검색",
    "search-node": "노드 이름으로 검색",
    "search-edge": "엣지 이름으로 검색",
    "search-station": "스테이션 이름으로 검색",
  },
  3: {
    "params-movement": "직선/곡선 속도·가속도 설정",
    "params-lock": "Lock 거리·전략 설정",
    "params-routing": "길찾기 가중치 전략",
    "params-mode": "반송 모드 설정 (Global/Per-Fab)",
  },
};
