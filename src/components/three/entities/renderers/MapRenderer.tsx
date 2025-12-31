import React, { useMemo } from "react";
import { useEdgeStore } from "@/store/map/edgeStore";
import { useNodeStore } from "@/store/map/nodeStore";
import EdgeRenderer from "./EdgeRenderer";
import NodesRenderer from "./NodesRenderer";
import StationRenderer from "./StationRenderer";
import { useRenderCheck } from "@/utils/renderDebug";

/**
 * MapRenderer component - Optimized to minimize re-renders
 * - Uses InstancedMesh for both edges and nodes
 * - Only subscribes to edges and nodes (not preview items)
 * - Memoizes arrays to avoid unnecessary re-renders
 * - Vehicles are now rendered separately using VehicleSystem
 */
const MapRenderer: React.FC = () => {
  useRenderCheck("MapRenderer");

  const edges = useEdgeStore((state) => state.edges);
  const nodes = useNodeStore((state) => state.nodes);

  // Extract node IDs for NodesRenderer
  const nodeIds = useMemo(() => nodes.map((n) => n.node_name), [nodes]);

  return (
    <group>
      {/* Render all nodes using InstancedMesh */}
      <NodesRenderer nodeIds={nodeIds} />

      {/* Render all edges using InstancedMesh (grouped by type) */}
      <EdgeRenderer edges={edges} />

      {/* Render all stations using InstancedMesh (grouped by type) */}
      <StationRenderer />

      {/* Basic lighting for better visibility */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} />
    </group>
  );
};

export default MapRenderer;

