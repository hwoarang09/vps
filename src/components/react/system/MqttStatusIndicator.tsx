// components/react/system/MqttStatusIndicator.tsx
// HUD Status Indicator - Shows MQTT connection status in top-left corner

import React from "react";
import { Antenna, WifiOff } from "lucide-react";
import { useMqttStore } from "@/store/system/mqttStore";

const MqttStatusIndicator: React.FC = () => {
  const isConnected = useMqttStore((state) => state.isConnected);

  return (
    <div
      className="fixed top-4 left-4 z-50 flex items-center gap-2 px-3 py-2 rounded-lg shadow-md backdrop-blur-sm"
      style={{
        backgroundColor: isConnected
          ? "rgba(34, 197, 94, 0.15)"
          : "rgba(239, 68, 68, 0.15)",
        border: isConnected
          ? "1px solid rgba(34, 197, 94, 0.3)"
          : "1px solid rgba(239, 68, 68, 0.3)",
      }}
      title={isConnected ? "MQTT Connected" : "MQTT Disconnected"}
    >
      {/* Status Icon */}
      {isConnected ? (
        <Antenna
          size={18}
          className="text-green-500"
          style={{ animation: "pulse 2s infinite" }}
        />
      ) : (
        <WifiOff size={18} className="text-red-500" />
      )}

      {/* Status Text */}
      <span
        className={`text-xs font-medium ${
          isConnected ? "text-green-600" : "text-red-600"
        }`}
      >
        {isConnected ? "MQTT" : "MQTT Off"}
      </span>

      {/* Pulsing dot indicator */}
      <div
        className={`w-2 h-2 rounded-full ${
          isConnected ? "bg-green-500" : "bg-red-500"
        }`}
        style={{
          animation: isConnected ? "pulse 1.5s infinite" : "none",
        }}
      />

      {/* Keyframe animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

export default MqttStatusIndicator;

