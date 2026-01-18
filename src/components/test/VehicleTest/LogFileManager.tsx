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

interface ParsedFileInfo extends LogFileInfo {
  sessionId: string;
  vehId: number | null; // null이면 통합 파일
}

/**
 * 파일명에서 sessionId와 vehId 파싱
 * edge_transit_{sessionId}.bin -> { sessionId, vehId: null }
 * edge_transit_{sessionId}_veh{vehId}.bin -> { sessionId, vehId }
 */
function parseFileName(fileName: string): { sessionId: string; vehId: number | null } {
  // veh별 파일: edge_transit_{sessionId}_veh{vehId}.bin
  const vehMatch = /edge_transit_(\d+)_veh(\d+)\.bin/.exec(fileName);
  if (vehMatch) {
    return { sessionId: vehMatch[1], vehId: Number.parseInt(vehMatch[2], 10) };
  }

  // 통합 파일: edge_transit_{sessionId}.bin
  const match = /edge_transit_(\d+)\.bin/.exec(fileName);
  if (match) {
    return { sessionId: match[1], vehId: null };
  }

  return { sessionId: "", vehId: null };
}

/**
 * 파일들을 세션별로 그룹화
 */
function groupFilesBySession(files: LogFileInfo[]): Map<string, ParsedFileInfo[]> {
  const groups = new Map<string, ParsedFileInfo[]>();

  for (const file of files) {
    const parsed = parseFileName(file.fileName);
    const parsedFile: ParsedFileInfo = { ...file, ...parsed };

    const existing = groups.get(parsed.sessionId) ?? [];
    existing.push(parsedFile);
    groups.set(parsed.sessionId, existing);
  }

  // 각 그룹 내에서 통합파일 먼저, 그 다음 vehId 순으로 정렬
  for (const [sessionId, sessionFiles] of groups) {
    sessionFiles.sort((a, b) => {
      if (a.vehId === null) return -1;
      if (b.vehId === null) return 1;
      return a.vehId - b.vehId;
    });
    groups.set(sessionId, sessionFiles);
  }

  return groups;
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
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

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

  const toggleSessionExpand = (sessionId: string) => {
    setExpandedSessions(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
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
  const isCurrentSession = (sessionId: string): boolean => {
    if (!isRunning || files.length === 0) return false;
    const newestParsed = parseFileName(files[0].fileName);
    return newestParsed.sessionId === sessionId;
  };

  const groupedFiles = groupFilesBySession(files);
  const sessionIds = Array.from(groupedFiles.keys()).sort((a, b) => Number(b) - Number(a));

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
            minWidth: "450px",
            maxWidth: "550px",
            maxHeight: "500px",
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
              sessionIds.map((sessionId) => {
                const sessionFiles = groupedFiles.get(sessionId) ?? [];
                const vehFiles = sessionFiles.filter(f => f.vehId !== null);
                const hasVehFiles = vehFiles.length > 0;
                const isExpanded = expandedSessions.has(sessionId);
                const isCurrent = isCurrentSession(sessionId);

                // 세션의 총 레코드 수와 크기
                const totalRecords = sessionFiles.reduce((sum, f) => sum + f.recordCount, 0);
                const totalSize = sessionFiles.reduce((sum, f) => sum + f.size, 0);

                return (
                  <div
                    key={sessionId}
                    style={{
                      margin: "5px",
                      background: isCurrent
                        ? "rgba(46, 204, 113, 0.15)"
                        : "rgba(50, 50, 50, 0.5)",
                      borderRadius: "6px",
                      border: isCurrent ? "1px solid #2ecc71" : "1px solid #444",
                      overflow: "hidden",
                    }}
                  >
                    {/* 세션 헤더 */}
                    <div
                      style={{
                        padding: "10px",
                        cursor: hasVehFiles ? "pointer" : "default",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        borderBottom: isExpanded && hasVehFiles ? "1px solid #444" : "none",
                      }}
                      onClick={() => hasVehFiles && toggleSessionExpand(sessionId)}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                          {hasVehFiles && (
                            <span style={{ color: "#888", fontSize: "10px" }}>
                              {isExpanded ? "▼" : "▶"}
                            </span>
                          )}
                          <span style={{ color: "#4ecdc4", fontWeight: "bold", fontSize: "12px" }}>
                            Session {sessionId}
                          </span>
                          {isCurrent && (
                            <span style={{ color: "#2ecc71", fontSize: "9px", background: "rgba(46,204,113,0.3)", padding: "1px 5px", borderRadius: "3px" }}>
                              LIVE
                            </span>
                          )}
                          {hasVehFiles && (
                            <span style={{ color: "#e67e22", fontSize: "9px", background: "rgba(230,126,34,0.3)", padding: "1px 5px", borderRadius: "3px" }}>
                              {vehFiles.length} vehicles
                            </span>
                          )}
                        </div>
                        <div style={{ color: "#aaa", fontSize: "10px" }}>
                          {formatTimestamp(Number(sessionId))} • {formatFileSize(totalSize)} • {totalRecords.toLocaleString()} records
                        </div>
                      </div>
                    </div>

                    {/* veh별 파일 목록 (확장 시) */}
                    {isExpanded && hasVehFiles && (
                      <div style={{ padding: "5px 10px 10px 10px" }}>
                        {sessionFiles.map((file) => (
                          <div
                            key={file.fileName}
                            style={{
                              padding: "8px",
                              margin: "3px 0",
                              background: "rgba(0, 0, 0, 0.3)",
                              borderRadius: "4px",
                              fontSize: "10px",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ color: file.vehId !== null ? "#f39c12" : "#3498db", fontWeight: "bold", marginBottom: "2px" }}>
                                  {file.vehId !== null ? `🚗 Vehicle ${file.vehId}` : "📦 Combined (all vehicles)"}
                                </div>
                                <div style={{ color: "#888", fontSize: "9px" }}>
                                  {formatFileSize(file.size)} • {file.recordCount.toLocaleString()} records
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: "4px" }}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDownload(file); }}
                                  style={{
                                    padding: "3px 8px",
                                    background: "#3498db",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "3px",
                                    fontSize: "9px",
                                    cursor: "pointer",
                                    fontWeight: "bold",
                                  }}
                                >
                                  📥
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDelete(file); }}
                                  disabled={isCurrent}
                                  style={{
                                    padding: "3px 8px",
                                    background: isCurrent ? "#555" : "#e74c3c",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "3px",
                                    fontSize: "9px",
                                    cursor: isCurrent ? "not-allowed" : "pointer",
                                    fontWeight: "bold",
                                  }}
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* veh 파일 없을 때 (통합 파일만) */}
                    {!hasVehFiles && (
                      <div style={{ padding: "0 10px 10px 10px" }}>
                        <div style={{ display: "flex", gap: "5px" }}>
                          <button
                            onClick={() => handleDownload(sessionFiles[0])}
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
                            onClick={() => handleDelete(sessionFiles[0])}
                            disabled={isCurrent}
                            style={{
                              flex: 1,
                              padding: "4px 8px",
                              background: isCurrent ? "#555" : "#e74c3c",
                              color: "white",
                              border: isCurrent ? "1px solid #444" : "1px solid #c0392b",
                              borderRadius: "3px",
                              fontSize: "10px",
                              cursor: isCurrent ? "not-allowed" : "pointer",
                              fontWeight: "bold",
                            }}
                            title={isCurrent ? "Cannot delete current session" : "Delete file"}
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LogFileManager;
