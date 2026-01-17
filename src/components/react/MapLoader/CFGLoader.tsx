import React, { useEffect, useState } from "react";
import { useCFGStore } from "@/store/system/cfgStore";
import { useMenuStore } from "@/store/ui/menuStore";
import { getAvailableMapFolders } from "@/config/testSettingConfig";

/**
 * CFGLoader component - Handles CFG file loading with folder selection
 */
const CFGLoader: React.FC = () => {
  const [showModal, setShowModal] = useState(true);
  const [availableFolders, setAvailableFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const { isLoading, error, loadCFGFiles } = useCFGStore();
  const { setActiveMainMenu } = useMenuStore();

  // Load available map folders when component mounts
  useEffect(() => {
    const loadFolders = async () => {
      try {
        const folders = await getAvailableMapFolders();
        setAvailableFolders(folders);
      } catch (error) {
      } finally {
        setLoadingFolders(false);
      }
    };
    loadFolders();
  }, []);

  // Auto-close modal after successful load
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (!isLoading && !error && selectedFolder) {
      timer = setTimeout(() => {
        setShowModal(false);
        setActiveMainMenu(null); // Close any active menu
      }, 2000); // Auto-close after 2 seconds
    }
    return () => clearTimeout(timer);
  }, [isLoading, error, selectedFolder, setActiveMainMenu]);

  const handleFolderSelect = async (folder: string) => {
    setSelectedFolder(folder);
    try {
      await loadCFGFiles(folder);
    } catch (error) {
    }
  };

  const handleClose = () => {
    setShowModal(false);
    setActiveMainMenu(null);
  };

  const handleRetry = () => {
    if (selectedFolder) {
      handleFolderSelect(selectedFolder);
    }
  };

  // Don't render if modal is hidden
  if (!showModal) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        background: "rgba(0, 0, 0, 0.8)",
        color: "white",
        padding: "20px",
        borderRadius: "8px",
        textAlign: "center",
        zIndex: 1000,
        minWidth: "300px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "15px",
        }}
      >
        <h3 style={{ margin: "0", fontSize: "18px" }}>CFG Map Loader</h3>
        <button
          onClick={handleClose}
          style={{
            background: "transparent",
            border: "none",
            color: "#999",
            fontSize: "20px",
            cursor: "pointer",
            padding: "0",
            width: "24px",
            height: "24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Close"
        >
          ×
        </button>
      </div>

      {loadingFolders ? (
        <div>
          <p style={{ margin: "0", fontSize: "14px" }}>
            Loading available maps...
          </p>
        </div>
      ) : !selectedFolder ? (
        <div>
          <p style={{ margin: "0 0 15px 0", fontSize: "14px" }}>
            Select a map to load:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {availableFolders.map((folder) => (
              <button
                key={folder}
                onClick={() => handleFolderSelect(folder)}
                style={{
                  background: "#4ecdc4",
                  color: "white",
                  border: "none",
                  padding: "12px 16px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "bold",
                }}
              >
                {folder}
              </button>
            ))}
          </div>
        </div>
      ) : isLoading ? (
        <div>
          <div
            style={{
              width: "40px",
              height: "40px",
              border: "4px solid #333",
              borderTop: "4px solid #fff",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 15px auto",
            }}
          />
          <p style={{ margin: "0", fontSize: "14px" }}>
            Loading CFG files from {selectedFolder}...
          </p>
        </div>
      ) : error ? (
        <div>
          <p
            style={{
              margin: "0 0 15px 0",
              fontSize: "14px",
              color: "#ff6b6b",
            }}
          >
            Error: {error}
          </p>
          <button
            onClick={handleRetry}
            style={{
              background: "#ff6b6b",
              color: "white",
              border: "none",
              padding: "8px 16px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        <div>
          <p
            style={{
              margin: "0 0 15px 0",
              fontSize: "14px",
              color: "#4ecdc4",
            }}
          >
            CFG map data loaded successfully from {selectedFolder}!
          </p>
          <div
            style={{ display: "flex", gap: "10px", justifyContent: "center" }}
          >
            <button
              onClick={handleRetry}
              style={{
                background: "#4ecdc4",
                color: "white",
                border: "none",
                padding: "8px 16px",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              Reload
            </button>
            <button
              onClick={handleClose}
              style={{
                background: "#666",
                color: "white",
                border: "none",
                padding: "8px 16px",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default CFGLoader;
