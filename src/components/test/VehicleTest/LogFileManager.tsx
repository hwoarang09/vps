import React, { useState, useEffect, useCallback } from "react";
import { useShmSimulatorStore } from "@store/vehicle/shmMode/shmSimulatorStore";
import {
  listLogFiles as listLogFilesFromOPFS,
  downloadLogFile as downloadLogFileFromOPFS,
  deleteLogFile as deleteLogFileFromOPFS,
  clearAllLogs,
} from "@/logger";

interface LogFileInfo {
  fileName: string;
  size: number;
  recordCount: number;
  createdAt: number;
}

/**
 * LogFileManager
 *
 * Dropdown component for managing OPFS log files
 * Uses direct OPFS access so it works without simulation running
 */
const LogFileManager: React.FC = () => {
  const { isRunning } = useShmSimulatorStore();
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await listLogFilesFromOPFS();
      setFiles(result);
    } catch {
      // Silently fail on initial load
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load files on mount
  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleToggle = async () => {
    if (!isOpen) {
      await loadFiles();
    }
    setIsOpen(!isOpen);
  };

  const handleDownload = async (file: LogFileInfo) => {
    try {
      const result = await downloadLogFileFromOPFS(file.fileName);

      const blob = new Blob([result.buffer], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName;
      a.click();
      URL.revokeObjectURL(url);

      alert(`Downloaded: ${result.fileName}\nRecords: ${result.recordCount}\nSize: ${(result.buffer.byteLength / 1024).toFixed(2)} KB`);
    } catch (error) {
      alert(`Failed to download: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDelete = async (file: LogFileInfo) => {
    if (!confirm(`Delete ${file.fileName}?\n\nThis will permanently remove the file from OPFS.`)) {
      return;
    }

    try {
      await deleteLogFileFromOPFS(file.fileName);
      alert(`Deleted: ${file.fileName}`);

      await loadFiles();
    } catch (error) {
      alert(`Failed to delete: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDeleteAll = async () => {
    if (files.length === 0) {
      alert("No files to delete");
      return;
    }

    // If running, exclude the newest file (current session)
    const newestFile = isRunning && files.length > 0 ? files[0].fileName : undefined;
    const deleteCount = newestFile ? files.length - 1 : files.length;

    if (deleteCount === 0) {
      alert("Cannot delete current session file while running");
      return;
    }

    const message = newestFile
      ? `Delete ${deleteCount} log files?\n(Current session file will be kept)\n\nThis will permanently remove files from OPFS.`
      : `Delete ALL ${files.length} log files?\n\nThis will permanently remove all files from OPFS.`;

    if (!confirm(message)) {
      return;
    }

    try {
      const deletedCount = await clearAllLogs(newestFile);
      alert(`Deleted ${deletedCount} files`);

      await loadFiles();
    } catch (error) {
      alert(`Failed to delete all: ${error instanceof Error ? error.message : String(error)}`);
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

  // Check if file is current session (newest file when running)
  const isCurrentSession = (file: LogFileInfo): boolean => {
    return isRunning && files.length > 0 && file.fileName === files[0].fileName;
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
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {files.length > (isRunning ? 1 : 0) && (
                <button
                  onClick={handleDeleteAll}
                  style={{
                    background: "#c0392b",
                    border: "1px solid #a93226",
                    color: "white",
                    fontSize: "10px",
                    cursor: "pointer",
                    padding: "3px 8px",
                    borderRadius: "3px",
                    fontWeight: "bold",
                  }}
                  title="Delete all log files (except current session)"
                >
                  Delete All
                </button>
              )}
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
                    background: isCurrentSession(file)
                      ? "rgba(46, 204, 113, 0.2)"
                      : "rgba(50, 50, 50, 0.5)",
                    borderRadius: "4px",
                    fontSize: "11px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "5px",
                    border: isCurrentSession(file) ? "1px solid #2ecc71" : "none",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "#4ecdc4", fontWeight: "bold", marginBottom: "3px", display: "flex", alignItems: "center", gap: "5px" }}>
                        {file.fileName}
                        {isCurrentSession(file) && (
                          <span style={{ color: "#2ecc71", fontSize: "9px", fontWeight: "normal" }}>(current)</span>
                        )}
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
                      disabled={isCurrentSession(file)}
                      style={{
                        flex: 1,
                        padding: "4px 8px",
                        background: isCurrentSession(file) ? "#555" : "#e74c3c",
                        color: "white",
                        border: isCurrentSession(file) ? "1px solid #444" : "1px solid #c0392b",
                        borderRadius: "3px",
                        fontSize: "10px",
                        cursor: isCurrentSession(file) ? "not-allowed" : "pointer",
                        fontWeight: "bold",
                      }}
                      title={isCurrentSession(file) ? "Cannot delete current session" : "Delete file"}
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
