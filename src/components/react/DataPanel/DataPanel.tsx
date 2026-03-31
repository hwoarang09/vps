// src/components/react/DataPanel/DataPanel.tsx
// DB History 대형 모달 — 탭으로 운행이력/반송이력/Lock이력 전환

import React, { useState, useCallback, useEffect, useRef } from "react";
import { X, ChevronDown } from "lucide-react";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { LOG_DB_URL } from "@/config/logConfig";

// ============================================================================
// Shared
// ============================================================================

function useSessionId() {
  const currentSessionId = useShmSimulatorStore((s) => s.currentSessionId);
  const [sessionId, setSessionId] = useState(currentSessionId ?? "");
  useEffect(() => {
    if (currentSessionId && !sessionId) setSessionId(currentSessionId);
  }, [currentSessionId, sessionId]);
  return [sessionId, setSessionId] as const;
}

interface SessionInfo { session_id: string; started_at: string; mode: string; vehicle_count: number | null; }

const SessionSelector: React.FC<{ value: string; onChange: (v: string) => void; dbUrl: string }> = ({ value, onChange, dbUrl }) => {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  useEffect(() => {
    fetch(`${dbUrl}/api/sessions`).then(r => r.json()).then(setSessions).catch(() => setSessions([]));
  }, [dbUrl]);

  return sessions.length > 0 ? (
    <select className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">-- select session --</option>
      {sessions.map(s => (
        <option key={s.session_id} value={s.session_id}>
          {s.session_id} ({s.mode}, {s.vehicle_count ?? "?"}veh)
        </option>
      ))}
    </select>
  ) : (
    <input className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white w-48" placeholder="DB 미연결" value={value} onChange={e => onChange(e.target.value)} />
  );
};

// ============================================================================
// Vehicle Selector (dropdown + input 겸용)
// ============================================================================

const VehicleSelector: React.FC<{
  value: string;
  onChange: (v: string) => void;
  sessionId: string;
  dbUrl: string;
  placeholder?: string;
  onEnter?: () => void;
}> = ({ value, onChange, sessionId, dbUrl, placeholder = "Vehicle ID", onEnter }) => {
  const [vehicleIds, setVehicleIds] = useState<number[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId || !dbUrl) { setVehicleIds([]); return; }
    fetch(`${dbUrl}/api/vehicles?session_id=${sessionId}`)
      .then(r => r.json())
      .then((data: { veh_id: number }[]) => setVehicleIds(data.map(d => d.veh_id)))
      .catch(() => setVehicleIds([]));
  }, [sessionId, dbUrl]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = vehicleIds.filter(id => filter === "" || String(id).includes(filter));

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex">
        <input
          className="bg-gray-800 border border-gray-600 rounded-l px-2 py-1 text-xs text-white w-20"
          type="text"
          inputMode="numeric"
          placeholder={placeholder}
          value={value}
          onChange={e => { onChange(e.target.value); setFilter(e.target.value); }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={e => { if (e.key === "Enter") { setIsOpen(false); onEnter?.(); } }}
        />
        <button
          className="bg-gray-700 border border-l-0 border-gray-600 rounded-r px-1 text-gray-400 hover:text-white"
          onClick={() => setIsOpen(!isOpen)}
          type="button"
        >
          <ChevronDown size={12} className={isOpen ? "rotate-180" : ""} />
        </button>
      </div>
      {isOpen && vehicleIds.length > 0 && (
        <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-xl z-50 max-h-48 w-24 overflow-auto">
          {filtered.length === 0 ? (
            <div className="px-2 py-1 text-xs text-gray-500">no match</div>
          ) : (
            filtered.slice(0, 100).map(id => (
              <button
                key={id}
                className={`w-full text-left px-2 py-1 text-xs hover:bg-gray-700 ${
                  String(id) === value ? "text-blue-400 bg-gray-700" : "text-gray-300"
                }`}
                onClick={() => { onChange(String(id)); setFilter(""); setIsOpen(false); }}
              >
                {id}
              </button>
            ))
          )}
          {filtered.length > 100 && (
            <div className="px-2 py-1 text-xs text-gray-500">+{filtered.length - 100} more...</div>
          )}
        </div>
      )}
    </div>
  );
};

function useDbQuery<T>(buildUrl: (params: Record<string, string>) => string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useCallback(async (params: Record<string, string>) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(buildUrl(params));
      if (!res.ok) throw new Error(`${res.status}`);
      setData(await res.json());
    } catch (e: any) { setError(e.message); setData([]); }
    finally { setLoading(false); }
  }, [buildUrl]);
  return { data, loading, error, query };
}

/** ts(ms) → mm:ss 포맷 */
const fmtTs = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const Badge: React.FC<{ loading: boolean; error: string | null; count: number }> = ({ loading, error, count }) => {
  if (loading) return <span className="text-yellow-400 animate-pulse">loading...</span>;
  if (error) return <span className="text-red-400">err: {error}</span>;
  if (count > 0) return <span className="text-green-400">{count} rows</span>;
  return <span className="text-gray-600">no data</span>;
};

const TH: React.FC<{ children: React.ReactNode; align?: string }> = ({ children, align = "left" }) => (
  <th className={`sticky top-0 bg-gray-800 px-2 py-1.5 text-${align} text-gray-400 font-medium border-b border-gray-700`}>{children}</th>
);
const TD: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <td className={`px-2 py-1 border-b border-gray-800/50 ${className}`}>{children}</td>
);

// ============================================================================
// Vehicle Tab
// ============================================================================

const VehicleTab: React.FC<{ sessionId: string; dbUrl: string }> = ({ sessionId, dbUrl }) => {
  const [vehId, setVehId] = useState("");
  const snapshots = useDbQuery<any>(useCallback((p: Record<string, string>) =>
    `${p.dbUrl}/api/vehicle/${p.vehId}/snapshots?session_id=${p.sessionId}&limit=2000`, []));
  const edges = useDbQuery<any>(useCallback((p: Record<string, string>) =>
    `${p.dbUrl}/api/vehicle/${p.vehId}/edges?session_id=${p.sessionId}&limit=2000`, []));

  const search = () => { if (!sessionId || !vehId) return; const p = { sessionId, vehId, dbUrl }; snapshots.query(p); edges.query(p); };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-3">
        <VehicleSelector value={vehId} onChange={setVehId} sessionId={sessionId} dbUrl={dbUrl} onEnter={search} />
        <button className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1 rounded" onClick={search}>조회</button>
      </div>
      <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
        <div className="flex flex-col min-h-0">
          <div className="flex justify-between items-center mb-1 text-xs">
            <span className="text-gray-400 font-medium">위치/속도 이력</span>
            <Badge loading={snapshots.loading} error={snapshots.error} count={snapshots.data.length} />
          </div>
          <div className="flex-1 overflow-auto rounded border border-gray-700">
            <table className="w-full text-[11px] font-mono">
              <thead><tr><TH>ts</TH><TH align="right">speed</TH><TH align="right">edge</TH><TH align="right">x</TH><TH align="right">y</TH><TH align="right">status</TH></tr></thead>
              <tbody>
                {snapshots.data.map((r: any, i: number) => (
                  <tr key={i} className={r.speed === 0 ? "text-red-400" : "text-gray-300"}>
                    <TD>{fmtTs(r.ts)}</TD><TD className="text-right">{r.speed?.toFixed(2)}</TD><TD className="text-right">{r.edge_idx}</TD>
                    <TD className="text-right">{r.x?.toFixed(1)}</TD><TD className="text-right">{r.y?.toFixed(1)}</TD><TD className="text-right">{r.status}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex flex-col min-h-0">
          <div className="flex justify-between items-center mb-1 text-xs">
            <span className="text-gray-400 font-medium">Edge 통과 이력</span>
            <Badge loading={edges.loading} error={edges.error} count={edges.data.length} />
          </div>
          <div className="flex-1 overflow-auto rounded border border-gray-700">
            <table className="w-full text-[11px] font-mono">
              <thead><tr><TH>ts</TH><TH align="right">edge</TH><TH align="right">dur(ms)</TH><TH align="right">len</TH></tr></thead>
              <tbody>
                {edges.data.map((r: any, i: number) => (
                  <tr key={i} className="text-gray-300">
                    <TD>{fmtTs(r.ts)}</TD><TD className="text-right">{r.edge_id}</TD><TD className="text-right">{r.exit_ts - r.enter_ts}</TD><TD className="text-right">{r.edge_len?.toFixed(2)}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Transfer Tab
// ============================================================================

const TransferTab: React.FC<{ sessionId: string; dbUrl: string }> = ({ sessionId, dbUrl }) => {
  const [vehId, setVehId] = useState("");
  const edges = useDbQuery<any>(useCallback((p: Record<string, string>) =>
    `${p.dbUrl}/api/vehicle/${p.vehId}/edges?session_id=${p.sessionId}&limit=5000`, []));

  const search = () => { if (!sessionId || !vehId) return; edges.query({ sessionId, vehId, dbUrl }); };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-3">
        <VehicleSelector value={vehId} onChange={setVehId} sessionId={sessionId} dbUrl={dbUrl} onEnter={search} />
        <button className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1 rounded" onClick={search}>조회</button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex justify-between items-center mb-1 text-xs">
          <span className="text-gray-400 font-medium">Edge Transit 이력</span>
          <Badge loading={edges.loading} error={edges.error} count={edges.data.length} />
        </div>
        <div className="flex-1 overflow-auto rounded border border-gray-700">
          <table className="w-full text-[11px] font-mono">
            <thead><tr><TH>ts</TH><TH align="right">edge</TH><TH align="right">enter</TH><TH align="right">exit</TH><TH align="right">dur(ms)</TH><TH align="right">len</TH></tr></thead>
            <tbody>
              {edges.data.map((r: any, i: number) => {
                const dur = r.exit_ts - r.enter_ts;
                return (
                  <tr key={i} className={dur > 5000 ? "text-yellow-400" : "text-gray-300"}>
                    <TD>{fmtTs(r.ts)}</TD><TD className="text-right">{r.edge_id}</TD><TD className="text-right">{fmtTs(r.enter_ts)}</TD>
                    <TD className="text-right">{fmtTs(r.exit_ts)}</TD><TD className="text-right">{dur}</TD><TD className="text-right">{r.edge_len?.toFixed(2)}</TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Lock Tab
// ============================================================================

const LOCK_NAMES: Record<number, string> = { 0: "REQ", 1: "GRANT", 2: "REL", 3: "WAIT" };

const LockTab: React.FC<{ sessionId: string; dbUrl: string }> = ({ sessionId, dbUrl }) => {
  const [mode, setMode] = useState<"node" | "vehicle">("node");
  const [searchId, setSearchId] = useState("");
  const events = useDbQuery<any>(useCallback((p: Record<string, string>) =>
    p.mode === "node"
      ? `${p.dbUrl}/api/lock/by-node/${p.id}?session_id=${p.sessionId}&limit=2000`
      : `${p.dbUrl}/api/lock/by-vehicle/${p.id}?session_id=${p.sessionId}&limit=2000`, []));
  const topWait = useDbQuery<any>(useCallback((p: Record<string, string>) =>
    `${p.dbUrl}/api/lock/top-wait?session_id=${p.sessionId}`, []));

  const search = () => {
    if (!sessionId || !searchId) return;
    events.query({ sessionId, mode, id: searchId, dbUrl });
    topWait.query({ sessionId, dbUrl });
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-3">
        <div className="flex rounded overflow-hidden border border-gray-600">
          <button className={`px-2 py-1 text-xs ${mode === "node" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`} onClick={() => setMode("node")}>Node</button>
          <button className={`px-2 py-1 text-xs ${mode === "vehicle" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`} onClick={() => setMode("vehicle")}>Vehicle</button>
        </div>
        {mode === "vehicle" ? (
          <VehicleSelector value={searchId} onChange={setSearchId} sessionId={sessionId} dbUrl={dbUrl} placeholder="Vehicle ID" onEnter={search} />
        ) : (
          <input className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white w-24" type="number" placeholder="Node Idx" value={searchId} onChange={e => setSearchId(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} />
        )}
        <button className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1 rounded" onClick={search}>조회</button>
      </div>
      <div className="flex flex-col gap-4 flex-1 min-h-0">
        <div className="flex flex-col min-h-0">
          <div className="flex justify-between items-center mb-1 text-xs">
            <span className="text-gray-400 font-medium">Top Wait Nodes</span>
            <Badge loading={topWait.loading} error={topWait.error} count={topWait.data.length} />
          </div>
          <div className="flex-1 overflow-auto rounded border border-gray-700">
            <table className="w-full text-[11px] font-mono">
              <thead><tr><TH>node</TH><TH align="right">cnt</TH><TH align="right">avg(ms)</TH><TH align="right">max</TH></tr></thead>
              <tbody>
                {topWait.data.map((r: any, i: number) => (
                  <tr key={i} className="text-gray-300">
                    <TD>{r.node_idx}</TD><TD className="text-right">{r.cnt}</TD><TD className="text-right">{r.avg_wait_ms?.toFixed(0)}</TD><TD className="text-right">{r.max_wait_ms}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex flex-col min-h-0">
          <div className="flex justify-between items-center mb-1 text-xs">
            <span className="text-gray-400 font-medium">Lock Events</span>
            <Badge loading={events.loading} error={events.error} count={events.data.length} />
          </div>
          <div className="flex-1 overflow-auto rounded border border-gray-700">
            <table className="w-full text-[11px] font-mono">
              <thead><tr><TH>ts</TH><TH align="right">{mode === "node" ? "veh" : "node"}</TH><TH align="center">type</TH><TH align="right">wait(ms)</TH></tr></thead>
              <tbody>
                {events.data.map((r: any, i: number) => (
                  <tr key={i} className={r.event_type === 3 ? "text-red-400" : "text-gray-300"}>
                    <TD>{fmtTs(r.ts)}</TD><TD className="text-right">{mode === "node" ? r.veh_id : r.node_idx}</TD>
                    <TD className="text-center">{LOCK_NAMES[r.event_type] ?? r.event_type}</TD><TD className="text-right">{r.wait_ms > 0 ? r.wait_ms : "-"}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Main Modal
// ============================================================================

type TabKey = "vehicle" | "transfer" | "lock";

const TABS: { key: TabKey; label: string }[] = [
  { key: "vehicle", label: "운행이력" },
  { key: "transfer", label: "반송이력" },
  { key: "lock", label: "Lock이력" },
];

const DataPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [tab, setTab] = useState<TabKey>("vehicle");
  const [sessionId, setSessionId] = useSessionId();
  const [dbUrl] = useState(LOG_DB_URL);

  // ESC 키로만 닫힘
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed top-0 left-0 bottom-0 z-[60] flex flex-col bg-gray-900/95 border-r border-gray-700 shadow-2xl backdrop-blur-sm"
      style={{ width: "750px" }}
    >
      {/* header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-800/80">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-white whitespace-nowrap">DB History</h2>
          <SessionSelector value={sessionId} onChange={setSessionId} dbUrl={dbUrl} />
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors" title="ESC"><X size={16} /></button>
      </div>
      {/* tabs */}
      <div className="flex border-b border-gray-700 bg-gray-800/40 px-4">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >{t.label}</button>
        ))}
      </div>
      {/* content */}
      <div className="flex-1 p-3 min-h-0 overflow-hidden">
        {tab === "vehicle" && <VehicleTab sessionId={sessionId} dbUrl={dbUrl} />}
        {tab === "transfer" && <TransferTab sessionId={sessionId} dbUrl={dbUrl} />}
        {tab === "lock" && <LockTab sessionId={sessionId} dbUrl={dbUrl} />}
      </div>
    </div>
  );
};

export default DataPanel;
