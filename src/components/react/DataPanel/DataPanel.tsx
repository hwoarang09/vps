// src/components/react/DataPanel/DataPanel.tsx
// DataPanel 서브메뉴별 컨텐츠

import React, { useState, useCallback } from "react";
import { useMenuStore } from "@/store/ui/menuStore";
import { useNodeStore } from "@/store/map/nodeStore";
import { useEdgeStore } from "@/store/map/edgeStore";
import {
  panelTitleVariants,
  panelCardVariants,
  panelTextVariants,
  panelInputVariants,
  panelButtonVariants,
  panelLabelVariants,
} from "../menu/shared/panelStyles";

const DB_URL = "http://localhost:8100";

// ============================================================================
// Shared: Session Selector + Search Input
// ============================================================================

function useDbQuery<T>(buildUrl: (params: Record<string, string>) => string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(async (params: Record<string, string>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(params));
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message ?? "fetch failed");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  return { data, loading, error, query };
}

const StatusBadge: React.FC<{ loading: boolean; error: string | null; count: number }> = ({ loading, error, count }) => {
  if (loading) return <span className="text-xs text-yellow-400 animate-pulse">loading...</span>;
  if (error) return <span className="text-xs text-red-400">err: {error}</span>;
  if (count > 0) return <span className="text-xs text-green-400">{count} rows</span>;
  return null;
};

// ============================================================================
// Topology Panel
// ============================================================================

const TopologyPanel: React.FC = () => {
  const { nodes } = useNodeStore();
  const { edges } = useEdgeStore();

  const mergeNodes = nodes.filter((n: any) => n.isMerge);
  const divergeNodes = nodes.filter((n: any) => n.isDiverge);

  return (
    <div className="space-y-3">
      <h3 className={panelTitleVariants({ size: "lg", color: "cyan" })}>Topology</h3>
      <div className="grid grid-cols-2 gap-2">
        <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
          <div className={panelTextVariants({ variant: "muted", size: "sm" })}>Nodes</div>
          <div className="text-2xl font-bold text-white font-mono">{nodes.length}</div>
        </div>
        <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
          <div className={panelTextVariants({ variant: "muted", size: "sm" })}>Edges</div>
          <div className="text-2xl font-bold text-white font-mono">{edges.length}</div>
        </div>
        <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
          <div className={panelTextVariants({ variant: "muted", size: "sm" })}>Merge</div>
          <div className="text-2xl font-bold text-red-400 font-mono">{mergeNodes.length}</div>
        </div>
        <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
          <div className={panelTextVariants({ variant: "muted", size: "sm" })}>Diverge</div>
          <div className="text-2xl font-bold text-yellow-400 font-mono">{divergeNodes.length}</div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Vehicle History Panel (운행이력)
// ============================================================================

const VehicleHistoryPanel: React.FC = () => {
  const [sessionId, setSessionId] = useState("");
  const [vehId, setVehId] = useState("");

  const snapshots = useDbQuery<any>(
    useCallback((p: Record<string, string>) =>
      `${DB_URL}/api/vehicle/${p.vehId}/snapshots?session_id=${p.sessionId}&limit=500`, [])
  );
  const edgeHistory = useDbQuery<any>(
    useCallback((p: Record<string, string>) =>
      `${DB_URL}/api/vehicle/${p.vehId}/edges?session_id=${p.sessionId}&limit=500`, [])
  );

  const handleSearch = () => {
    if (!sessionId || !vehId) return;
    const params = { sessionId, vehId };
    snapshots.query(params);
    edgeHistory.query(params);
  };

  return (
    <div className="space-y-3">
      <h3 className={panelTitleVariants({ size: "lg", color: "cyan" })}>운행이력</h3>

      {/* Search */}
      <div className="space-y-2">
        <div>
          <label className={panelLabelVariants({})}>Session ID</label>
          <input className={panelInputVariants({})} placeholder="sim_fab_0_..." value={sessionId} onChange={e => setSessionId(e.target.value)} />
        </div>
        <div>
          <label className={panelLabelVariants({})}>Vehicle ID</label>
          <input className={panelInputVariants({})} type="number" placeholder="0" value={vehId} onChange={e => setVehId(e.target.value)} />
        </div>
        <button className={panelButtonVariants({ variant: "primary" })} onClick={handleSearch}>조회</button>
      </div>

      {/* Snapshots */}
      <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
        <div className="flex justify-between items-center mb-1">
          <span className={panelTextVariants({ variant: "muted", size: "sm" })}>위치/속도 이력</span>
          <StatusBadge loading={snapshots.loading} error={snapshots.error} count={snapshots.data.length} />
        </div>
        {snapshots.data.length > 0 && (
          <div className="max-h-48 overflow-auto text-[10px] font-mono">
            <table className="w-full">
              <thead><tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left px-1">ts</th><th className="text-right px-1">speed</th><th className="text-right px-1">edge</th><th className="text-right px-1">x</th><th className="text-right px-1">y</th>
              </tr></thead>
              <tbody>
                {snapshots.data.map((r: any, i: number) => (
                  <tr key={i} className={`${r.speed === 0 ? "text-red-400" : "text-gray-300"} border-b border-gray-800`}>
                    <td className="px-1">{r.ts}</td>
                    <td className="text-right px-1">{r.speed?.toFixed(2)}</td>
                    <td className="text-right px-1">{r.edge_idx}</td>
                    <td className="text-right px-1">{r.x?.toFixed(1)}</td>
                    <td className="text-right px-1">{r.y?.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edge History */}
      <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
        <div className="flex justify-between items-center mb-1">
          <span className={panelTextVariants({ variant: "muted", size: "sm" })}>Edge 통과 이력</span>
          <StatusBadge loading={edgeHistory.loading} error={edgeHistory.error} count={edgeHistory.data.length} />
        </div>
        {edgeHistory.data.length > 0 && (
          <div className="max-h-48 overflow-auto text-[10px] font-mono">
            <table className="w-full">
              <thead><tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left px-1">ts</th><th className="text-right px-1">edge</th><th className="text-right px-1">dur(ms)</th><th className="text-right px-1">len</th>
              </tr></thead>
              <tbody>
                {edgeHistory.data.map((r: any, i: number) => (
                  <tr key={i} className="text-gray-300 border-b border-gray-800">
                    <td className="px-1">{r.ts}</td>
                    <td className="text-right px-1">{r.edge_id}</td>
                    <td className="text-right px-1">{r.exit_ts - r.enter_ts}</td>
                    <td className="text-right px-1">{r.edge_len?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Transfer History Panel (반송이력)
// ============================================================================

const TransferHistoryPanel: React.FC = () => {
  const [sessionId, setSessionId] = useState("");
  const [vehId, setVehId] = useState("");

  const edges = useDbQuery<any>(
    useCallback((p: Record<string, string>) =>
      `${DB_URL}/api/vehicle/${p.vehId}/edges?session_id=${p.sessionId}&limit=1000`, [])
  );

  const handleSearch = () => {
    if (!sessionId || !vehId) return;
    edges.query({ sessionId, vehId });
  };

  return (
    <div className="space-y-3">
      <h3 className={panelTitleVariants({ size: "lg", color: "orange" })}>반송이력</h3>

      <div className="space-y-2">
        <div>
          <label className={panelLabelVariants({})}>Session ID</label>
          <input className={panelInputVariants({})} placeholder="sim_fab_0_..." value={sessionId} onChange={e => setSessionId(e.target.value)} />
        </div>
        <div>
          <label className={panelLabelVariants({})}>Vehicle ID</label>
          <input className={panelInputVariants({})} type="number" placeholder="0" value={vehId} onChange={e => setVehId(e.target.value)} />
        </div>
        <button className={panelButtonVariants({ variant: "primary" })} onClick={handleSearch}>조회</button>
      </div>

      <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
        <div className="flex justify-between items-center mb-1">
          <span className={panelTextVariants({ variant: "muted", size: "sm" })}>Edge Transit 이력</span>
          <StatusBadge loading={edges.loading} error={edges.error} count={edges.data.length} />
        </div>
        {edges.data.length > 0 && (
          <div className="max-h-64 overflow-auto text-[10px] font-mono">
            <table className="w-full">
              <thead><tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left px-1">ts</th><th className="text-right px-1">edge</th><th className="text-right px-1">enter</th><th className="text-right px-1">exit</th><th className="text-right px-1">dur</th><th className="text-right px-1">len</th>
              </tr></thead>
              <tbody>
                {edges.data.map((r: any, i: number) => {
                  const dur = r.exit_ts - r.enter_ts;
                  return (
                    <tr key={i} className={`${dur > 5000 ? "text-yellow-400" : "text-gray-300"} border-b border-gray-800`}>
                      <td className="px-1">{r.ts}</td>
                      <td className="text-right px-1">{r.edge_id}</td>
                      <td className="text-right px-1">{r.enter_ts}</td>
                      <td className="text-right px-1">{r.exit_ts}</td>
                      <td className="text-right px-1">{dur}</td>
                      <td className="text-right px-1">{r.edge_len?.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Lock History Panel (Lock이력)
// ============================================================================

const LOCK_EVENT_NAMES: Record<number, string> = { 0: "REQ", 1: "GRANT", 2: "REL", 3: "WAIT" };

const LockHistoryPanel: React.FC = () => {
  const [sessionId, setSessionId] = useState("");
  const [searchType, setSearchType] = useState<"node" | "vehicle">("node");
  const [searchId, setSearchId] = useState("");

  const lockEvents = useDbQuery<any>(
    useCallback((p: Record<string, string>) => {
      if (p.type === "node") return `${DB_URL}/api/lock/by-node/${p.id}?session_id=${p.sessionId}&limit=1000`;
      return `${DB_URL}/api/lock/by-vehicle/${p.id}?session_id=${p.sessionId}&limit=1000`;
    }, [])
  );
  const topWait = useDbQuery<any>(
    useCallback((p: Record<string, string>) =>
      `${DB_URL}/api/lock/top-wait?session_id=${p.sessionId}`, [])
  );

  const handleSearch = () => {
    if (!sessionId || !searchId) return;
    lockEvents.query({ sessionId, type: searchType, id: searchId });
    topWait.query({ sessionId });
  };

  return (
    <div className="space-y-3">
      <h3 className={panelTitleVariants({ size: "lg", color: "purple" })}>Lock이력</h3>

      <div className="space-y-2">
        <div>
          <label className={panelLabelVariants({})}>Session ID</label>
          <input className={panelInputVariants({})} placeholder="sim_fab_0_..." value={sessionId} onChange={e => setSessionId(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button
            className={panelButtonVariants({ variant: searchType === "node" ? "primary" : "ghost" })}
            onClick={() => setSearchType("node")}
          >Node</button>
          <button
            className={panelButtonVariants({ variant: searchType === "vehicle" ? "primary" : "ghost" })}
            onClick={() => setSearchType("vehicle")}
          >Vehicle</button>
        </div>
        <div>
          <label className={panelLabelVariants({})}>{searchType === "node" ? "Node Index" : "Vehicle ID"}</label>
          <input className={panelInputVariants({})} type="number" placeholder="0" value={searchId} onChange={e => setSearchId(e.target.value)} />
        </div>
        <button className={panelButtonVariants({ variant: "primary" })} onClick={handleSearch}>조회</button>
      </div>

      {/* Top Wait Nodes */}
      {topWait.data.length > 0 && (
        <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
          <div className="flex justify-between items-center mb-1">
            <span className={panelTextVariants({ variant: "muted", size: "sm" })}>Top Wait Nodes</span>
            <StatusBadge loading={topWait.loading} error={topWait.error} count={topWait.data.length} />
          </div>
          <div className="max-h-32 overflow-auto text-[10px] font-mono">
            <table className="w-full">
              <thead><tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left px-1">node</th><th className="text-right px-1">cnt</th><th className="text-right px-1">avg(ms)</th><th className="text-right px-1">max(ms)</th>
              </tr></thead>
              <tbody>
                {topWait.data.map((r: any, i: number) => (
                  <tr key={i} className="text-gray-300 border-b border-gray-800">
                    <td className="px-1">{r.node_idx}</td>
                    <td className="text-right px-1">{r.cnt}</td>
                    <td className="text-right px-1">{r.avg_wait_ms?.toFixed(0)}</td>
                    <td className="text-right px-1">{r.max_wait_ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Lock Events */}
      <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
        <div className="flex justify-between items-center mb-1">
          <span className={panelTextVariants({ variant: "muted", size: "sm" })}>Lock Events</span>
          <StatusBadge loading={lockEvents.loading} error={lockEvents.error} count={lockEvents.data.length} />
        </div>
        {lockEvents.data.length > 0 && (
          <div className="max-h-48 overflow-auto text-[10px] font-mono">
            <table className="w-full">
              <thead><tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left px-1">ts</th>
                <th className="text-right px-1">{searchType === "node" ? "veh" : "node"}</th>
                <th className="text-center px-1">type</th>
                <th className="text-right px-1">wait(ms)</th>
              </tr></thead>
              <tbody>
                {lockEvents.data.map((r: any, i: number) => (
                  <tr key={i} className={`${r.event_type === 3 ? "text-red-400" : "text-gray-300"} border-b border-gray-800`}>
                    <td className="px-1">{r.ts}</td>
                    <td className="text-right px-1">{searchType === "node" ? r.veh_id : r.node_idx}</td>
                    <td className="text-center px-1">{LOCK_EVENT_NAMES[r.event_type] ?? r.event_type}</td>
                    <td className="text-right px-1">{r.wait_ms > 0 ? r.wait_ms : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Router
// ============================================================================

const PANEL_MAP: Record<string, React.FC> = {
  "data-topology": TopologyPanel,
  "data-vehicle-history": VehicleHistoryPanel,
  "data-transfer-history": TransferHistoryPanel,
  "data-lock-history": LockHistoryPanel,
};

const DataPanel: React.FC = () => {
  const activeSubMenu = useMenuStore((s) => s.activeSubMenu);
  const Panel = activeSubMenu ? PANEL_MAP[activeSubMenu] : null;
  if (!Panel) return null;
  return <Panel />;
};

export default DataPanel;
