// components/react/menu/panels/TransportScheduleModal.tsx
// Bay-to-Bay 반송 스케줄 매트릭스 모달
// 셀 값 = 가중치(weight), 행 합계 대비 비율로 반송 확률 결정
import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { useStationStore } from "@/store/map/stationStore";

// ── Types ──────────────────────────────────────────────────────────
interface BayInfo {
  name: string;
  stationCount: number;
}

// ── Helpers ────────────────────────────────────────────────────────
/** station 목록에서 bay별 station 수를 집계 */
function buildBayList(stations: { bay_name: string }[]): BayInfo[] {
  const map = new Map<string, number>();
  for (const s of stations) {
    if (!s.bay_name) continue;
    map.set(s.bay_name, (map.get(s.bay_name) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([name, stationCount]) => ({ name, stationCount }));
}

/** bay 목록에서 초기 가중치 행렬 생성 (station 수를 그대로 가중치로) */
function buildDefaultMatrix(bays: BayInfo[]): number[][] {
  const n = bays.length;
  const m: number[][] = [];
  for (let from = 0; from < n; from++) {
    const row: number[] = [];
    for (let to = 0; to < n; to++) {
      row.push(bays[to].stationCount);
    }
    m.push(row);
  }
  return m;
}

// ── Color helpers ──────────────────────────────────────────────────
/** 비율(0~1)에 따른 배경색 */
function ratioToColor(pct: number, isDiag = false): string {
  if (pct <= 0) return "transparent";
  const alpha = 0.08 + Math.min(pct / 100, 1) * 0.5;
  return isDiag
    ? `rgba(255,165,0,${alpha.toFixed(2)})`
    : `rgba(78,205,196,${alpha.toFixed(2)})`;
}

// ── Component ──────────────────────────────────────────────────────
interface Props {
  onClose: () => void;
}

const TransportScheduleModal: React.FC<Props> = ({ onClose }) => {
  const stations = useStationStore((s) => s.stations);

  // Bay 목록
  const bays = useMemo(() => buildBayList(stations), [stations]);

  // 행렬 state: matrix[fromIdx][toIdx] = 가중치 (정수, 0 이상)
  const [matrix, setMatrix] = useState<number[][]>(() => buildDefaultMatrix(bays));

  // bays가 바뀌면 (맵 변경) matrix 재생성
  const prevBayKeyRef = useRef("");
  useEffect(() => {
    const key = bays.map((b) => `${b.name}:${b.stationCount}`).join(",");
    if (key !== prevBayKeyRef.current) {
      prevBayKeyRef.current = key;
      setMatrix(buildDefaultMatrix(bays));
      setEditingCell(null);
    }
  }, [bays]);

  // 행별 합계 & 비율 계산
  const rowSums = useMemo(
    () => matrix.map((row) => row.reduce((s, v) => s + v, 0)),
    [matrix]
  );
  const rowPcts = useMemo(
    () =>
      matrix.map((row, ri) => {
        const sum = rowSums[ri];
        return row.map((v) => (sum > 0 ? (v / sum) * 100 : 0));
      }),
    [matrix, rowSums]
  );

  // 편집 중인 셀
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  // 셀 클릭 → 편집 시작
  const handleCellClick = useCallback(
    (r: number, c: number) => {
      setEditingCell({ r, c });
      setEditValue(String(matrix[r][c]));
    },
    [matrix]
  );

  // 편집 확정
  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    const { r, c } = editingCell;
    const val = Math.max(0, parseInt(editValue, 10) || 0);
    setMatrix((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = val;
      return next;
    });
    setEditingCell(null);
  }, [editingCell, editValue]);

  // ESC로 모달 닫기
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingCell) {
          setEditingCell(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, editingCell]);

  const n = bays.length;

  // 빈 bay 처리
  if (n === 0) {
    return (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-panel-bg border border-panel-border rounded-xl p-8 shadow-2xl max-w-md">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">
              Transport Schedule
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X size={20} />
            </button>
          </div>
          <p className="text-gray-400 text-sm">
            Bay 데이터가 없습니다. 맵을 먼저 로드해 주세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-panel-bg border border-panel-border rounded-xl shadow-2xl flex flex-col"
        style={{
          maxWidth: "90vw",
          maxHeight: "85vh",
          minWidth: 600,
        }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-panel-border">
          <div>
            <h2 className="text-base font-semibold text-white">
              Transport Schedule Matrix
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Bay-to-Bay 반송 가중치 &middot; {n} bays &middot;{" "}
              {stations.length} stations
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── Matrix ── */}
        <div className="flex-1 overflow-auto relative">
          <table className="border-collapse text-[11px] font-mono m-4">
            <thead>
              <tr>
                {/* 좌상단 코너 */}
                <th className="sticky left-0 top-0 z-20 bg-panel-bg-solid px-2 py-1 text-gray-500 border border-panel-border min-w-[80px]">
                  From ＼ To
                </th>
                {bays.map((bay) => (
                  <th
                    key={bay.name}
                    className="sticky top-0 z-10 bg-panel-bg-solid px-1.5 py-1 text-center border border-panel-border whitespace-nowrap"
                  >
                    <div className="text-accent-cyan text-[10px]">
                      {bay.name}
                    </div>
                    <div className="text-gray-500 text-[9px]">
                      ({bay.stationCount})
                    </div>
                  </th>
                ))}
                {/* Row sum header */}
                <th className="sticky top-0 right-0 z-20 bg-panel-bg-solid px-2 py-1 text-center border border-panel-border text-gray-400 min-w-[48px]">
                  Sum
                </th>
              </tr>
            </thead>
            <tbody>
              {bays.map((fromBay, ri) => (
                <tr key={fromBay.name}>
                  {/* Row header */}
                  <td className="sticky left-0 z-10 bg-panel-bg-solid px-2 py-1 border border-panel-border whitespace-nowrap">
                    <span className="text-accent-orange text-[10px]">
                      {fromBay.name}
                    </span>
                    <span className="text-gray-500 text-[9px] ml-1">
                      ({fromBay.stationCount})
                    </span>
                  </td>

                  {/* Data cells */}
                  {bays.map((_toBay, ci) => {
                    const isDiag = ri === ci;
                    const weight = matrix[ri][ci];
                    const pct = rowPcts[ri][ci];
                    const isEditing =
                      editingCell?.r === ri && editingCell?.c === ci;

                    return (
                      <td
                        key={ci}
                        className="border border-panel-border text-center px-1 py-0.5 min-w-[52px] cursor-pointer hover:bg-white/5"
                        style={{
                          backgroundColor: ratioToColor(pct, isDiag),
                        }}
                        onClick={() => handleCellClick(ri, ci)}
                      >
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            type="number"
                            min={0}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit();
                              if (e.key === "Escape") setEditingCell(null);
                            }}
                            className="w-12 bg-transparent text-center text-white outline-none border-b border-accent-cyan"
                          />
                        ) : (
                          <div className="leading-tight">
                            <div
                              className={
                                weight > 0
                                  ? isDiag
                                    ? "text-accent-orange"
                                    : "text-white"
                                  : "text-gray-600"
                              }
                            >
                              {weight}
                            </div>
                            {weight > 0 && (
                              <div className="text-[8px] text-gray-500">
                                {pct.toFixed(1)}%
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}

                  {/* Row sum */}
                  <td className="sticky right-0 z-10 bg-panel-bg-solid border border-panel-border text-center px-2 py-0.5 font-bold text-gray-300 min-w-[48px]">
                    {rowSums[ri]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-panel-border">
          <p className="text-[10px] text-gray-500">
            셀 값 = 가중치 &middot; 실제 반송 비율은 행 합계 대비 자동 계산
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setMatrix(buildDefaultMatrix(bays));
                setEditingCell(null);
              }}
              className="px-4 py-1.5 rounded text-xs font-bold bg-gray-600 text-gray-300 hover:bg-gray-500 transition-colors"
            >
              Reset
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded text-xs font-bold bg-gray-600 text-gray-300 hover:bg-gray-500 transition-colors"
            >
              Close
            </button>
            <button className="px-4 py-1.5 rounded text-xs font-bold bg-accent-cyan text-white hover:bg-accent-cyan/80 transition-colors">
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransportScheduleModal;
