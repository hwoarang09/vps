import React, { useState } from "react";
import { useShmSimulatorStore } from "@store/vehicle/shmMode/shmSimulatorStore";
import type { LogFileInfo } from "@/logger/protocol";

/**
 * LogFileManager
 * 
 * Dropdown component for managing OPFS log files
 */
const LogFileManager: React.FC = () => {
  const { listLogFiles, downloadLogFile, deleteLogFile } = useShmSimulatorStore();
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleToggle = async () => {
    if (!isOpen) {
      setIsLoading(true);
      try {
        const result = await listLogFiles();
        setFiles(result || []);
      } catch (error) {
        console.error("Failed to list log files:", error);
        alert(`Failed to list log files: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setIsLoading(false);
      }
    }
    setIsOpen(!isOpen);
  };

  const handleDownload = async (file: LogFileInfo) => {
    try {
      const result = await downloadLogFile(file.fileName);
      if (!result) {
        alert("Failed to download file");
        return;
      }

      const blob = new Blob([result.buffer], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName;
      a.click();
      URL.revokeObjectURL(url);

      alert(`Downloaded: ${result.fileName}\nRecords: ${result.recordCount}\nSize: ${(result.buffer.byteLength / 1024).toFixed(2)} KB`);
    } catch (error) {
      console.error("Failed to download file:", error);
      alert(`Failed to download: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDelete = async (file: LogFileInfo) => {
    if (!confirm(`Delete ${file.fileName}?\n\nThis will permanently remove the file from OPFS.`)) {
      return;
    }

    try {
      await deleteLogFile(file.fileName);
      alert(`Deleted: ${file.fileName}`);
      
      const result = await listLogFiles();
      setFiles(result || []);
    } catch (error) {
      console.error("Failed to delete file:", error);
      alert(`Failed to delete: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={handleToggle}
        style={{
          padding: "5px 15px",
          background: "#9b59b6",
          color: "white",
          border: "2px solid #8e44ad",
          borderRadius: "4px",
          fontSize: "12px",
          cursor: "pointer",
          fontWeight: "bold",
          display: "flex",
          alignItems: "center",
          gap: "5px",
        }}
        title="Manage log files"
      >
        📋 Logs ({files.length})
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 5px)",
            right: 0,
            background: "rgba(20, 20, 20, 0.98)",
            border: "2px solid #9b59b6",
            borderRadius: "8px",
            minWidth: "400px",
            maxWidth: "500px",
            maxHeight: "400px",
            overflowY: "auto",
            zIndex: 2000,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
          }}
        >
          <div
            style={{
              padding: "10px 15px",
              borderBottom: "1px solid #555",
              fontWeight: "bold",
              fontSize: "13px",
              color: "#9b59b6",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Stored Log Files</span>
            <button
              onClick={handleToggle}
              style={{
                background: "transparent",
                border: "none",
                color: "#aaa",
                fontSize: "16px",
                cursor: "pointer",
                padding: "0 5px",
              }}
              title="Close"
            >
              ✕
            </button>
          </div>

          <div style={{ padding: "5px" }}>
            {isLoading ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#aaa" }}>
                Loading...
              </div>
            ) : files.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#aaa" }}>
                No log files found
              </div>
            ) : (
              files.map((file) => (
                <div
                  key={file.fileName}
                  style={{
                    padding: "10px",
                    margin: "5px",
                    background: "rgba(50, 50, 50, 0.5)",
                    borderRadius: "4px",
                    fontSize: "11px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "5px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "#4ecdc4", fontWeight: "bold", marginBottom: "3px" }}>
                        {file.fileName}
                      </div>
                      <div style={{ color: "#aaa", fontSize: "10px" }}>
                        {formatTimestamp(file.createdAt)} • {formatFileSize(file.size)} • {file.recordCount.toLocaleString()} records
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "5px" }}>
                    <button
                      onClick={() => handleDownload(file)}
                      style={{
                        flex: 1,
                        padding: "4px 8px",
                        background: "#3498db",
                        color: "white",
                        border: "1px solid #2980b9",
                        borderRadius: "3px",
                        fontSize: "10px",
                        cursor: "pointer",
                        fontWeight: "bold",
                      }}
                    >
                      📥 Download
                    </button>
                    <button
                      onClick={() => handleDelete(file)}
                      style={{
                        flex: 1,
                        padding: "4px 8px",
                        background: "#e74c3c",
                        color: "white",
                        border: "1px solid #c0392b",
                        borderRadius: "3px",
                        fontSize: "10px",
                        cursor: "pointer",
                        fontWeight: "bold",
                      }}
                    >
                      🗑️ Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LogFileManager;
