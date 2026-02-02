import React, { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";

/**
 * UnusualMove 발생 시 표시되는 모달
 * 연결되지 않은 edge로 이동하는 버그 발생 시 시뮬레이션을 중지하고 정보를 표시합니다.
 */
const UnusualMoveModal: React.FC = () => {
  const unusualMove = useShmSimulatorStore((s) => s.unusualMove);
  const clearUnusualMove = useShmSimulatorStore((s) => s.clearUnusualMove);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const handleClose = () => {
    dialogRef.current?.close();
    clearUnusualMove();
  };

  // Show/hide dialog based on unusualMove state
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (unusualMove && !dialog.open) {
      dialog.showModal();
    } else if (!unusualMove && dialog.open) {
      dialog.close();
    }
  }, [unusualMove]);

  // Handle backdrop click and Escape key
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClick = (e: MouseEvent) => {
      if (e.target === dialog) {
        handleClose();
      }
    };

    const handleCancel = (e: Event) => {
      e.preventDefault();
      handleClose();
    };

    dialog.addEventListener("click", handleClick);
    dialog.addEventListener("cancel", handleCancel);

    return () => {
      dialog.removeEventListener("click", handleClick);
      dialog.removeEventListener("cancel", handleCancel);
    };
  }, []);

  return (
    <>
      <style>{`
        dialog.unusual-move-modal::backdrop {
          background: rgba(0, 0, 0, 0.8);
        }
      `}</style>
      <dialog
        ref={dialogRef}
        className="unusual-move-modal"
        aria-labelledby="unusual-move-title"
        style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        background: "#1a1a2e",
        borderRadius: "12px",
        padding: "24px",
        maxWidth: "600px",
        width: "90%",
        border: "2px solid #e74c3c",
        boxShadow: "0 0 30px rgba(231, 76, 60, 0.3)",
        zIndex: 3000,
      }}
    >
      {unusualMove && (
        <>
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <AlertTriangle size={28} color="#e74c3c" />
              <h2 id="unusual-move-title" style={{ color: "#e74c3c", margin: 0, fontSize: "20px" }}>
                Unusual Move Detected
              </h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              style={{
                background: "transparent",
                border: "none",
                color: "#888",
                cursor: "pointer",
                padding: "4px",
              }}
            >
              <X size={24} />
            </button>
          </div>

          {/* Alert Message */}
          <div
            style={{
              background: "rgba(231, 76, 60, 0.1)",
              borderRadius: "8px",
              padding: "16px",
              marginBottom: "20px",
              border: "1px solid rgba(231, 76, 60, 0.3)",
            }}
          >
            <p style={{ color: "#f39c12", margin: 0, fontSize: "14px" }}>
              Simulation has been stopped due to an invalid edge transition.
              A vehicle attempted to move to a non-connected edge.
            </p>
          </div>

          {/* Vehicle Info */}
          <div
            style={{
              background: "#0d1117",
              borderRadius: "8px",
              padding: "16px",
              marginBottom: "16px",
              border: "1px solid #30363d",
            }}
          >
            <h3 style={{ color: "#58a6ff", margin: "0 0 12px 0", fontSize: "14px" }}>
              Vehicle Information
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "8px", fontSize: "13px" }}>
              <span style={{ color: "#888" }}>Vehicle Index:</span>
              <span style={{ color: "#fff", fontWeight: "bold" }}>{unusualMove.vehicleIndex}</span>
              <span style={{ color: "#888" }}>Fab ID:</span>
              <span style={{ color: "#fff" }}>{unusualMove.fabId}</span>
              <span style={{ color: "#888" }}>Position:</span>
              <span style={{ color: "#fff" }}>
                ({unusualMove.position.x.toFixed(2)}, {unusualMove.position.y.toFixed(2)})
              </span>
              <span style={{ color: "#888" }}>Timestamp:</span>
              <span style={{ color: "#fff" }}>{unusualMove.timestamp.toFixed(0)} ms</span>
            </div>
          </div>

          {/* Edge Transition Info */}
          <div
            style={{
              background: "#0d1117",
              borderRadius: "8px",
              padding: "16px",
              marginBottom: "20px",
              border: "1px solid #30363d",
            }}
          >
            <h3 style={{ color: "#e74c3c", margin: "0 0 12px 0", fontSize: "14px" }}>
              Invalid Edge Transition
            </h3>

            <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px" }}>
              {/* Previous Edge */}
              <div
                style={{
                  flex: 1,
                  background: "#1a2a35",
                  borderRadius: "8px",
                  padding: "12px",
                  border: "1px solid #3a5a6a",
                }}
              >
                <div style={{ color: "#888", fontSize: "11px", marginBottom: "4px" }}>Previous Edge</div>
                <div style={{ color: "#4ecdc4", fontSize: "14px", fontWeight: "bold" }}>
                  {unusualMove.prevEdge.name}
                </div>
                <div style={{ color: "#888", fontSize: "12px", marginTop: "8px" }}>
                  To Node: <span style={{ color: "#f39c12" }}>{unusualMove.prevEdge.toNode}</span>
                </div>
              </div>

              {/* Arrow */}
              <div style={{ color: "#e74c3c", fontSize: "24px" }}>→</div>

              {/* Next Edge */}
              <div
                style={{
                  flex: 1,
                  background: "#1a2a35",
                  borderRadius: "8px",
                  padding: "12px",
                  border: "1px solid #3a5a6a",
                }}
              >
                <div style={{ color: "#888", fontSize: "11px", marginBottom: "4px" }}>Next Edge</div>
                <div style={{ color: "#4ecdc4", fontSize: "14px", fontWeight: "bold" }}>
                  {unusualMove.nextEdge.name}
                </div>
                <div style={{ color: "#888", fontSize: "12px", marginTop: "8px" }}>
                  From Node: <span style={{ color: "#e74c3c" }}>{unusualMove.nextEdge.fromNode}</span>
                </div>
              </div>
            </div>

            {/* Error Explanation */}
            <div
              style={{
                background: "rgba(231, 76, 60, 0.1)",
                borderRadius: "6px",
                padding: "12px",
                border: "1px solid rgba(231, 76, 60, 0.2)",
              }}
            >
              <div style={{ color: "#e74c3c", fontSize: "12px" }}>
                <strong>Error:</strong> Previous edge's to_node (<span style={{ color: "#f39c12" }}>{unusualMove.prevEdge.toNode}</span>) does not match next edge's from_node (<span style={{ color: "#e74c3c" }}>{unusualMove.nextEdge.fromNode}</span>)
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
              paddingTop: "16px",
              borderTop: "1px solid #30363d",
            }}
          >
            <button
              type="button"
              onClick={handleClose}
              style={{
                padding: "10px 24px",
                background: "#e74c3c",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontSize: "14px",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </>
      )}
    </dialog>
    </>
  );
};

export default UnusualMoveModal;
