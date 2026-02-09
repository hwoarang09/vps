import React, { useState, useEffect, useCallback } from "react";
import {
  listFbLogFiles,
  downloadFbLogFile,
  deleteFbLogFiles,
  clearAllFbLogs,
  type FbLogFileInfo,
} from "@/logger";

interface FbLogFileManagerProps {
  isOpen: boolean;
  onToggle: () => void;
  hideButton?: boolean;
}

/**
 * FbLogFileManager
 *
 * FlatBuffers 로그 파일(.bin) 관리 UI
 * - 개별 파일 다운로드
 * - 선택한 파일 다운로드
 * - 선택/전체 삭제
 */
const FbLogFileManager: React.FC<FbLogFileManagerProps> = ({ isOpen, onToggle, hideButton = false }) => {
  const [files, setFiles] = useState<FbLogFileInfo[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await listFbLogFiles();
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

  const handleSelectAll = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map((f) => f.fileName)));
    }
  };

  const handleSelectFile = (fileName: string) => {
    const newSet = new Set(selectedFiles);
    if (newSet.has(fileName)) {
      newSet.delete(fileName);
    } else {
      newSet.add(fileName);
    }
    setSelectedFiles(newSet);
  };

  const handleDownloadSingle = async (file: FbLogFileInfo) => {
    try {
      const buffer = await downloadFbLogFile(file.fileName);
      const blob = new Blob([buffer], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(`다운로드 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedFiles.size === 0) {
      alert("파일을 선택해주세요");
      return;
    }

    const selectedFileNames = Array.from(selectedFiles);
    for (const fileName of selectedFileNames) {
      try {
        const buffer = await downloadFbLogFile(fileName);
        const blob = new Blob([buffer], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        // 브라우저가 다운로드를 처리할 시간을 줌
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        alert(`다운로드 실패 (${fileName}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedFiles.size === 0) {
      alert("파일을 선택해주세요");
      return;
    }

    if (!confirm(`선택한 ${selectedFiles.size}개 파일을 삭제하시겠습니까?`)) {
      return;
    }

    const result = await deleteFbLogFiles(Array.from(selectedFiles));

    if (result.failed.length > 0) {
      alert(`${result.deleted.length}개 삭제됨, ${result.failed.length}개 실패 (Worker가 사용중인 파일)`);
    }

    const newSelected = new Set(selectedFiles);
    for (const fileName of result.deleted) {
      newSelected.delete(fileName);
    }
    setSelectedFiles(newSelected);
    await loadFiles();
  };

  const handleDeleteAll = async () => {
    if (files.length === 0) {
      alert("삭제할 파일이 없습니다");
      return;
    }

    if (!confirm(`모든 FbLog 파일(${files.length}개)을 삭제하시겠습니까?`)) {
      return;
    }

    const result = await clearAllFbLogs();

    if (result.failed.length > 0) {
      alert(`${result.deleted.length}개 삭제됨, ${result.failed.length}개 실패 (Worker가 사용중인 파일)`);
    } else {
      alert(`${result.deleted.length}개 파일 삭제됨`);
    }

    setSelectedFiles(new Set());
    await loadFiles();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const ACCENT = "#8e44ad"; // purple accent
  const ACCENT_BORDER = "#6c3483";

  return (
    <div style={{ position: "relative" }}>
      {!hideButton && (
        <button
          onClick={handleToggle}
          style={{
            padding: "3px 10px",
            background: ACCENT,
            color: "white",
            border: `2px solid ${ACCENT_BORDER}`,
            borderRadius: "4px",
            fontSize: "12px",
            cursor: "pointer",
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
          title="FlatBuffers 로그 파일 관리"
        >
          FbLogs({files.length})
        </button>
      )}

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 5px)",
            right: 0,
            background: "rgba(20, 20, 20, 0.98)",
            border: `2px solid ${ACCENT}`,
            borderRadius: "8px",
            minWidth: "450px",
            maxWidth: "550px",
            maxHeight: "450px",
            overflowY: "auto",
            zIndex: 2000,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
          }}
        >
          {/* 헤더 */}
          <div
            style={{
              padding: "10px 15px",
              borderBottom: "1px solid #555",
              fontWeight: "bold",
              fontSize: "13px",
              color: ACCENT,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>FlatBuffers 로그 파일</span>
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
              ✕
            </button>
          </div>

          {/* 액션 버튼들 */}
          <div
            style={{
              padding: "10px 15px",
              borderBottom: "1px solid #333",
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={handleSelectAll}
              style={{
                padding: "4px 10px",
                background: selectedFiles.size === files.length && files.length > 0 ? "#3498db" : "#555",
                color: "white",
                border: "1px solid #444",
                borderRadius: "3px",
                fontSize: "10px",
                cursor: "pointer",
              }}
            >
              {selectedFiles.size === files.length && files.length > 0 ? "✓ 전체선택됨" : "□ 전체선택"}
            </button>
            <button
              onClick={handleDownloadSelected}
              disabled={selectedFiles.size === 0}
              style={{
                padding: "4px 10px",
                background: selectedFiles.size > 0 ? "#3498db" : "#555",
                color: "white",
                border: "1px solid #444",
                borderRadius: "3px",
                fontSize: "10px",
                cursor: selectedFiles.size > 0 ? "pointer" : "not-allowed",
              }}
            >
              선택 다운로드 ({selectedFiles.size})
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={selectedFiles.size === 0}
              style={{
                padding: "4px 10px",
                background: selectedFiles.size > 0 ? "#e74c3c" : "#555",
                color: "white",
                border: "1px solid #444",
                borderRadius: "3px",
                fontSize: "10px",
                cursor: selectedFiles.size > 0 ? "pointer" : "not-allowed",
              }}
            >
              선택 삭제
            </button>
            <button
              onClick={handleDeleteAll}
              disabled={files.length === 0}
              style={{
                padding: "4px 10px",
                background: files.length > 0 ? "#c0392b" : "#555",
                color: "white",
                border: "1px solid #444",
                borderRadius: "3px",
                fontSize: "10px",
                cursor: files.length > 0 ? "pointer" : "not-allowed",
                marginLeft: "auto",
              }}
            >
              전체 삭제
            </button>
          </div>

          {/* 파일 목록 */}
          <div style={{ padding: "5px" }}>
            {isLoading ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#aaa" }}>
                Loading...
              </div>
            ) : files.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#aaa" }}>
                FbLog 파일이 없습니다
              </div>
            ) : (
              files.map((file) => (
                <div
                  key={file.fileName}
                  style={{
                    padding: "8px 10px",
                    margin: "5px",
                    background: selectedFiles.has(file.fileName)
                      ? "rgba(142, 68, 173, 0.2)"
                      : "rgba(50, 50, 50, 0.5)",
                    borderRadius: "4px",
                    fontSize: "11px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    border: selectedFiles.has(file.fileName) ? `1px solid ${ACCENT}` : "1px solid transparent",
                    cursor: "pointer",
                  }}
                  onClick={() => handleSelectFile(file.fileName)}
                >
                  {/* 체크박스 */}
                  <div
                    style={{
                      width: "16px",
                      height: "16px",
                      border: "2px solid #555",
                      borderRadius: "3px",
                      background: selectedFiles.has(file.fileName) ? ACCENT : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {selectedFiles.has(file.fileName) && (
                      <span style={{ color: "white", fontSize: "10px" }}>✓</span>
                    )}
                  </div>

                  {/* 파일 정보 */}
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
                      {formatTimestamp(file.createdAt)} • {formatFileSize(file.size)}
                    </div>
                  </div>

                  {/* 개별 다운로드 버튼 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownloadSingle(file);
                    }}
                    style={{
                      padding: "3px 8px",
                      background: "#3498db",
                      color: "white",
                      border: "1px solid #2980b9",
                      borderRadius: "3px",
                      fontSize: "10px",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    DL
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

export default FbLogFileManager;
