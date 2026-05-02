import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, Navigation, ChevronDown } from "lucide-react";
import { useEdgeStore } from "@/store/map/edgeStore";
import { useNodeStore } from "@/store/map/nodeStore";
import { useEdgeControlStore } from "@/store/ui/edgeControlStore";
import { useCameraStore } from "@/store/ui/cameraStore";
import { useFabStore } from "@/store/map/fabStore";
import {
  panelSelectVariants,
  panelCardVariants,
  panelButtonVariants,
  panelLabelVariants,
} from "../shared/panelStyles";
import { twMerge } from "tailwind-merge";

const EdgeControlPanel: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [foundEdgeIndex, setFoundEdgeIndex] = useState<number | null>(null);
  const [selectedFabIndex, setSelectedFabIndex] = useState<number>(0);
  const [isEdgeDropdownOpen, setIsEdgeDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const edges = useEdgeStore((state) => state.edges);
  const edgeNameToIndex = useEdgeStore((state) => state.edgeNameToIndex);
  const selectedEdgeIndex = useEdgeControlStore((state) => state.selectedEdgeIndex);
  const selectEdge = useEdgeControlStore((state) => state.selectEdge);
  const getNodeByName = useNodeStore((state) => state.getNodeByName);
  const setCameraView = useCameraStore((state) => state.setCameraView);

  const fabs = useFabStore((state) => state.fabs);
  const isMultiFab = useFabStore((state) => state.isMultiFab);

  const navigateToEdge = (edgeIndex: number) => {
    const edge = edges[edgeIndex];
    if (!edge) return;

    const fromNode = getNodeByName(edge.from_node);
    const toNode = getNodeByName(edge.to_node);

    if (!fromNode || !toNode) {
      console.warn("[EdgeControlPanel] Could not find nodes for edge:", edge.edge_name);
      return;
    }

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

    const centerX = (fromNode.editor_x + toNode.editor_x) / 2 + fabOffsetX;
    const centerY = (fromNode.editor_y + toNode.editor_y) / 2 + fabOffsetY;
    const centerZ = 0;

    const cameraHeight = 15;
    const cameraOffset = 8;
    const cameraPosition: [number, number, number] = [
      centerX - cameraOffset,
      centerY - cameraOffset,
      cameraHeight
    ];
    const cameraTarget: [number, number, number] = [centerX, centerY, centerZ];

    setCameraView(cameraPosition, cameraTarget);
  };

  const groupedEdges = useMemo(() => {
    const groups: Record<string, { index: number; name: string }[]> = {};

    edges.forEach((edge, index) => {
      const name = edge.edge_name;
      let groupKey = "Other";

      const bayMatch = name.match(/BAY\d+/i);
      if (bayMatch) {
        groupKey = bayMatch[0].toUpperCase();
      } else {
        const prefixMatch = name.match(/^([A-Z]+\d{1,2})/i);
        if (prefixMatch) {
          groupKey = prefixMatch[1].toUpperCase();
        } else if (name.length >= 2) {
          groupKey = name.substring(0, 2).toUpperCase();
        }
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push({ index, name });
    });

    const sortedGroups = Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([key, items]) => ({
        key,
        items: items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      }));

    return sortedGroups;
  }, [edges]);

  useEffect(() => {
    if (selectedEdgeIndex !== null) {
      const edge = edges[selectedEdgeIndex];
      if (edge) {
        setFoundEdgeIndex(selectedEdgeIndex);
        setSearchTerm("");
        navigateToEdge(selectedEdgeIndex);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEdgeIndex]);

  // 입력 기준 dropdown 필터 (이름/인덱스 부분일치)
  const filteredGroups = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return groupedEdges;
    return groupedEdges
      .map((g) => ({
        key: g.key,
        items: g.items.filter(
          (it) =>
            it.name.toLowerCase().includes(q) || String(it.index).includes(q)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groupedEdges, searchTerm]);

  const handleEnter = () => {
    if (!searchTerm.trim()) return;

    let foundIdx: number | null = null;

    const exactIndex = edgeNameToIndex.get(searchTerm.trim());
    if (exactIndex !== undefined) {
      foundIdx = exactIndex;
    }

    if (foundIdx === null) {
      const numMatch = searchTerm.match(/^(\d+)$/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10);
        if (idx >= 0 && idx < edges.length) {
          foundIdx = idx;
        }
      }
    }

    if (foundIdx === null) {
      const lowerSearch = searchTerm.toLowerCase();
      const partialMatch = edges.findIndex((e) =>
        e.edge_name.toLowerCase().includes(lowerSearch)
      );
      if (partialMatch >= 0) {
        foundIdx = partialMatch;
      }
    }

    if (foundIdx !== null) {
      handleEdgeSelect(foundIdx);
    }
  };

  const handleEdgeSelect = (edgeIndex: number) => {
    setFoundEdgeIndex(edgeIndex);
    setSearchTerm("");
    setIsEdgeDropdownOpen(false);
    inputRef.current?.blur();
    selectEdge(edgeIndex, selectedFabIndex);
    navigateToEdge(edgeIndex);
  };

  const foundEdge = foundEdgeIndex !== null ? edges[foundEdgeIndex] : null;

  return (
    <div className="space-y-4">
      {/* Fab Selector (only show if multi-fab) */}
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

      {/* Edge Search (단일 input + 그룹 dropdown) */}
      <div className="relative">
        <label className={twMerge(panelLabelVariants({ color: "muted", size: "xs" }), "block mb-1")}>
          Search Edge
        </label>
        <div className="flex items-center border border-panel-border rounded bg-panel-bg-solid focus-within:ring-1 focus-within:ring-accent-cyan focus-within:border-accent-cyan">
          <Search size={14} className="ml-2 text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder={foundEdge ? foundEdge.edge_name : "E0001 or index..."}
            className="flex-1 min-w-0 px-2 py-2 text-sm bg-transparent text-white placeholder-gray-500 focus:outline-none"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setIsEdgeDropdownOpen(true);
            }}
            onFocus={() => setIsEdgeDropdownOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleEnter();
              else if (e.key === "Escape") {
                setIsEdgeDropdownOpen(false);
                inputRef.current?.blur();
              }
            }}
          />
          <button
            onClick={() => setIsEdgeDropdownOpen(!isEdgeDropdownOpen)}
            className="px-2 py-2 text-gray-500 hover:text-gray-300 shrink-0"
          >
            <ChevronDown size={14} className={`transition-transform ${isEdgeDropdownOpen ? "rotate-180" : ""}`} />
          </button>
        </div>

        {isEdgeDropdownOpen && (
          <div className="absolute z-50 w-full mt-1 bg-panel-bg-solid border border-panel-border rounded shadow-lg max-h-64 overflow-y-auto">
            {filteredGroups.map((group) => (
              <div key={group.key}>
                <div className="px-3 py-1.5 bg-panel-bg text-xs font-semibold text-gray-400 sticky top-0 border-b border-panel-border">
                  {group.key} ({group.items.length})
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.index}
                    onClick={() => handleEdgeSelect(item.index)}
                    className={`w-full px-4 py-1.5 text-left text-sm hover:bg-accent-cyan/20 transition-colors ${
                      foundEdgeIndex === item.index ? "bg-accent-cyan/30 text-accent-cyan" : "text-gray-300"
                    }`}
                  >
                    {item.name}
                    <span className="text-gray-500 text-xs ml-2">#{item.index}</span>
                  </button>
                ))}
              </div>
            ))}
            {filteredGroups.length === 0 && (
              <div className="px-3 py-4 text-center text-gray-500 text-sm">
                {searchTerm.trim() ? "No matching edges" : "No edges available"}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edge Info */}
      {foundEdge ? (
        <div className={panelCardVariants({ variant: "glow-cyan", padding: "md" })}>
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-semibold text-white">Edge Info</h4>
            <div className="flex items-center gap-2">
              <button
                onClick={() => foundEdgeIndex !== null && navigateToEdge(foundEdgeIndex)}
                className={panelButtonVariants({ variant: "primary", size: "sm" })}
                title="Go to Edge"
              >
                <Navigation size={12} />
                Go
              </button>
              <span className="text-xs text-gray-500 font-mono">#{foundEdgeIndex}</span>
            </div>
          </div>

          <div className="space-y-1 text-sm bg-panel-bg-solid p-2 rounded border border-panel-border">
            {/* Basic Info */}
            <div className="flex justify-between border-b border-panel-border pb-1 mb-1">
              <span className="text-gray-400">Name</span>
              <span className="font-mono font-bold text-accent-orange">{foundEdge.edge_name}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-400">Type</span>
              <span className="font-mono text-white">{foundEdge.vos_rail_type || "Unknown"}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-400">Distance</span>
              <span className="font-mono text-white">{foundEdge.distance?.toFixed(2) || "N/A"} m</span>
            </div>

            <div className="my-2 border-t border-panel-border"></div>

            {/* Node Info */}
            <div className="flex justify-between text-xs text-accent-cyan">
              <span>From Node</span>
              <span className="font-mono">{foundEdge.from_node}</span>
            </div>

            <div className="flex justify-between text-xs text-accent-cyan">
              <span>To Node</span>
              <span className="font-mono">{foundEdge.to_node}</span>
            </div>

            <div className="my-2 border-t border-panel-border"></div>

            {/* Topology Flags */}
            <div className="text-xs text-gray-500 mb-1">Topology</div>
            <div className="flex flex-wrap gap-1">
              {foundEdge.fromNodeIsMerge && (
                <span className="px-1.5 py-0.5 text-[10px] rounded border bg-accent-orange/20 text-accent-orange border-accent-orange/30">
                  FN:Merge
                </span>
              )}
              {foundEdge.fromNodeIsDiverge && (
                <span className="px-1.5 py-0.5 text-[10px] rounded border bg-purple-500/20 text-purple-400 border-purple-500/30">
                  FN:Diverge
                </span>
              )}
              {foundEdge.toNodeIsMerge && (
                <span className="px-1.5 py-0.5 text-[10px] rounded border bg-accent-orange/20 text-accent-orange border-accent-orange/30">
                  TN:Merge
                </span>
              )}
              {foundEdge.toNodeIsDiverge && (
                <span className="px-1.5 py-0.5 text-[10px] rounded border bg-purple-500/20 text-purple-400 border-purple-500/30">
                  TN:Diverge
                </span>
              )}
              {!foundEdge.fromNodeIsMerge && !foundEdge.fromNodeIsDiverge &&
               !foundEdge.toNodeIsMerge && !foundEdge.toNodeIsDiverge && (
                <span className="px-1.5 py-0.5 text-[10px] rounded border bg-panel-bg text-gray-500 border-panel-border">
                  Linear
                </span>
              )}
            </div>

            {/* Curve Direction */}
            {foundEdge.curve_direction && (
              <div className="flex justify-between mt-2">
                <span className="text-gray-400">Curve</span>
                <span className="font-mono text-white">{foundEdge.curve_direction}</span>
              </div>
            )}

            <div className="my-2 border-t border-panel-border"></div>

            {/* Next/Prev Edges */}
            {foundEdge.nextEdgeIndices && foundEdge.nextEdgeIndices.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-accent-cyan font-medium hover:text-cyan-300">
                  Next Edges ({foundEdge.nextEdgeIndices.length})
                </summary>
                <div className="mt-1 pl-2 space-y-0.5 text-gray-400">
                  {foundEdge.nextEdgeIndices.map((idx: number) => {
                    const nextEdge = edges[idx];
                    return (
                      <div key={idx} className="flex justify-between font-mono">
                        <span>{nextEdge?.edge_name || "Unknown"}</span>
                        <span className="text-gray-600">#{idx}</span>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}

            {foundEdge.prevEdgeIndices && foundEdge.prevEdgeIndices.length > 0 && (
              <details className="text-xs mt-1">
                <summary className="cursor-pointer text-accent-orange font-medium hover:text-orange-300">
                  Prev Edges ({foundEdge.prevEdgeIndices.length})
                </summary>
                <div className="mt-1 pl-2 space-y-0.5 text-gray-400">
                  {foundEdge.prevEdgeIndices.map((idx: number) => {
                    const prevEdge = edges[idx];
                    return (
                      <div key={idx} className="flex justify-between font-mono">
                        <span>{prevEdge?.edge_name || "Unknown"}</span>
                        <span className="text-gray-600">#{idx}</span>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}

            {/* Deadlock Zone Info */}
            {(foundEdge.isDeadlockZoneInside || foundEdge.isDeadlockZoneEntry) && (
              <>
                <div className="my-2 border-t border-panel-border"></div>
                <div className="text-xs text-red-400 font-medium">Deadlock Zone</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {foundEdge.isDeadlockZoneEntry && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded border bg-red-500/20 text-red-400 border-red-500/30">
                      Entry
                    </span>
                  )}
                  {foundEdge.isDeadlockZoneInside && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded border bg-red-500/20 text-red-400 border-red-500/30">
                      Inside
                    </span>
                  )}
                  {foundEdge.deadlockZoneId !== undefined && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded border bg-red-500/30 text-red-300 border-red-500/40 font-mono">
                      Zone #{foundEdge.deadlockZoneId}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* Click outside to close dropdown */}
      {isEdgeDropdownOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsEdgeDropdownOpen(false)}
        />
      )}
    </div>
  );
};

export default EdgeControlPanel;
