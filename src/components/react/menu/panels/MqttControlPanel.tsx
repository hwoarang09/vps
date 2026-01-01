// components/react/menu/panels/MqttControlPanel.tsx
import React, { useState, useEffect, useRef } from "react";
import { Plug, PlugZap, Trash2 } from "lucide-react";
import { useMqttStore } from "@/store/system/mqttStore";
import { defaultMqttConfig } from "@/config/mqttConfig";

const MqttControlPanel: React.FC = () => {
  const { isConnected, logs, config, loadConfig, connect, disconnect, clearLogs } =
    useMqttStore();

  // Local state for connection form (URL-based)
  const [brokerUrl, setBrokerUrl] = useState(defaultMqttConfig.MQTT_BROKER_URL);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Update local state when config is loaded
  useEffect(() => {
    if (config) {
      setBrokerUrl(config.MQTT_BROKER_URL);
    }
  }, [config]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleConnect = () => {
    connect(brokerUrl);
  };

  const handleDisconnect = () => {
    disconnect();
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-800">MQTT Connection</h3>

      {/* Connection Form */}
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">
            Broker URL
          </label>
          <input
            type="text"
            value={brokerUrl}
            onChange={(e) => setBrokerUrl(e.target.value)}
            disabled={isConnected}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            placeholder="ws://localhost:8083"
          />
        </div>

        {/* Subscribe Topics (read-only display) */}
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">
            Subscribe Topics
          </label>
          <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded border">
            {(config?.SUBSCRIBE_TOPICS ?? defaultMqttConfig.SUBSCRIBE_TOPICS).map(
              (topic, idx) => (
                <div key={idx} className="font-mono">
                  {topic}
                </div>
              )
            )}
          </div>
        </div>

        {/* Connect/Disconnect Button */}
        <button
          onClick={isConnected ? handleDisconnect : handleConnect}
          className={`w-full py-2 px-4 rounded flex items-center justify-center gap-2 transition-colors ${
            isConnected
              ? "bg-red-500 hover:bg-red-600 text-white"
              : "bg-green-500 hover:bg-green-600 text-white"
          }`}
        >
          {isConnected ? (
            <>
              <PlugZap size={18} />
              Disconnect
            </>
          ) : (
            <>
              <Plug size={18} />
              Connect
            </>
          )}
        </button>
      </div>

      {/* Connection Status */}
      <div className="flex items-center gap-2 p-2 rounded bg-gray-100">
        <div
          className={`w-3 h-3 rounded-full ${
            isConnected ? "bg-green-500" : "bg-red-500"
          }`}
        />
        <span className="text-sm text-gray-700">
          {isConnected ? "Connected" : "Disconnected"}
        </span>
      </div>

      {/* Logs Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Logs</label>
          <button
            onClick={clearLogs}
            className="text-gray-500 hover:text-red-500 transition-colors"
            title="Clear logs"
          >
            <Trash2 size={16} />
          </button>
        </div>
        <div className="h-40 overflow-y-auto bg-gray-900 text-green-400 text-xs font-mono p-2 rounded">
          {logs.length === 0 ? (
            <div className="text-gray-500">No logs yet...</div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="whitespace-pre-wrap break-all">
                {log}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};

export default MqttControlPanel;

