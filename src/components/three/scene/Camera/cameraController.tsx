import React, { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useCameraStore } from "@store/ui/cameraStore";
import { OrbitControls } from 'three-stdlib';
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import { vehicleDataArray } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { VEHICLE_DATA_SIZE, MovementData } from "@/common/vehicle/memory/VehicleDataArrayBase";

// Zero-GC Scratchpads (모듈 레벨에서 한 번만 할당)
const _scratchZAxis = new THREE.Vector3(0, 0, 1);
const _scratchOffset = new THREE.Vector3();
const _scratchTargetPos = new THREE.Vector3();
const _scratchTargetTarget = new THREE.Vector3();

// Lerp smoothing factor (0 = no movement, 1 = instant)
const CAMERA_LERP_FACTOR = 0.08;

const CameraController: React.FC = () => {
  const { camera, controls } = useThree(); // controls는 drei가 set해줌

  // Camera store state
  const rotateZDeg = useCameraStore((s) => s.rotateZDeg);
  const _resetRotateZ = useCameraStore((s) => s._resetRotateZ);
  const shouldUpdateCamera = useCameraStore((s) => s.shouldUpdateCamera);
  const position = useCameraStore((s) => s.position);
  const target = useCameraStore((s) => s.target);
  const _resetCameraUpdate = useCameraStore((s) => s._resetCameraUpdate);
  const followingVehicle = useCameraStore((s) => s.followingVehicle);
  const followOffset = useCameraStore((s) => s.followOffset);


  // Stop following when user interacts with camera
  const stopFollowingVehicle = useCameraStore((s) => s.stopFollowingVehicle);

  // Initialize camera position from store on mount
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!controls || initializedRef.current) return;
    const orbitControls = controls as OrbitControls;

    // Set initial camera position and target from store
    camera.position.copy(position);
    orbitControls.target.copy(target);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    orbitControls.update();

    initializedRef.current = true;

  }, [camera, controls, position, target]); // Include dependencies

  // Stop following vehicle when user interacts with camera (drag, zoom, etc.)
  // Stop following vehicle when user interacts with camera (drag, zoom, etc.)
  useEffect(() => {
    if (!controls) return;
    const orbitControls = controls as OrbitControls;

    const handleStart = () => {
      // User started interacting with camera - stop following
      if (useCameraStore.getState().followingVehicle !== null) {
        stopFollowingVehicle();
      }
    };

    orbitControls.addEventListener('start', handleStart);
    return () => {
      orbitControls.removeEventListener('start', handleStart);
    };
  }, [controls, stopFollowingVehicle]);

  // Z-up 보정 (항상 유지)
  useEffect(() => {
    camera.up.set(0, 0, 1);
  }, [camera]);

  // Camera position/target update from store
  useEffect(() => {
    if (!controls) return;

    if (shouldUpdateCamera) {
      const orbitControls = controls as OrbitControls;

      // Update camera position and target
      camera.position.copy(position);
      orbitControls.target.copy(target);

      // Update camera orientation
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      orbitControls.update();

      _resetCameraUpdate();

    }
  }, [camera, controls, shouldUpdateCamera, position, target, _resetCameraUpdate]);

  // Z축 회전 처리
  useEffect(() => {
    if (!controls) return;

    // 회전 요청이 있으면 현재 target 기준으로 Z축 공전
    if (rotateZDeg !== 0) {
      const currentTarget = (controls as any).target;
      // Zero-GC: 모듈 레벨 scratch 사용
      camera.position
        .sub(currentTarget)
        .applyAxisAngle(_scratchZAxis, THREE.MathUtils.degToRad(rotateZDeg))
        .add(currentTarget);
      _resetRotateZ();

      // @ts-ignore
      controls.update();
    }
  }, [camera, controls, rotateZDeg, _resetRotateZ]);

  // Vehicle following logic with smooth lerp
  useFrame(() => {
    if (!controls || followingVehicle === null) return;

    // Get vehicle position based on mode (SHM or Array).
    // followingVehicle은 fab-local 식별자. 모드별로 worker/array index로 변환.
    let vehX = 0, vehY = 0, vehZ = 0;
    let vehicleFound = false;

    const shmController = useShmSimulatorStore.getState().controller;
    const shmData = useShmSimulatorStore.getState().getVehicleFullData();

    if (shmController && shmData) {
      const workerIdx = shmController.fabLocalToWorkerIndex(followingVehicle.fabId, followingVehicle.localIndex);
      if (workerIdx >= 0) {
        const ptr = workerIdx * VEHICLE_DATA_SIZE;
        vehX = shmData[ptr + MovementData.X];
        vehY = shmData[ptr + MovementData.Y];
        vehZ = shmData[ptr + MovementData.Z];
        vehicleFound = true;
      }
    } else {
      // Array mode fallback — fabId="" 가정, localIndex = vehicle index
      const arrayActualNumVehicles = useVehicleArrayStore.getState().actualNumVehicles;
      if (arrayActualNumVehicles > 0 && followingVehicle.localIndex < arrayActualNumVehicles) {
        const vehicleData = vehicleDataArray.get(followingVehicle.localIndex);
        if (vehicleData) {
          vehX = vehicleData.movement.x;
          vehY = vehicleData.movement.y;
          vehZ = vehicleData.movement.z;
          vehicleFound = true;
        }
      }
    }

    if (!vehicleFound) return;

    const orbitControls = controls as OrbitControls;

    // Calculate target positions
    _scratchTargetPos.set(
      vehX + followOffset[0],
      vehY + followOffset[1],
      vehZ + followOffset[2]
    );
    _scratchTargetTarget.set(vehX, vehY, vehZ);

    // Smooth lerp interpolation
    camera.position.lerp(_scratchTargetPos, CAMERA_LERP_FACTOR);
    orbitControls.target.lerp(_scratchTargetTarget, CAMERA_LERP_FACTOR);
    orbitControls.update();
  });
 
   // Fine zoom adjustment with + and - keys
   useEffect(() => {
     if (!controls) return;
 
     const handleKeyDown = (event: KeyboardEvent) => {
       // Ignore if any input is focused
       if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
         return;
       }
 
       const orbitControls = controls as OrbitControls;
       const fineZoomFactor = 0.05; // 5% adjustment per press
 
       if (['=', '+', 'NumpadAdd'].includes(event.key)) {
         // Zoom In (Decrease distance) - Zero-GC: 모듈 레벨 scratch 사용
         _scratchOffset.subVectors(camera.position, orbitControls.target);
         const dist = _scratchOffset.length();
         const newDist = Math.max(orbitControls.minDistance, dist * (1 - fineZoomFactor));

         _scratchOffset.setLength(newDist);
         camera.position.copy(orbitControls.target).add(_scratchOffset);
         orbitControls.update();
       } else if (['-', '_', 'NumpadSubtract'].includes(event.key)) {
         // Zoom Out (Increase distance) - Zero-GC: 모듈 레벨 scratch 사용
         _scratchOffset.subVectors(camera.position, orbitControls.target);
         const dist = _scratchOffset.length();
         const newDist = Math.min(orbitControls.maxDistance, dist * (1 + fineZoomFactor));

         _scratchOffset.setLength(newDist);
         camera.position.copy(orbitControls.target).add(_scratchOffset);
         orbitControls.update();
       }
     };
 
     globalThis.addEventListener('keydown', handleKeyDown);
     return () => {
       globalThis.removeEventListener('keydown', handleKeyDown);
     };
   }, [controls, camera]);

  return null;
};

export default CameraController;
