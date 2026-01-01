// MQTT Configuration Types
// Topic format: {PROJECT}/{RECEIVER}/{SENDER}/{SERVICE}
// Example: VPS/transferMgr/UI/MOVE

export interface MqttConfig {
  MQTT_BROKER_URL: string;
  SUBSCRIBE_TOPICS: string[];
}

// Service types for topic routing
export const TOPICS = {
  // Commands
  MOVE: "MOVE",
  TRANSFER: "TRANSFER",
  STOP: "STOP",
  // Status
  STATUS: "STATUS",
} as const;

// Default configuration (fallback)
export const defaultMqttConfig: MqttConfig = {
  MQTT_BROKER_URL: "ws://localhost:9003",
  SUBSCRIBE_TOPICS: ["VPS/transferMgr/+/+"],
};

// Load MQTT configuration from JSON file
export const loadMqttConfig = async (): Promise<MqttConfig> => {
  try {
    const response = await fetch("/config/mqttConfig.json");
    if (!response.ok) {
      throw new Error(`Failed to load MQTT config: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error loading MQTT config:", error);
    return defaultMqttConfig;
  }
};

// For backward compatibility

