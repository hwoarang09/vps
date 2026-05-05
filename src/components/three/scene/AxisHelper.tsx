import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';

/**
 * AxisHelper component - Shows X, Y, Z axes using THREE.AxesHelper
 */
const AxisHelper: React.FC = () => {
  const { scene } = useThree();
  const axesHelperRef = useRef<THREE.AxesHelper | null>(null);

  useEffect(() => {
    // Create AxesHelper with size 10
    const axesHelper = new THREE.AxesHelper(10);
    axesHelperRef.current = axesHelper;

    // Add to scene
    scene.add(axesHelper);

    // Cleanup on unmount
    return () => {
      if (axesHelperRef.current) {
        scene.remove(axesHelperRef.current);
      }
    };
  }, [scene]);

  // This component doesn't render JSX, it directly manipulates the scene
  return null;
};

export default AxisHelper;
