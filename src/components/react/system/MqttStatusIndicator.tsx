// components/react/system/MqttStatusIndicator.tsx
// HUD Status Indicator - Shows MQTT connection status in top-left corner with dropdown menu

import React, { useState } from "react";
import { Antenna, WifiOff, ChevronDown, PlugZap, Settings } from "lucide-react";
import { useMqttStore } from "@/store/system/mqttStore";

const MqttStatusIndicator: React.FC = () => {
  const { isConnected, config, disconnect, connect } = useMqttStore();
  const [isOpen, setIsOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [brokerUrl, setBrokerUrl] = useState("");

  // Parse broker URL to extract IP and port
  const getBrokerInfo = () => {
    const url = config?.MQTT_BROKER_URL || "";
    const regex = /ws:\/\/([^:]+):(\d+)/;
    const match = regex.exec(url);
    if (match) {
      return { ip: match[1], port: match[2] };
    }
    return { ip: "N/A", port: "N/A" };
  };

  const { ip, port } = getBrokerInfo();

  const handleDisconnect = () => {
    disconnect();
    setIsOpen(false);
  };

  const handleEditClick = () => {
    setBrokerUrl(config?.MQTT_BROKER_URL || "");
    setEditMode(true);
  };

  const handleConnect = () => {
    if (brokerUrl.trim()) {
      connect(brokerUrl);
      setEditMode(false);
      setIsOpen(false);
    }
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setBrokerUrl("");
  };

  return (
    <div className="fixed top-4 left-4 z-50">
      {/* Main Status Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg shadow-md backdrop-blur-sm transition-all hover:shadow-lg"
        style={{
          backgroundColor: isConnected
            ? "rgba(34, 197, 94, 0.15)"
            : "rgba(239, 68, 68, 0.15)",
          border: isConnected
            ? "1px solid rgba(34, 197, 94, 0.3)"
            : "1px solid rgba(239, 68, 68, 0.3)",
        }}
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

        {/* Dropdown arrow */}
        <ChevronDown
          size={14}
          className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="mt-2 rounded-lg shadow-xl backdrop-blur-sm border overflow-hidden"
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.95)",
            borderColor: "rgba(0, 0, 0, 0.1)",
            minWidth: "250px",
          }}
        >
          {editMode ? (
            /* Edit Mode */
            <div className="p-3">
              <div className="text-xs font-semibold text-gray-500 mb-2">
                Broker URL
              </div>
              <input
                type="text"
                value={brokerUrl}
                onChange={(e) => setBrokerUrl(e.target.value)}
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
                placeholder="ws://localhost:8083"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={handleConnect}
                  className="flex-1 px-3 py-1 text-xs bg-green-500 hover:bg-green-600 text-white rounded transition-colors"
                >
                  Connect
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="flex-1 px-3 py-1 text-xs bg-gray-300 hover:bg-gray-400 text-gray-700 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Connection Info */}
              <div className="p-3 border-b border-gray-200">
                <div className="text-xs font-semibold text-gray-500 mb-2">
                  Connection Info
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">IP:</span>
                    <span className="font-mono text-gray-800">{ip}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">Port:</span>
                    <span className="font-mono text-gray-800">{port}</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="p-2">
                {isConnected && (
                  <button
                    onClick={handleDisconnect}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-red-50 text-red-600 text-sm transition-colors"
                  >
                    <PlugZap size={16} />
                    Disconnect
                  </button>
                )}
                <button
                  onClick={handleEditClick}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-blue-50 text-blue-600 text-sm transition-colors"
                >
                  <Settings size={16} />
                  Change Broker
                </button>
              </div>
            </>
          )}
        </div>
      )}

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

