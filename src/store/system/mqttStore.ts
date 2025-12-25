import { create } from "zustand";
import mqtt, { MqttClient } from "mqtt";

const SUB_TOPIC = "#";

interface MqttState {
  client: MqttClient | null;
  receivedMessages: { [topic: string]: any[] };
  sendMessage: (params: { topic: string; message: string }) => void;
  setReceivedMessages: (topic: string, message: any) => void;
  initializeClient: (url: string) => void;
}

export const useMqttStore = create<MqttState>((set, get) => ({
  client: null,

  receivedMessages: {},

  sendMessage: ({ topic, message }) => {
    const client = get().client;

    if (!client) {
      console.error("MQTT client is not initialized.");
      return;
    }

    client.publish(topic, message, (err) => {
      if (err) {
        console.error("Failed to send message", err);
      } else {
        console.log(`Message sent to ${topic}: ${message}`);
      }
    });
  },

  setReceivedMessages: (topic, message) =>
    set((state) => ({
      receivedMessages: {
        ...state.receivedMessages,
        [topic]: [...(state.receivedMessages[topic] || []), message],
      },
    })),

  initializeClient: (url: string) => {
    const client = mqtt.connect(url);

    client.on("connect", () => {
      console.log("Connected to MQTT broker");
      if (client.connected) {
        client.subscribe(SUB_TOPIC, (err) => {
          if (err) {
            console.error("Failed to subscribe to topic", err);
          } 
        });
      }
    });

    client.on("message", (topic, message) => {
      try {
        const parsedMessage = JSON.parse(message.toString());
        get().setReceivedMessages(topic, parsedMessage);
      } catch (error) {
        console.error("Failed to parse message", error);
      }
    });

    client.on("error", (err) => {
      console.error("MQTT Client Error:", err);
    });

    set({ client });
  },
}));
