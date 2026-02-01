import React, { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { useEdgeStore } from "@/store/map/edgeStore";
import { useEdgeControlStore } from "@/store/ui/edgeControlStore";
import { EdgeType } from "@/types";

const EdgeControlPanel: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [foundEdgeIndex, setFoundEdgeIndex] = useState<number | null>(null);

  const edges = useEdgeStore((state) => state.edges);
  const edgeNameToIndex = useEdgeStore((state) => state.edgeNameToIndex);
  const selectedEdgeIndex = useEdgeControlStore((state) => state.selectedEdgeIndex);

  // Sync from store selection
  useEffect(() => {
    if (selectedEdgeIndex !== null) {
      const edge = edges[selectedEdgeIndex];
      if (edge) {
        setFoundEdgeIndex(selectedEdgeIndex);
        setSearchTerm(edge.edge_name);
      }
    }
  }, [selectedEdgeIndex, edges]);

  const handleSearch = () => {
    if (!searchTerm.trim()) {
      setFoundEdgeIndex(null);
      return;
    }

    // 1. Try exact name match
    const exactIndex = edgeNameToIndex.get(searchTerm.trim());
    if (exactIndex !== undefined) {
      setFoundEdgeIndex(exactIndex);
      return;
    }

    // 2. Try index if number
    const numMatch = searchTerm.match(/^(\d+)$/);
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10);
      if (idx >= 0 && idx < edges.length) {
        setFoundEdgeIndex(idx);
        return;
      }
    }

    // 3. Try partial match (case-insensitive)
    const lowerSearch = searchTerm.toLowerCase();
    const partialMatch = edges.findIndex((e) =>
      e.edge_name.toLowerCase().includes(lowerSearch)
    );
    if (partialMatch >= 0) {
      setFoundEdgeIndex(partialMatch);
      return;
    }

    setFoundEdgeIndex(null);
    alert("Edge not found");
  };

  const foundEdge = foundEdgeIndex !== null ? edges[foundEdgeIndex] : null;

  return (
    <div className="space-y-4">
      {/* Search Area */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search Edge (name or index)"
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <Search className="absolute left-3 top-2.5 text-gray-400" size={20} />
      </div>

      {/* Edge Info */}
      {foundEdge ? (
        <div className="mt-4 p-4 border border-gray-200 rounded bg-gray-50">
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-semibold">Edge Info</h4>
            <span className="text-xs text-gray-400 font-mono">#{foundEdgeIndex}</span>
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
                  {foundEdge.nextEdgeIndices.map((idx) => {
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
                  {foundEdge.prevEdgeIndices.map((idx) => {
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
          <p className="text-sm">Edge 이름 또는 인덱스를 검색하세요</p>
          <p className="text-xs mt-1">예: E001 또는 0</p>
        </div>
      )}
    </div>
  );
};

export default EdgeControlPanel;
