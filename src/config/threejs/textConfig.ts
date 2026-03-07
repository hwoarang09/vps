// Text visibility configuration
// 각 텍스트 레이어의 표시 여부를 제어합니다.

export interface TextVisibilityConfig {
  node: boolean;
  edge: boolean;
  station: boolean;
  vehicle: boolean;
  bay: boolean;
}

const textVisibility: TextVisibilityConfig = {
  node: false,
  edge: false,
  station: false,
  vehicle: false,
  bay: true,
};

export const getTextVisibility = (): TextVisibilityConfig => textVisibility;
