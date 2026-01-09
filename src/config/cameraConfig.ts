// Camera configuration loader
interface CameraConfig {
  position: [number, number, number];
  target: [number, number, number];
}

interface CameraSettings {
  DEFAULT_CAMERA: CameraConfig;
  BAY_BUILDER_CAMERA: CameraConfig;
}

// Load camera configuration from JSON file
const loadCameraConfig = async (): Promise<CameraSettings> => {
  try {
    const response = await fetch('/config/cameraConfig.json');
    if (!response.ok) {
      throw new Error(`Failed to load camera config: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error loading camera config:', error);
    // Fallback to default values
    return {
      DEFAULT_CAMERA: {
        position: [-10, 10, 50],
        target: [0, 0, 0]
      },
      BAY_BUILDER_CAMERA: {
        position: [0, 0, 100],
        target: [0, 0, 0]
      }
    };
  }
};

// Export config loader


// For synchronous access (will use default until loaded)
let cameraConfig: CameraSettings = {
  DEFAULT_CAMERA: {
    position: [-10, 10, 50],
    target: [0, 0, 0]
  },
  BAY_BUILDER_CAMERA: {
    position: [0, 0, 100],
    target: [0, 0, 0]
  }
};

// Initialize config on module load
loadCameraConfig().then(config => {
  cameraConfig = config;
});

// Synchronous getters
export const getDefaultCameraPosition = (): [number, number, number] => 
  cameraConfig.DEFAULT_CAMERA.position;

export const getDefaultCameraTarget = (): [number, number, number] => 
  cameraConfig.DEFAULT_CAMERA.target;

export const getBayBuilderCameraPosition = (): [number, number, number] => 
  cameraConfig.BAY_BUILDER_CAMERA.position;

export const getBayBuilderCameraTarget = (): [number, number, number] => 
  cameraConfig.BAY_BUILDER_CAMERA.target;

