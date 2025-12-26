import { create } from "zustand";
import * as THREE from "three";
import { getDefaultCameraPosition, getDefaultCameraTarget } from "@/config/cameraConfig";

type CameraState = {
  position: THREE.Vector3;
  target: THREE.Vector3;

  // 1회성 회전 요청(도 단위). 처리되면 0으로 리셋
  rotateZDeg: number;

  // Camera update request flag
  shouldUpdateCamera: boolean;

  // Vehicle tracking
  followingVehicleId: number | null;
  followOffset: [number, number, number]; // Offset from vehicle position

  setPosition: (pos: THREE.Vector3 | THREE.Vector3Like) => void;
  setTarget: (t: THREE.Vector3 | THREE.Vector3Like) => void;
  setCameraView: (position: [number, number, number], target: [number, number, number]) => void;

  requestRotateZ: (deltaDeg: number) => void;
  _resetRotateZ: () => void;
  _resetCameraUpdate: () => void;

  // Vehicle tracking methods
  followVehicle: (vehicleId: number, offset?: [number, number, number]) => void;
  stopFollowingVehicle: () => void;
};

export const useCameraStore = create<CameraState>((set) => {
  const defaultPos = getDefaultCameraPosition();
  const defaultTarget = getDefaultCameraTarget();

  return {
    position: new THREE.Vector3(defaultPos[0], defaultPos[1], defaultPos[2]),
    target: new THREE.Vector3(defaultTarget[0], defaultTarget[1], defaultTarget[2]),

  rotateZDeg: 0,
  shouldUpdateCamera: false,

  followingVehicleId: null,
  followOffset: [-10, -10, 15],

  setPosition: (pos) => set((s) => ({ position: s.position.copy(pos as any) })),

  setTarget: (t) => set((s) => ({ target: s.target.copy(t as any) })),

  setCameraView: (position, target) => set((s) => ({
    position: s.position.set(position[0], position[1], position[2]),
    target: s.target.set(target[0], target[1], target[2]),
    shouldUpdateCamera: true,
  })),

    requestRotateZ: (deltaDeg) => set({ rotateZDeg: deltaDeg }),
    _resetRotateZ: () => set({ rotateZDeg: 0 }),
    _resetCameraUpdate: () => set({ shouldUpdateCamera: false }),

    followVehicle: (vehicleId, offset = [-10, -10, 15]) => {
      console.log(`[CameraStore] Following vehicle ${vehicleId}`);
      set({ followingVehicleId: vehicleId, followOffset: offset });
    },

    stopFollowingVehicle: () => {
      console.log('[CameraStore] Stopped following vehicle');
      set({ followingVehicleId: null });
    },
  };
});
