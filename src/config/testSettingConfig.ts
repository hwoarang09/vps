// Test setting configuration interface
import { TransferMode } from "@/common/vehicle/initialize/constants";

export interface TestSetting {
  id: string;
  name: string;
  description: string;
  mapName: string;
  numVehicles: number;
  transferMode?: TransferMode;
  camera?: {
    position: [number, number, number];
    target: [number, number, number];
  };
}

interface TestSettingConfig {
  TEST_SETTINGS: TestSetting[];
  DEFAULT_SETTING: string;
}

// 전역 렌더링 설정
export interface RenderConfig {
  maxVisibleFabs: number; // 동시에 표시할 최대 fab 개수
}

export const renderConfig: RenderConfig = {
  maxVisibleFabs: 25,
};

// Load test setting configuration from JSON file
const loadTestSettingConfig = async (): Promise<TestSettingConfig> => {
  try {
    const response = await fetch('/config/testSettingConfig.json');
    if (!response.ok) {
      throw new Error(`Failed to load test setting config: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error loading test setting config:', error);
    // Fallback to default values
    return {
      TEST_SETTINGS: [
        {
          id: "SMALL_LOOP",
          name: "Small Loop Test",
          description: "Small loop with few vehicles for quick testing",
          mapName: "straight_short_test",
          numVehicles: 5,
          camera: {
            position: [5, -2, 100],
            target: [5, 5, 0]
          }
        }
      ],
      DEFAULT_SETTING: "Y_SHORT"
    };
  }
};

// Export config loader


// For synchronous access (will use default until loaded)
let testSettingConfig: TestSettingConfig = {
  TEST_SETTINGS: [
    {
      id: "SMALL_LOOP",
      name: "Small Loop Test",
      description: "Small loop with few vehicles for quick testing",
      mapName: "straight_short_test",
      numVehicles: 5,
      transferMode: TransferMode.AUTO_ROUTE,
      camera: {
        position: [5, -2, 10],
        target: [5, 5, 0]
      }
    },
    {
      id: "MEDIUM_LOOP",
      name: "Medium Loop Test",
      description: "Medium-sized loop with moderate vehicle count",
      mapName: "straight_test",
      numVehicles: 50,
      transferMode: TransferMode.AUTO_ROUTE,
      camera: {
        position: [250, -150, 550],
        target: [250, 150, 0]
      }
    },
    {
      id: "STRESS_TEST",
      name: "Stress Test",
      description: "Maximum vehicles for performance testing",
      mapName: "stress_test",
      numVehicles: 1000,
      transferMode: TransferMode.AUTO_ROUTE,
      camera: {
        position: [250, -150, 550],
        target: [250, 150, 0]
      }
    },
    {
      id: "SIMPLE_CONNECTED",
      name: "Simple Connected",
      description: "Simple connected loop test",
      mapName: "simple_connected",
      numVehicles: 10,
      transferMode: TransferMode.AUTO_ROUTE,
      camera: {
        position: [10, -10, 30],
        target: [10, 0, 0]
      }
    },
    {
      id: "SIMPLE_S",
      name: "Simple S Curve",
      description: "Simple S-curve test",
      mapName: "simple_s",
      numVehicles: 8,
      transferMode: TransferMode.AUTO_ROUTE,
      camera: {
        position: [10, -10, 30],
        target: [10, 0, 0]
      }
    },
    {
      id: "Y_SHORT",
      name: "Y Short Switch",
      description: "Y-switch short track test",
      mapName: "y_short",
      numVehicles: 6,
      transferMode: TransferMode.AUTO_ROUTE,
      camera: {
        position: [10, -10, 30],
        target: [10, 0, 0]
      }
    },
    {
      id: "COP",
      name: "COP Test",
      description: "COP track test",
      mapName: "cop",
      numVehicles: 10,
      transferMode: TransferMode.AUTO_ROUTE,
      camera: {
        position: [10, -10, 30],
        target: [10, 0, 0]
      }
    },
    {
      id: "SHORT_EDGE_KEEP",
      name: "Short Edge Keep",
      description: "Simple Connected Short Edge Keep test",
      mapName: "simple_connected_short_edge_keep",
      numVehicles: 10,
      transferMode: TransferMode.AUTO_ROUTE,
      camera: {
        position: [10, -10, 30],
        target: [10, 0, 0]
      }
    }
  ],
  DEFAULT_SETTING: "Y_SHORT"
};

// Load config immediately
loadTestSettingConfig().then(config => {
  testSettingConfig = config;
});

// Export synchronous getters
export const getTestSettings = () => testSettingConfig.TEST_SETTINGS;
export const getDefaultSetting = () => testSettingConfig.DEFAULT_SETTING;

// Get test setting by ID


