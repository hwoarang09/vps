// src/store/system/mqtt/messageHandler.ts
// MQTT Message Handler - Routes incoming messages to appropriate handlers
//
// Topic Format: {PROJECT}/{RECEIVER}/{SENDER}/{SERVICE}
// Example: VPS/transferMgr/UI/MOVE
// - PROJECT: VPS (project name)
// - RECEIVER: transferMgr (the receiver)
// - SENDER: UI, Backend, etc. (the sender)
// - SERVICE: MOVE, TRANSFER, STOP, etc. (from TOPICS constant)

import { TOPICS } from "@/config/mqttConfig";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";

type MqttStoreGetter = () => {
  setReceivedMessages: (topic: string, message: unknown) => void;
  addLog: (log: string) => void;
};

/**
 * Parse topic into components
 * Format: {PROJECT}/{RECEIVER}/{SENDER}/{SERVICE}
 */
interface ParsedTopic {
  project: string;
  receiver: string;
  sender: string;
  service: string;
}

const parseTopic = (topic: string): ParsedTopic | null => {
  const parts = topic.split("/");
  if (parts.length !== 4) {
    return null;
  }
  return {
    project: parts[0],
    receiver: parts[1],
    sender: parts[2],
    service: parts[3],
  };
};

/**
 * Handle incoming MQTT messages
 * Routes messages based on topic to appropriate handlers
 */
export const handleMqttMessage = (
  topic: string,
  message: Buffer,
  get: MqttStoreGetter
): void => {
  const msgString = message.toString();
  console.log(`[MQTT] Received on ${topic}:`, msgString);

  // Add to logs (truncate long messages)
  const logMsg = msgString.length > 50 ? `${msgString.substring(0, 50)}...` : msgString;
  get().addLog(`[Recv] ${topic}: ${logMsg}`);

  // Try to parse as JSON
  let parsedMessage: unknown;
  try {
    parsedMessage = JSON.parse(msgString);
  } catch {
    // If not JSON, use raw string
    parsedMessage = msgString;
  }

  // Store the message
  get().setReceivedMessages(topic, parsedMessage);

  // Route based on topic
  routeMessage(topic, parsedMessage);
};

/**
 * Route message to appropriate handler based on topic
 * Topic format: VPS/transferMgr/{sender}/{service}
 */
const routeMessage = (topic: string, message: unknown): void => {
  const parsed = parseTopic(topic);

  if (!parsed) {
    console.log(`[MQTT] Invalid topic format: ${topic}`);
    return;
  }

  // Check if this is for transferMgr
  if (parsed.receiver === "transferMgr") {
    handleTransferMgrMessage(parsed.sender, parsed.service, message);
    return;
  }

  // Log unhandled receivers
  console.log(`[MQTT] Unhandled receiver: ${parsed.receiver}`, message);
};

/**
 * Handle messages for transferMgr
 * Routes to specific service handlers
 */
const handleTransferMgrMessage = (
  sender: string,
  service: string,
  message: unknown
): void => {
  console.log(`[MQTT] TransferMgr message from ${sender}, service: ${service}`);

  switch (service) {
    case TOPICS.MOVE:
      handleMoveCommand(sender, message);
      break;

    case TOPICS.STOP:
      handleStopCommand(sender, message);
      break;

    case TOPICS.TRANSFER:
      handleTransferCommand(sender, message);
      break;

    case TOPICS.STATUS:
      handleStatus(sender, message);
      break;

    default:
      console.log(`[MQTT] Unknown service: ${service}`, message);
      break;
  }
};

// Service Handlers (to be implemented)
const handleMoveCommand = (sender: string, _message: unknown): void => {
  console.log(`[MQTT] MOVE command from ${sender} message ${JSON.stringify(_message)}`);
  useShmSimulatorStore.getState().sendCommand(_message);
};

const handleTransferCommand = (sender: string, _message: unknown): void => {
  console.log(`[MQTT] TRANSFER command from ${sender} message ${JSON.stringify(_message)}`);
  useShmSimulatorStore.getState().sendCommand(_message);
};

const handleStopCommand = (sender: string, _message: unknown): void => {
  console.log(`[MQTT] STOP command from ${sender} message ${JSON.stringify(_message)}`);
};

const handleStatus = (sender: string, _message: unknown): void => {
  console.log(`[MQTT] STATUS from ${sender} message ${JSON.stringify(_message)}`);
};
