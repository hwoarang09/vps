import React, { useMemo } from 'react';
import { useNodeStore } from '@/store/map/nodeStore';

/**
 * Floor component - Creates a factory floor at z=0
 */
const Floor: React.FC = () => {
  const nodes = useNodeStore((state) => state.nodes);

  const { width, height, centerX, centerY } = useMemo(() => {
    if (nodes.length === 0) {
      return { width: 200, height: 200, centerX: 0, centerY: 0 };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const node of nodes) {
      minX = Math.min(minX, node.editor_x);
      maxX = Math.max(maxX, node.editor_x);
      minY = Math.min(minY, node.editor_y);
      maxY = Math.max(maxY, node.editor_y);
    }

    const padding = 50;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    return { width, height, centerX, centerY };
  }, [nodes]);

  return (
    <mesh position={[centerX, centerY, -1]} receiveShadow>
      {/* Dynamic plane for factory floor - normal vector points to +Z */}
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        color="#404040"
        roughness={0.8}
        metalness={0.1}
      />
    </mesh>
  );
};

export default Floor;
