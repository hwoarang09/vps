import React, { useState, useEffect, useMemo } from "react";
import { Search, Navigation, ChevronDown } from "lucide-react";
import { useEdgeStore } from "@/store/map/edgeStore";
import { useNodeStore } from "@/store/map/nodeStore";
import { useEdgeControlStore } from "@/store/ui/edgeControlStore";
import { useCameraStore } from "@/store/ui/cameraStore";
import { useFabStore } from "@/store/map/fabStore";

const EdgeControlPanel: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [foundEdgeIndex, setFoundEdgeIndex] = useState<number | null>(null);
  const [selectedFabIndex, setSelectedFabIndex] = useState<number>(0);
  const [isEdgeDropdownOpen, setIsEdgeDropdownOpen] = useState(false);

  const edges = useEdgeStore((state) => state.edges);
  const edgeNameToIndex = useEdgeStore((state) => state.edgeNameToIndex);
  const selectedEdgeIndex = useEdgeControlStore((state) => state.selectedEdgeIndex);
  const getNodeByName = useNodeStore((state) => state.getNodeByName);
  const setCameraView = useCameraStore((state) => state.setCameraView);

  // Fab store
  const fabs = useFabStore((state) => state.fabs);
  const isMultiFab = useFabStore((state) => state.isMultiFab);

  // Navigate camera to edge center
  const navigateToEdge = (edgeIndex: number) => {
    const edge = edges[edgeIndex];
    if (!edge) return;

    const fromNode = getNodeByName(edge.from_node);
    const toNode = getNodeByName(edge.to_node);

    if (!fromNode || !toNode) {
      console.warn("[EdgeControlPanel] Could not find nodes for edge:", edge.edge_name);
      return;
    }

    // Get fab offset if multi-fab
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

    // Calculate edge center point with fab offset
    const centerX = (fromNode.editor_x + toNode.editor_x) / 2 + fabOffsetX;
    const centerY = (fromNode.editor_y + toNode.editor_y) / 2 + fabOffsetY;
    const centerZ = 0;

    // Camera position: above and slightly offset from edge center
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

  // Group edges by prefix (e.g., E00, E01, etc.)
  const groupedEdges = useMemo(() => {
    const groups: Record<string, { index: number; name: string }[]> = {};

    edges.forEach((edge, index) => {
      // Extract group key from edge name (first 3-4 chars or bay pattern)
      const name = edge.edge_name;
      let groupKey = "Other";

      // Try to extract bay-like pattern (e.g., "BAY01", "BAY26")
      const bayMatch = name.match(/BAY\d+/i);
      if (bayMatch) {
        groupKey = bayMatch[0].toUpperCase();
      } else {
        // Use first 3 characters as group (e.g., E00, E01)
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

    // Sort groups and edges within groups
    const sortedGroups = Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([key, items]) => ({
        key,
        items: items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      }));

    return sortedGroups;
  }, [edges]);

  // Sync from store selection and navigate
  useEffect(() => {
    if (selectedEdgeIndex !== null) {
      const edge = edges[selectedEdgeIndex];
      if (edge) {
        setFoundEdgeIndex(selectedEdgeIndex);
        setSearchTerm(edge.edge_name);
        navigateToEdge(selectedEdgeIndex);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEdgeIndex]);

  const handleSearch = () => {
    if (!searchTerm.trim()) {
      setFoundEdgeIndex(null);
      return;
    }

    let foundIdx: number | null = null;

    // 1. Try exact name match
    const exactIndex = edgeNameToIndex.get(searchTerm.trim());
    if (exactIndex !== undefined) {
      foundIdx = exactIndex;
    }

    // 2. Try index if number
    if (foundIdx === null) {
      const numMatch = searchTerm.match(/^(\d+)$/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10);
        if (idx >= 0 && idx < edges.length) {
          foundIdx = idx;
        }
      }
    }

    // 3. Try partial match (case-insensitive)
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
      setFoundEdgeIndex(foundIdx);
      navigateToEdge(foundIdx);
    } else {
      setFoundEdgeIndex(null);
      alert("Edge not found");
    }
  };

  const handleEdgeSelect = (edgeIndex: number) => {
    setFoundEdgeIndex(edgeIndex);
    setSearchTerm(edges[edgeIndex]?.edge_name || "");
    setIsEdgeDropdownOpen(false);
    navigateToEdge(edgeIndex);
  };

  const foundEdge = foundEdgeIndex !== null ? edges[foundEdgeIndex] : null;

  return (
    <div className="space-y-4">
      {/* Fab Selector (only show if multi-fab) */}
      {isMultiFab() && fabs.length > 0 && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Select Fab</label>
          <select
            value={selectedFabIndex}
            onChange={(e) => setSelectedFabIndex(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            {fabs.map((fab) => (
              <option key={fab.fabIndex} value={fab.fabIndex}>
                Fab {fab.fabIndex} ({fab.col}, {fab.row})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Edge Dropdown */}
      <div className="relative">
        <label className="block text-xs text-gray-500 mb-1">Select Edge</label>
        <button
          onClick={() => setIsEdgeDropdownOpen(!isEdgeDropdownOpen)}
          className="w-full px-3 py-2 border border-gray-300 rounded bg-white flex justify-between items-center hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <span className={foundEdge ? "text-gray-900" : "text-gray-400"}>
            {foundEdge ? foundEdge.edge_name : "Choose an edge..."}
          </span>
          <ChevronDown size={16} className={`text-gray-400 transition-transform ${isEdgeDropdownOpen ? "rotate-180" : ""}`} />
        </button>

        {isEdgeDropdownOpen && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-64 overflow-y-auto">
            {groupedEdges.map((group) => (
              <div key={group.key}>
                <div className="px-3 py-1.5 bg-gray-100 text-xs font-semibold text-gray-600 sticky top-0">
                  {group.key} ({group.items.length})
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.index}
                    onClick={() => handleEdgeSelect(item.index)}
                    className={`w-full px-4 py-1.5 text-left text-sm hover:bg-blue-50 ${
                      foundEdgeIndex === item.index ? "bg-blue-100 text-blue-700" : "text-gray-700"
                    }`}
                  >
                    {item.name}
                    <span className="text-gray-400 text-xs ml-2">#{item.index}</span>
                  </button>
                ))}
              </div>
            ))}
            {groupedEdges.length === 0 && (
              <div className="px-3 py-4 text-center text-gray-400 text-sm">
                No edges available
              </div>
            )}
          </div>
        )}
      </div>

      {/* Search Area */}
      <div className="relative">
        <label className="block text-xs text-gray-500 mb-1">Or search by name/index</label>
        <input
          type="text"
          placeholder="E0001 or 0"
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <Search className="absolute left-3 top-8 text-gray-400" size={18} />
      </div>

      {/* Edge Info */}
      {foundEdge ? (
        <div className="mt-4 p-4 border border-gray-200 rounded bg-gray-50">
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-semibold">Edge Info</h4>
            <div className="flex items-center gap-2">
              <button
                onClick={() => foundEdgeIndex !== null && navigateToEdge(foundEdgeIndex)}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                title="Go to Edge"
              >
                <Navigation size={12} />
                Go
              </button>
              <span className="text-xs text-gray-400 font-mono">#{foundEdgeIndex}</span>
            </div>
          </div>

          <div className="space-y-1 text-sm bg-white p-2 rounded border border-gray-100">
            {/* Basic Info */}
            <div className="flex justify-between border-b border-gray-100 pb-1 mb-1">
              <span className="text-gray-500">Name</span>
              <span className="font-mono font-bold">{foundEdge.edge_name}</span>
            </div>

            <div className="flex justify-between">
              <span>Type</span>
              <span className="font-mono">{foundEdge.vos_rail_type || "Unknown"}</span>
            </div>

            <div className="flex justify-between">
              <span>Distance</span>
              <span className="font-mono">{foundEdge.distance?.toFixed(2) || "N/A"} m</span>
            </div>

            <div className="my-2 border-t border-gray-200"></div>

            {/* Node Info */}
            <div className="flex justify-between text-xs text-blue-600">
              <span>From Node</span>
              <span className="font-mono">{foundEdge.from_node}</span>
            </div>

            <div className="flex justify-between text-xs text-blue-600">
              <span>To Node</span>
              <span className="font-mono">{foundEdge.to_node}</span>
            </div>

            <div className="my-2 border-t border-gray-200"></div>

            {/* Topology Flags */}
            <div className="text-xs text-gray-500 mb-1">Topology</div>
            <div className="flex flex-wrap gap-1">
              {foundEdge.fromNodeIsMerge && (
                <span className="px-1.5 py-0.5 text-[10px] rounded border bg-orange-50 text-orange-700 border-orange-200">
                  FN:Merge
                </span>
              )}
              {foundEdge.fromNodeIsDiverge && (
                <span className="px-1.5 py-0.5 text-[10px] rounded border bg-purple-50 text-purple-700 border-purple-200">
                  FN:Diverge
                </span>
              )}
              {foundEdge.toNodeIsMerge && (
                <span className="px-1.5 py-0.5 text-[10px] rounded border bg-orange-50 text-orange-700 border-orange-200">
                  TN:Merge
                </span>
              )}
              {foundEdge.toNodeIsDiverge && (
                <span className="px-1.5 py-0.5 text-[10px] rounded border bg-purple-50 text-purple-700 border-purple-200">
                  TN:Diverge
                </span>
              )}
              {!foundEdge.fromNodeIsMerge && !foundEdge.fromNodeIsDiverge &&
               !foundEdge.toNodeIsMerge && !foundEdge.toNodeIsDiverge && (
                <span className="px-1.5 py-0.5 text-[10px] rounded border bg-gray-100 text-gray-500 border-gray-200">
                  Linear
                </span>
              )}
            </div>

            {/* Curve Direction */}
            {foundEdge.curve_direction && (
              <div className="flex justify-between mt-2">
                <span>Curve</span>
                <span className="font-mono">{foundEdge.curve_direction}</span>
              </div>
            )}

            <div className="my-2 border-t border-gray-200"></div>

            {/* Next/Prev Edges */}
            {foundEdge.nextEdgeIndices && foundEdge.nextEdgeIndices.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-cyan-700 font-medium hover:text-cyan-900">
                  Next Edges ({foundEdge.nextEdgeIndices.length})
                </summary>
                <div className="mt-1 pl-2 space-y-0.5 text-gray-600">
                  {foundEdge.nextEdgeIndices.map((idx: number) => {
                    const nextEdge = edges[idx];
                    return (
                      <div key={idx} className="flex justify-between font-mono">
                        <span>{nextEdge?.edge_name || "Unknown"}</span>
                        <span className="text-gray-400">#{idx}</span>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}

            {foundEdge.prevEdgeIndices && foundEdge.prevEdgeIndices.length > 0 && (
              <details className="text-xs mt-1">
                <summary className="cursor-pointer text-orange-700 font-medium hover:text-orange-900">
                  Prev Edges ({foundEdge.prevEdgeIndices.length})
                </summary>
                <div className="mt-1 pl-2 space-y-0.5 text-gray-600">
                  {foundEdge.prevEdgeIndices.map((idx: number) => {
                    const prevEdge = edges[idx];
                    return (
                      <div key={idx} className="flex justify-between font-mono">
                        <span>{prevEdge?.edge_name || "Unknown"}</span>
                        <span className="text-gray-400">#{idx}</span>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}

            {/* Deadlock Zone Info */}
            {(foundEdge.isDeadlockZoneInside || foundEdge.isDeadlockZoneEntry) && (
              <>
                <div className="my-2 border-t border-gray-200"></div>
                <div className="text-xs text-red-600 font-medium">Deadlock Zone</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {foundEdge.isDeadlockZoneEntry && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded border bg-red-50 text-red-700 border-red-200">
                      Entry
                    </span>
                  )}
                  {foundEdge.isDeadlockZoneInside && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded border bg-red-50 text-red-700 border-red-200">
                      Inside
                    </span>
                  )}
                  {foundEdge.deadlockZoneId !== undefined && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded border bg-red-100 text-red-800 border-red-300 font-mono">
                      Zone #{foundEdge.deadlockZoneId}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center text-gray-400 py-8">
          <Search size={48} className="mx-auto mb-4 opacity-50" />
          <p className="text-sm">드롭다운에서 Edge를 선택하거나</p>
          <p className="text-sm">이름/인덱스로 검색하세요</p>
        </div>
      )}

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
