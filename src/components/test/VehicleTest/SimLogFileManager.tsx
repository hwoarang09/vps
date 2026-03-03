import React, { useState, useEffect, useCallback } from "react";
import {
  listSimLogFiles,
  downloadSimLogFile,
  deleteSimLogFile,
  clearAllSimLogs,
  type SimLogFileInfo,
} from "@/logger";

interface SimLogFileManagerProps {
  isOpen: boolean;
  onToggle: () => void;
  hideButton?: boolean;
}

const SimLogFileManager: React.FC<SimLogFileManagerProps> = ({ isOpen, onToggle, hideButton = false }) => {
  const [files, setFiles] = useState<SimLogFileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await listSimLogFiles();
      setFiles(result);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleToggle = async () => {
    if (!isOpen) {
      await loadFiles();
    }
    onToggle();
  };

  const handleDownload = async (file: SimLogFileInfo) => {
    try {
      await downloadSimLogFile(file.fileName);
    } catch (error) {
      alert(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDelete = async (file: SimLogFileInfo) => {
    if (!confirm(`Delete ${file.fileName}?`)) return;

    try {
      await deleteSimLogFile(file.fileName);
      await loadFiles();
    } catch (error) {
      alert(`Delete failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDeleteAll = async () => {
    if (files.length === 0) return;
    if (!confirm(`Delete all ${files.length} SimLog files?`)) return;

    try {
      const result = await clearAllSimLogs();
      if (result.failed.length > 0) {
        alert(`${result.deleted.length} deleted, ${result.failed.length} failed (locked by Worker)`);
      }
      await loadFiles();
    } catch (error) {
      alert(`Delete failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div style={{ position: "relative" }}>
      {!hideButton && (
        <button
          onClick={handleToggle}
          style={{
            padding: "3px 10px",
            background: "#9b59b6",
            color: "white",
            border: "2px solid #8e44ad",
            borderRadius: "4px",
            fontSize: "12px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          SimLogs({files.length})
        </button>
      )}

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
            maxHeight: "500px",
            overflowY: "auto",
            zIndex: 2000,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
          }}
        >
          {/* Header */}
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
            <span>SimLogger Files</span>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {files.length > 0 && (
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
              >
                x
              </button>
            </div>
          </div>

          {/* File list */}
          <div style={{ padding: "5px" }}>
            {isLoading ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#aaa" }}>Loading...</div>
            ) : files.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#aaa" }}>No SimLog files</div>
            ) : (
              files.map((file) => (
                <div
                  key={file.fileName}
                  style={{
                    padding: "8px 10px",
                    margin: "5px",
                    background: "rgba(50, 50, 50, 0.5)",
                    borderRadius: "4px",
                    fontSize: "11px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    border: "1px solid #444",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        color: "#bb8fce",
                        fontWeight: "bold",
                        marginBottom: "2px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {file.fileName}
                    </div>
                    <div style={{ color: "#aaa", fontSize: "10px" }}>
                      {file.eventType} | {formatFileSize(file.size)} | {file.recordCount.toLocaleString()} records
                    </div>
                  </div>
                  <button
                    onClick={() => handleDownload(file)}
                    style={{
                      padding: "3px 8px",
                      background: "#3498db",
                      color: "white",
                      border: "none",
                      borderRadius: "3px",
                      fontSize: "10px",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    DL
                  </button>
                  <button
                    onClick={() => handleDelete(file)}
                    style={{
                      padding: "3px 8px",
                      background: "#e74c3c",
                      color: "white",
                      border: "none",
                      borderRadius: "3px",
                      fontSize: "10px",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    Del
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SimLogFileManager;
