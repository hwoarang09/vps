import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import SpriteText from "three-spritetext";
import { useVehicleRapierStore } from "@/store/vehicle/rapierMode/vehicleStore";
import { getVehicleConfigSync, waitForConfig } from "@/config/vehicleConfig";
import { MovingStatus } from "@/common/vehicle/initialize/constants";

export interface VehicleRapierModeVehicleProps {
  vehicleIndex: number;
}

const VehicleRapierModeVehicle: React.FC<VehicleRapierModeVehicleProps> = ({
  vehicleIndex,
}) => {
  const store = useVehicleRapierStore();
  const rigidBodyRef = useRef<RapierRigidBody>(null);

  const initialPosition = store.getVehiclePosition(vehicleIndex);
  const position: [number, number, number] = initialPosition
    ? [initialPosition.x, initialPosition.y, initialPosition.z]
    : [0, 0, 0];

  // Get vehicle config - useState로 관리하여 로딩 완료 시 리렌더링
  const [config, setConfig] = useState(() => getVehicleConfigSync());

  // Wait for config to load from JSON
  useEffect(() => {
    waitForConfig().then(loadedConfig => {
      setConfig(loadedConfig);
    });
  }, []);

  const bodyLength = config.body.length;
  const bodyWidth = config.body.width;
  const bodyHeight = config.body.height;
  const sensorLength = bodyLength + config.spacing.vehicleSpacing;
  const sensorWidth = bodyWidth;
  const sensorHeight = bodyHeight;
  const labelTextHeight = config.label.textHeight;
  const labelZOffset = config.label.zOffset;

  const spriteText = useMemo(() => {
    const sprite = new SpriteText(vehicleIndex.toString());
    sprite.color = "#ffffff";
    sprite.backgroundColor = "rgba(0, 0, 0, 0.5)";
    sprite.textHeight = labelTextHeight;
    sprite.position.set(0, 0, labelZOffset);
    return sprite;
  }, [vehicleIndex, labelTextHeight, labelZOffset]);

  useEffect(() => {
    if (rigidBodyRef.current) {
      store.setRigidBody(vehicleIndex, rigidBodyRef.current);
    }
  }, [vehicleIndex, store]);

  const handleSensorEnter = useCallback((event: any) => {
    const otherId = event.other.rigidBodyObject?.userData?.id;

    if (otherId !== undefined && otherId !== vehicleIndex) {
      store.setVehicleStatus(vehicleIndex, MovingStatus.STOPPED);
    }
  }, [vehicleIndex, store]);

  const handleSensorExit = useCallback((event: any) => {
    const otherId = event.other.rigidBodyObject?.userData?.id;

    if (otherId !== undefined && otherId !== vehicleIndex) {
      store.setVehicleStatus(vehicleIndex, MovingStatus.MOVING);
    }
  }, [vehicleIndex, store]);

  const bodyHalfExtents = {
    x: bodyLength * 0.5,
    y: bodyWidth * 0.5,
    z: bodyHeight * 0.5,
  };

  const sensorHalfExtents = {
    x: sensorLength * 0.5,
    y: sensorWidth * 0.5,
    z: sensorHeight * 0.5,
  };

  const sensorOffsetX = bodyHalfExtents.x + sensorHalfExtents.x + 0.05;

  return (
    <RigidBody
      ref={rigidBodyRef}
      type="dynamic"
      gravityScale={0}
      lockRotations={true}
      linearDamping={0}
      angularDamping={0}
      colliders={false}
      position={position}
      userData={{ id: vehicleIndex }}
    >
      <CuboidCollider
        args={[bodyHalfExtents.x, bodyHalfExtents.y, bodyHalfExtents.z]}
        position={[0, 0, 0]}
        name={`body-${vehicleIndex}`}
      />

      <CuboidCollider
        args={[sensorHalfExtents.x, sensorHalfExtents.y, sensorHalfExtents.z]}
        position={[sensorOffsetX, 0, 0]}
        sensor
        onIntersectionEnter={handleSensorEnter}
        onIntersectionExit={handleSensorExit}
        name={`sensor-${vehicleIndex}`}
      />

      <primitive object={spriteText} /> 
    </RigidBody>
  );
};

export default VehicleRapierModeVehicle;