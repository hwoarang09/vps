import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, Navigation, ChevronDown } from "lucide-react";
import { useNodeStore } from "@/store/map/nodeStore";
import { useEdgeStore } from "@/store/map/edgeStore";
import { useNodeControlStore } from "@/store/ui/nodeControlStore";
import { useCameraStore } from "@/store/ui/cameraStore";
import { useFabStore } from "@/store/map/fabStore";
import {
  panelSelectVariants,
  panelCardVariants,
  panelButtonVariants,
  panelLabelVariants,
} from "../shared/panelStyles";
import { twMerge } from "tailwind-merge";

const NodeControlPanel: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [foundNodeName, setFoundNodeName] = useState<string | null>(null);
  const [selectedFabIndex, setSelectedFabIndex] = useState<number>(0);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const nodes = useNodeStore((state) => state.nodes);
  const getNodeByName = useNodeStore((state) => state.getNodeByName);
  const edges = useEdgeStore((state) => state.edges);
  const selectedNodeName = useNodeControlStore((state) => state.selectedNodeName);
  const selectNode = useNodeControlStore((state) => state.selectNode);
  const setCameraView = useCameraStore((state) => state.setCameraView);

  const fabs = useFabStore((state) => state.fabs);
  const isMultiFab = useFabStore((state) => state.isMultiFab);

  const navigateToNode = (nodeName: string) => {
    const node = getNodeByName(nodeName);
    if (!node) return;

    let fabOffsetX = 0;
    let fabOffsetY = 0;
    if (isMultiFab() && fabs.length > selectedFabIndex) {
      const fab0 = fabs.find(f => f.fabIndex === 0);
      const selectedFab = fabs[selectedFabIndex];
      if (fab0 && selectedFab) {
        fabOffsetX = selectedFab.centerX - fab0.centerX;
        fabOffsetY = selectedFab.centerY - fab0.centerY;
      }
    }

    const cx = node.editor_x + fabOffsetX;
    const cy = node.editor_y + fabOffsetY;
    const cz = 0;

    const cameraHeight = 12;
    const cameraOffset = 6;
    const cameraPosition: [number, number, number] = [
      cx - cameraOffset,
      cy - cameraOffset,
      cameraHeight
    ];
    const cameraTarget: [number, number, number] = [cx, cy, cz];

    setCameraView(cameraPosition, cameraTarget);
  };

  // TMP_ 노드 제외, 그룹별 정렬 (BAY/prefix)
  const groupedNodes = useMemo(() => {
    const groups: Record<string, { name: string }[]> = {};

    for (const n of nodes) {
      if (n.node_name.startsWith("TMP_")) continue;
      let groupKey = "Other";

      const prefixMatch = n.node_name.match(/^([A-Z]+)\d/i);
      if (prefixMatch) {
        groupKey = prefixMatch[1].toUpperCase();
      } else if (n.node_name.length >= 2) {
        groupKey = n.node_name.substring(0, 2).toUpperCase();
      }

      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push({ name: n.node_name });
    }

    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([key, items]) => ({
        key,
        items: items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      }));
  }, [nodes]);

  useEffect(() => {
    if (selectedNodeName !== null) {
      setFoundNodeName(selectedNodeName);
      setSearchTerm("");
      navigateToNode(selectedNodeName);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeName]);

  // 입력 기준 dropdown 필터
  const filteredGroups = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return groupedNodes;
    return groupedNodes
      .map((g) => ({
        key: g.key,
        items: g.items.filter((it) => it.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.items.length > 0);
  }, [groupedNodes, searchTerm]);

  const handleNodeSelect = (nodeName: string) => {
    setFoundNodeName(nodeName);
    setSearchTerm("");
    setIsDropdownOpen(false);
    inputRef.current?.blur();
    selectNode(nodeName, selectedFabIndex);
    navigateToNode(nodeName);
  };

  const handleEnter = () => {
    if (!searchTerm.trim()) return;
    const q = searchTerm.trim();

    // 정확 일치 우선
    const exact = getNodeByName(q);
    if (exact) {
      handleNodeSelect(exact.node_name);
      return;
    }

    // 부분 일치
    const lower = q.toLowerCase();
    const partial = nodes.find(
      (n) => !n.node_name.startsWith("TMP_") && n.node_name.toLowerCase().includes(lower)
    );
    if (partial) {
      handleNodeSelect(partial.node_name);
    }
  };

  const foundNode = foundNodeName ? getNodeByName(foundNodeName) : null;

  // 노드의 in/out edge 정보
  const { incomingEdges, outgoingEdges } = useMemo(() => {
    if (!foundNodeName) return { incomingEdges: [], outgoingEdges: [] };
    const incoming: { name: string; index: number; from: string }[] = [];
    const outgoing: { name: string; index: number; to: string }[] = [];
    edges.forEach((e, i) => {
      if (e.to_node === foundNodeName) {
        incoming.push({ name: e.edge_name, index: i, from: e.from_node });
      }
      if (e.from_node === foundNodeName) {
        outgoing.push({ name: e.edge_name, index: i, to: e.to_node });
      }
    });
    return { incomingEdges: incoming, outgoingEdges: outgoing };
  }, [foundNodeName, edges]);

  return (
    <div className="space-y-4">
      {/* Fab Selector */}
      {isMultiFab() && fabs.length > 0 && (
        <div>
          <label className={twMerge(panelLabelVariants({ color: "muted", size: "xs" }), "block mb-1")}>
            Select Fab
          </label>
          <select
            value={selectedFabIndex}
            onChange={(e) => setSelectedFabIndex(Number(e.target.value))}
            className={twMerge(panelSelectVariants({ accent: "cyan", size: "md" }), "w-full")}
          >
            {fabs.map((fab) => (
              <option key={fab.fabIndex} value={fab.fabIndex}>
                Fab {fab.fabIndex} ({fab.col}, {fab.row})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Node Search (단일 input + 그룹 dropdown) */}
      <div className="relative">
        <label className={twMerge(panelLabelVariants({ color: "muted", size: "xs" }), "block mb-1")}>
          Search Node
        </label>
        <div className="flex items-center border border-panel-border rounded bg-panel-bg-solid focus-within:ring-1 focus-within:ring-accent-cyan focus-within:border-accent-cyan">
          <Search size={14} className="ml-2 text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder={foundNode ? foundNode.node_name : "N0001..."}
            className="flex-1 min-w-0 px-2 py-2 text-sm bg-transparent text-white placeholder-gray-500 focus:outline-none"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setIsDropdownOpen(true);
            }}
            onFocus={() => setIsDropdownOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleEnter();
              else if (e.key === "Escape") {
                setIsDropdownOpen(false);
                inputRef.current?.blur();
              }
            }}
          />
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="px-2 py-2 text-gray-500 hover:text-gray-300 shrink-0"
          >
            <ChevronDown size={14} className={`transition-transform ${isDropdownOpen ? "rotate-180" : ""}`} />
          </button>
        </div>

        {isDropdownOpen && (
          <div className="absolute z-50 w-full mt-1 bg-panel-bg-solid border border-panel-border rounded shadow-lg max-h-64 overflow-y-auto">
            {filteredGroups.map((group) => (
              <div key={group.key}>
                <div className="px-3 py-1.5 bg-panel-bg text-xs font-semibold text-gray-400 sticky top-0 border-b border-panel-border">
                  {group.key} ({group.items.length})
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.name}
                    onClick={() => handleNodeSelect(item.name)}
                    className={`w-full px-4 py-1.5 text-left text-sm hover:bg-accent-cyan/20 transition-colors ${
                      foundNodeName === item.name ? "bg-accent-cyan/30 text-accent-cyan" : "text-gray-300"
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            ))}
            {filteredGroups.length === 0 && (
              <div className="px-3 py-4 text-center text-gray-500 text-sm">
                {searchTerm.trim() ? "No matching nodes" : "No nodes available"}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Node Info */}
      {foundNode ? (
        <div className={panelCardVariants({ variant: "glow-cyan", padding: "md" })}>
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-semibold text-white">Node Info</h4>
            <button
              onClick={() => navigateToNode(foundNode.node_name)}
              className={panelButtonVariants({ variant: "primary", size: "sm" })}
              title="Go to Node"
            >
              <Navigation size={12} />
              Go
            </button>
          </div>

          <div className="space-y-1 text-sm bg-panel-bg-solid p-2 rounded border border-panel-border">
            <div className="flex justify-between border-b border-panel-border pb-1 mb-1">
              <span className="text-gray-400">Name</span>
              <span className="font-mono font-bold text-accent-orange">{foundNode.node_name}</span>
            </div>

            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Barcode</span>
              <span className="font-mono text-white">{foundNode.barcode}</span>
            </div>

            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Position</span>
              <span className="font-mono text-white">
                ({foundNode.editor_x.toFixed(2)}, {foundNode.editor_y.toFixed(2)}, {foundNode.editor_z.toFixed(2)})
              </span>
            </div>

            <div className="my-2 border-t border-panel-border"></div>

            {/* Topology Flags */}
            <div className="text-xs text-gray-500 mb-1">Topology</div>
            <div className="flex flex-wrap gap-1">
              {foundNode.isMerge && (
                <span className="px-1.5 py-0.5 text-[10px] rounded border bg-accent-orange/20 text-accent-orange border-accent-orange/30">
                  Merge
                </span>
              )}
              {foundNode.isDiverge && (
                <span className="px-1.5 py-0.5 text-[10px] rounded border bg-purple-500/20 text-purple-400 border-purple-500/30">
                  Diverge
                </span>
              )}
              {foundNode.isTerminal && (
                <span className="px-1.5 py-0.5 text-[10px] rounded border bg-blue-500/20 text-blue-400 border-blue-500/30">
                  Terminal
                </span>
              )}
              {!foundNode.isMerge && !foundNode.isDiverge && !foundNode.isTerminal && (
                <span className="px-1.5 py-0.5 text-[10px] rounded border bg-panel-bg text-gray-500 border-panel-border">
                  Pass-through
                </span>
              )}
            </div>

            {/* Deadlock Zone */}
            {(foundNode.isDeadlockMergeNode || foundNode.isDeadlockBranchNode) && (
              <>
                <div className="my-2 border-t border-panel-border"></div>
                <div className="text-xs text-red-400 font-medium">Deadlock Zone</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {foundNode.isDeadlockMergeNode && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded border bg-red-500/20 text-red-400 border-red-500/30">
                      DZ Merge
                    </span>
                  )}
                  {foundNode.isDeadlockBranchNode && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded border bg-red-500/20 text-red-400 border-red-500/30">
                      DZ Branch
                    </span>
                  )}
                  {foundNode.deadlockZoneId !== undefined && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded border bg-red-500/30 text-red-300 border-red-500/40 font-mono">
                      Zone #{foundNode.deadlockZoneId}
                    </span>
                  )}
                </div>
              </>
            )}

            <div className="my-2 border-t border-panel-border"></div>

            {/* Incoming Edges */}
            {incomingEdges.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-accent-orange font-medium hover:text-orange-300">
                  Incoming Edges ({incomingEdges.length})
                </summary>
                <div className="mt-1 pl-2 space-y-0.5 text-gray-400">
                  {incomingEdges.map((e) => (
                    <div key={e.index} className="flex justify-between font-mono">
                      <span>{e.name}</span>
                      <span className="text-gray-600">from {e.from}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* Outgoing Edges */}
            {outgoingEdges.length > 0 && (
              <details className="text-xs mt-1">
                <summary className="cursor-pointer text-accent-cyan font-medium hover:text-cyan-300">
                  Outgoing Edges ({outgoingEdges.length})
                </summary>
                <div className="mt-1 pl-2 space-y-0.5 text-gray-400">
                  {outgoingEdges.map((e) => (
                    <div key={e.index} className="flex justify-between font-mono">
                      <span>{e.name}</span>
                      <span className="text-gray-600">to {e.to}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      ) : null}

      {/* Click outside to close dropdown */}
      {isDropdownOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsDropdownOpen(false)}
        />
      )}
    </div>
  );
};

export default NodeControlPanel;
