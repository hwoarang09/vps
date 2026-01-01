import { create } from "zustand";
import mqtt, { MqttClient } from "mqtt";
import {
  MqttConfig,
  loadMqttConfig,
  defaultMqttConfig,
} from "@/config/mqttConfig";
import { handleMqttMessage } from "./mqtt/messageHandler";

const MAX_LOGS = 100;

interface MqttState {
  client: MqttClient | null;
  isConnected: boolean;
  config: MqttConfig | null;
  logs: string[];
  receivedMessages: { [topic: string]: unknown[] };

  // Actions
  loadConfig: () => Promise<void>;
  connect: (url?: string) => void;
  disconnect: () => void;
  sendMessage: (topic: string, message: string) => void;
  addLog: (log: string) => void;
  clearLogs: () => void;

  // Legacy support
  initializeClient: (url: string) => void;
  setReceivedMessages: (topic: string, message: unknown) => void;
}

export const useMqttStore = create<MqttState>((set, get) => ({
  client: null,
  isConnected: false,
  config: null,
  logs: [],
  receivedMessages: {},

  loadConfig: async () => {
    const config = await loadMqttConfig();
    set({ config });
    get().addLog(`[Config] Loaded: ${config.MQTT_BROKER_URL}`);
  },

  connect: (url?: string) => {
    const { client: existingClient, config } = get();

    // Disconnect existing client if any
    if (existingClient) {
      existingClient.end(true);
    }

    // Use provided URL or fall back to config or defaults
    const brokerUrl =
      url ?? config?.MQTT_BROKER_URL ?? defaultMqttConfig.MQTT_BROKER_URL;
    const subscribeTopics =
      config?.SUBSCRIBE_TOPICS ?? defaultMqttConfig.SUBSCRIBE_TOPICS;

    get().addLog(`[Connect] Connecting to ${brokerUrl}...`);

    const client = mqtt.connect(brokerUrl, {
      keepalive: 60,
      clientId: `vps_react_client_${Date.now()}`,
      clean: true,
    });

    client.on("connect", () => {
      set({ isConnected: true });
      get().addLog(`[Connect] Connected to broker`);

      // Subscribe to all configured topics
      for (const topic of subscribeTopics) {
        client.subscribe(topic, (err) => {
          if (err) {
            get().addLog(`[Subscribe] Failed ${topic}: ${err.message}`);
          } else {
            get().addLog(`[Subscribe] Subscribed to ${topic}`);
          }
        });
      }
    });

    client.on("message", (topic, message) => {
      handleMqttMessage(topic, message, get);
    });

    client.on("error", (err) => {
      get().addLog(`[Error] ${err.message}`);
    });

    client.on("close", () => {
      set({ isConnected: false });
      get().addLog(`[Close] Connection closed`);
    });

    client.on("offline", () => {
      set({ isConnected: false });
      get().addLog(`[Offline] Client offline`);
    });

    set({ client });
  },

  disconnect: () => {
    const { client } = get();
    if (client) {
      client.end(true);
      set({ client: null, isConnected: false });
      get().addLog(`[Disconnect] Disconnected from broker`);
    }
  },

  sendMessage: (topic: string, message: string) => {
    const { client, isConnected } = get();

    if (!client || !isConnected) {
      get().addLog(`[Send] Failed: Not connected`);
      return;
    }

    client.publish(topic, message, (err) => {
      if (err) {
        get().addLog(`[Send] Failed to ${topic}: ${err.message}`);
      } else {
        get().addLog(`[Send] Sent to ${topic}: ${message}`);
      }
    });
  },

  addLog: (log: string) => {
    const timestamp = new Date().toLocaleTimeString();
    set((state) => ({
      logs: [...state.logs.slice(-MAX_LOGS + 1), `${timestamp} ${log}`],
    }));
  },

  clearLogs: () => {
    set({ logs: [] });
  },

  // Legacy support for backward compatibility
  setReceivedMessages: (topic, message) =>
    set((state) => ({
      receivedMessages: {
        ...state.receivedMessages,
        [topic]: [...(state.receivedMessages[topic] || []), message],
      },
    })),

  initializeClient: (url: string) => {
    get().connect(url);
  },
}));
