import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import { vehicleDataArray, VEHICLE_DATA_SIZE, MovementData } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { getVehicleConfigSync } from "@/config/vehicleConfig";
import { SensorDebugRenderer } from "./SensorDebugRenderer";

const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * VehicleArrayRenderer
 * - Renders vehicles for array-single mode
 * - Reads from vehicleArrayStore
 * - Uses InstancedMesh for performance
 * - Sensor visibility controlled by visualizationConfig
 */

interface VehicleArrayRendererProps {
  actualNumVehicles?: number; // Optional - will read from store if not provided
}

const VehicleArrayRenderer: React.FC<VehicleArrayRendererProps> = ({
  actualNumVehicles: propActualNumVehicles,
}) => {
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);

  // Get actualNumVehicles from store if not provided as prop
  const storeActualNumVehicles = useVehicleArrayStore((state) => state.actualNumVehicles);
  const actualNumVehicles = propActualNumVehicles ?? storeActualNumVehicles;

  // Get vehicle config
  const config = getVehicleConfigSync();
  const {
    BODY: { LENGTH: bodyLength, WIDTH: bodyWidth, HEIGHT: bodyHeight },
    VEHICLE_COLOR: vehicleColor
  } = config;

  console.log(`[VehicleArrayRenderer] Rendering ${actualNumVehicles} vehicles (body only)`);

  // Create body geometry (normal box)
  const bodyGeometry = useMemo(() => {
    return new THREE.BoxGeometry(bodyLength, bodyWidth, bodyHeight);
  }, [bodyLength, bodyWidth, bodyHeight]);

  // Create material for body (normal mesh material)
  const bodyMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(vehicleColor),
    });
  }, [vehicleColor]);

  // Temporary objects for matrix calculations
  const tempMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tempPosition = useMemo(() => new THREE.Vector3(), []);
  const tempQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const tempScale = useMemo(() => new THREE.Vector3(1, 1, 1), []);

  // Initialize instance matrices
  useEffect(() => {
    const bodyMesh = bodyMeshRef.current;
    if (!bodyMesh) return;

    // Set initial instance matrices to identity
    for (let i = 0; i < actualNumVehicles; i++) {
      tempMatrix.identity();
      bodyMesh.setMatrixAt(i, tempMatrix);
    }
    bodyMesh.instanceMatrix.needsUpdate = true;

  }, [actualNumVehicles, tempMatrix]);

  // Update instance matrices every frame (Zero GC - Direct Float32Array access)
  useFrame(() => {
    const bodyMesh = bodyMeshRef.current;
    if (!bodyMesh) return;

    // ✅ Get Float32Array reference once (Zero allocation)
    const data = vehicleDataArray.getData();

    // ✅ Zero GC Loop - Direct array access
    for (let i = 0; i < actualNumVehicles; i++) {
      const ptr = i * VEHICLE_DATA_SIZE;

      // Direct read from Float32Array (no object allocation)
      const x = data[ptr + MovementData.X];
      const y = data[ptr + MovementData.Y];
      const z = data[ptr + MovementData.Z];
      const rotation = data[ptr + MovementData.ROTATION];

      // Body position
      tempPosition.set(x, y, z);

      // Convert rotation from degrees to radians (Z-axis rotation)
      const rotRad = (rotation * Math.PI) / 180;
      // Optimize: Zero GC (was new THREE.Euler)
      tempQuaternion.setFromAxisAngle(Z_AXIS, rotRad);

      // Set body matrix
      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      bodyMesh.setMatrixAt(i, tempMatrix);
    }

    // Notify GPU of matrix updates
    bodyMesh.instanceMatrix.needsUpdate = true;
  });

  if (actualNumVehicles <= 0) {
    console.warn(`[VehicleArrayRenderer] actualNumVehicles is ${actualNumVehicles}, not rendering`);
    return null;
  }

  return (
    <>
      {/* Body mesh */}
      <instancedMesh
        ref={bodyMeshRef}
        args={[bodyGeometry, bodyMaterial, actualNumVehicles]}
        frustumCulled={false}
      />

      {/* Sensor Debug Wireframes - Red wireframe */}
      <SensorDebugRenderer numVehicles={actualNumVehicles} />

      {/* Vehicle ID labels */}
      {/* <VehicleTextRenderer numVehicles={actualNumVehicles} /> */}
    </>
  );
};

export default VehicleArrayRenderer;
