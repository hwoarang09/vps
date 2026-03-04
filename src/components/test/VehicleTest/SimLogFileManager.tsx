import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  listSimLogFiles,
  downloadSimLogFile,
  deleteSimLogFile,
  clearAllSimLogs,
  extractSessionId,
  type SimLogFileInfo,
} from "@/logger";

interface SimLogFileManagerProps {
  isOpen: boolean;
  onToggle: () => void;
  hideButton?: boolean;
}

interface SessionGroup {
  sessionId: string;
  files: SimLogFileInfo[];
  totalSize: number;
}

const SimLogFileManager: React.FC<SimLogFileManagerProps> = ({ isOpen, onToggle, hideButton = false }) => {
  const [files, setFiles] = useState<SimLogFileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

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

  // Group files by sessionId
  const sessions = useMemo<SessionGroup[]>(() => {
    const map = new Map<string, SimLogFileInfo[]>();
    for (const file of files) {
      const sid = extractSessionId(file.fileName) ?? "unknown";
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid)!.push(file);
    }
    const groups: SessionGroup[] = [];
    for (const [sessionId, sessionFiles] of map) {
      groups.push({
        sessionId,
        files: sessionFiles,
        totalSize: sessionFiles.reduce((s, f) => s + f.size, 0),
      });
    }
    // newest first (sessionId contains timestamp)
    groups.sort((a, b) => b.sessionId.localeCompare(a.sessionId));
    return groups;
  }, [files]);

  // Auto-select first session
  useEffect(() => {
    if (sessions.length > 0 && (!selectedSession || !sessions.find(s => s.sessionId === selectedSession))) {
      setSelectedSession(sessions[0].sessionId);
    }
    if (sessions.length === 0) setSelectedSession(null);
  }, [sessions, selectedSession]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleToggle = async () => {
    if (!isOpen) await loadFiles();
    onToggle();
  };

  const handleDownload = async (file: SimLogFileInfo) => {
    try {
      await downloadSimLogFile(file.fileName);
    } catch (error) {
      alert(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDownloadSession = async () => {
    const group = sessions.find(s => s.sessionId === selectedSession);
    if (!group) return;
    for (const file of group.files) {
      await downloadSimLogFile(file.fileName);
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

  const handleDeleteSession = async () => {
    const group = sessions.find(s => s.sessionId === selectedSession);
    if (!group) return;
    if (!confirm(`Delete all ${group.files.length} files of this session?`)) return;
    for (const file of group.files) {
      try { await deleteSimLogFile(file.fileName); } catch { /* skip */ }
    }
    await loadFiles();
  };

  const handleDeleteAll = async () => {
    if (files.length === 0) return;
    if (!confirm(`Delete all ${files.length} SimLog files (${sessions.length} sessions)?`)) return;
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

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  /** sessionId에서 짧은 표시명 생성 */
  const shortLabel = (sid: string): string => {
    // "sim_fab_0_0_1772566076417" → timestamp 부분 추출해서 시간으로 변환
    const match = sid.match(/(\d{13})$/);
    if (match) {
      const d = new Date(Number(match[1]));
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    return sid.length > 20 ? `...${sid.slice(-20)}` : sid;
  };

  const currentGroup = sessions.find(s => s.sessionId === selectedSession);

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
          SimLogs({sessions.length})
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
            minWidth: "420px",
            maxWidth: "520px",
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

          {/* Session selector */}
          {sessions.length > 0 && (
            <div
              style={{
                padding: "8px 15px",
                borderBottom: "1px solid #444",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <select
                value={selectedSession ?? ""}
                onChange={(e) => setSelectedSession(e.target.value)}
                style={{
                  flex: 1,
                  background: "#2a2a2a",
                  color: "#ddd",
                  border: "1px solid #666",
                  borderRadius: "4px",
                  padding: "4px 8px",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                {sessions.map((s) => (
                  <option key={s.sessionId} value={s.sessionId}>
                    {shortLabel(s.sessionId)} ({s.files.length} files, {formatSize(s.totalSize)})
                  </option>
                ))}
              </select>
              <button
                onClick={handleDownloadSession}
                title="Download all files in this session"
                style={{
                  padding: "3px 8px",
                  background: "#3498db",
                  color: "white",
                  border: "none",
                  borderRadius: "3px",
                  fontSize: "10px",
                  cursor: "pointer",
                  fontWeight: "bold",
                  flexShrink: 0,
                }}
              >
                DL All
              </button>
              <button
                onClick={handleDeleteSession}
                title="Delete all files in this session"
                style={{
                  padding: "3px 8px",
                  background: "#e74c3c",
                  color: "white",
                  border: "none",
                  borderRadius: "3px",
                  fontSize: "10px",
                  cursor: "pointer",
                  fontWeight: "bold",
                  flexShrink: 0,
                }}
              >
                Del
              </button>
            </div>
          )}

          {/* File list for selected session */}
          <div style={{ padding: "5px" }}>
            {isLoading ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#aaa" }}>Loading...</div>
            ) : !currentGroup ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#aaa" }}>No SimLog files</div>
            ) : (
              currentGroup.files.map((file) => (
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
                      }}
                    >
                      {file.eventType}
                    </div>
                    <div style={{ color: "#aaa", fontSize: "10px" }}>
                      {formatSize(file.size)} | {file.recordCount.toLocaleString()} records
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
