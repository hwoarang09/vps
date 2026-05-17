import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  listSimLogFiles,
  downloadSimLogFile,
  deleteSimLogFile,
  clearAllSimLogs,
  extractSessionId,
  type SimLogFileInfo,
} from "@/logger";
import LogSettingsPanel from "@/components/react/menu/panels/LogSettingsPanel";

type LogTab = "settings" | "download";

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
  const [tab, setTab] = useState<LogTab>("settings");

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
    groups.sort((a, b) => b.sessionId.localeCompare(a.sessionId));
    return groups;
  }, [files]);

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

  const shortLabel = (sid: string): string => {
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
    <div className="relative">
      {!hideButton && (
        <button
          onClick={handleToggle}
          className="px-2.5 py-1 bg-panel-bg-light hover:bg-panel-bg text-zinc-200 border border-panel-border rounded text-xs font-bold cursor-pointer"
        >
          SimLogs({sessions.length})
        </button>
      )}

      {isOpen && (
        <div className="absolute top-full mt-1 right-0 min-w-[420px] max-w-[520px] max-h-[500px] overflow-y-auto rounded-md bg-panel-bg border border-panel-border shadow-lg backdrop-blur z-[2000]">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-panel-border">
            <span className="text-zinc-200 text-sm font-bold">SimLogger</span>
            <div className="flex items-center gap-2">
              {tab === "download" && files.length > 0 && (
                <button
                  onClick={handleDeleteAll}
                  className="px-2 py-1 bg-red-700 hover:bg-red-600 text-white text-[10px] font-bold rounded cursor-pointer border border-red-600"
                >
                  Delete All
                </button>
              )}
              <button
                onClick={handleToggle}
                className="text-zinc-400 hover:text-zinc-200 text-base px-1 cursor-pointer"
              >
                ×
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-panel-border">
            {([
              { id: "settings", label: "설정" },
              { id: "download", label: `다운로드 (${sessions.length})` },
            ] as { id: LogTab; label: string }[]).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-1.5 text-xs font-bold cursor-pointer border-b-2 transition-colors ${
                  tab === t.id
                    ? "bg-cyan-400/10 border-cyan-400 text-cyan-300"
                    : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-panel-bg-light/30"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Settings tab */}
          {tab === "settings" && <LogSettingsPanel />}

          {/* Download tab */}
          {tab === "download" && (
            <>
              {/* Session selector */}
              {sessions.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 border-b border-panel-border">
                  <select
                    value={selectedSession ?? ""}
                    onChange={(e) => setSelectedSession(e.target.value)}
                    className="flex-1 bg-panel-bg-solid text-zinc-300 border border-panel-border rounded px-2 py-1 text-xs cursor-pointer"
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
                    className="px-2 py-1 bg-blue-700 hover:bg-blue-600 text-white text-[10px] font-bold rounded cursor-pointer flex-shrink-0"
                  >
                    DL All
                  </button>
                  <button
                    onClick={handleDeleteSession}
                    title="Delete all files in this session"
                    className="px-2 py-1 bg-red-700 hover:bg-red-600 text-white text-[10px] font-bold rounded cursor-pointer flex-shrink-0"
                  >
                    Del
                  </button>
                </div>
              )}

              {/* File list */}
              <div className="p-1.5">
                {isLoading ? (
                  <div className="py-5 text-center text-zinc-500 text-sm">Loading...</div>
                ) : !currentGroup ? (
                  <div className="py-5 text-center text-zinc-500 text-sm">No SimLog files</div>
                ) : (
                  currentGroup.files.map((file) => (
                    <div
                      key={file.fileName}
                      className="flex items-center gap-2.5 px-2.5 py-2 m-1 bg-panel-bg-solid/50 border border-panel-border rounded text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-zinc-300 font-bold mb-0.5">{file.eventType}</div>
                        <div className="text-zinc-500 text-[10px]">
                          {formatSize(file.size)} | {file.recordCount.toLocaleString()} records
                        </div>
                      </div>
                      <button
                        onClick={() => handleDownload(file)}
                        className="px-2 py-1 bg-blue-700 hover:bg-blue-600 text-white text-[10px] font-bold rounded cursor-pointer flex-shrink-0"
                      >
                        DL
                      </button>
                      <button
                        onClick={() => handleDelete(file)}
                        className="px-2 py-1 bg-red-700 hover:bg-red-600 text-white text-[10px] font-bold rounded cursor-pointer flex-shrink-0"
                      >
                        Del
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SimLogFileManager;
