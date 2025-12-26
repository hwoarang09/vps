import React, { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useCameraStore } from "@store/ui/cameraStore";
import { useMenuStore } from "@store/ui/menuStore";
import { OrbitControls } from 'three-stdlib';
import { getBayBuilderCameraPosition, getBayBuilderCameraTarget } from "@/config/cameraConfig";

const CameraController: React.FC = () => {
  const { camera, controls } = useThree(); // controls는 drei가 set해줌

  // Debug: Print camera position and target every frame
  // useFrame(() => {
  //   if (controls) {
  //     const orbitControls = controls as OrbitControls;
  //     console.log('[Camera Debug]', {
  //       position: camera.position.toArray(),
  //       target: orbitControls.target.toArray(),
  //     });
  //   }
  // });

  // Camera store state
  const rotateZDeg = useCameraStore((s) => s.rotateZDeg);
  const _resetRotateZ = useCameraStore((s) => s._resetRotateZ);
  const shouldUpdateCamera = useCameraStore((s) => s.shouldUpdateCamera);
  const position = useCameraStore((s) => s.position);
  const target = useCameraStore((s) => s.target);
  const _resetCameraUpdate = useCameraStore((s) => s._resetCameraUpdate);
  const followingVehicleId = useCameraStore((s) => s.followingVehicleId);
  const followOffset = useCameraStore((s) => s.followOffset);

  // Menu state for Bay Builder detection
  const { activeMainMenu, activeSubMenu } = useMenuStore();

  // Store original camera state for restoration
  const originalStateRef = useRef<{
    position: THREE.Vector3;
    rotation: THREE.Euler;
    target: THREE.Vector3;
    enableRotate: boolean;
    mouseButtons: {
      LEFT: number;
      MIDDLE: number;
      RIGHT: number;
    };
  } | null>(null);

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

    console.log('[CameraController] Initial camera set:', {
      position: position.toArray(),
      target: target.toArray()
    });
  }, [camera, controls, position, target]); // Include dependencies

  // Z-up 보정 (항상 유지)
  useEffect(() => {
    camera.up.set(0, 0, 1);
  }, [camera, activeMainMenu, activeSubMenu]); // 메뉴 변경 시에도 Z-up 유지

  // Bay Builder mode detection and Top View switching
  useEffect(() => {
    const isBayBuilderMode = activeMainMenu === "LayoutBuilder" && activeSubMenu === "layout-menu-1";

    if (!controls) return;
    const orbitControls = controls as OrbitControls;

    if (isBayBuilderMode && !originalStateRef.current) {
      // Save original state before switching to top view
      originalStateRef.current = {
        position: camera.position.clone(),
        rotation: camera.rotation.clone(),
        target: orbitControls.target.clone(),
        enableRotate: orbitControls.enableRotate,
        mouseButtons: {
          LEFT: orbitControls.mouseButtons.LEFT || 0,
          MIDDLE: orbitControls.mouseButtons.MIDDLE || 1,
          RIGHT: orbitControls.mouseButtons.RIGHT || 2,
        },
      };

      // Switch to top view using config
      const bayPos = getBayBuilderCameraPosition();
      const bayTarget = getBayBuilderCameraTarget();
      camera.position.set(bayPos[0], bayPos[1], bayPos[2]);
      camera.lookAt(bayTarget[0], bayTarget[1], bayTarget[2]);
      camera.up.set(0, 1, 0); // Y-up for top view
      camera.updateProjectionMatrix();

      // Configure controls for Bay Builder mode
      orbitControls.target.set(bayTarget[0], bayTarget[1], bayTarget[2]);
      orbitControls.enableRotate = false;
      orbitControls.enablePan = true;
      orbitControls.enableZoom = true;

      // Remap mouse buttons for Bay Builder mode
      orbitControls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      orbitControls.mouseButtons.RIGHT = undefined;

      orbitControls.update();

    } else if (!isBayBuilderMode && originalStateRef.current) {
      // When leaving Bay Builder mode, only restore controls (keep current camera position)
      camera.up.set(0, 0, 1); // Restore Z-up

      orbitControls.enableRotate = originalStateRef.current.enableRotate;
      orbitControls.enablePan = true;
      orbitControls.enableZoom = true;

      // Restore original mouse button settings
      orbitControls.mouseButtons.LEFT = originalStateRef.current.mouseButtons.LEFT;
      orbitControls.mouseButtons.MIDDLE = originalStateRef.current.mouseButtons.MIDDLE;
      orbitControls.mouseButtons.RIGHT = originalStateRef.current.mouseButtons.RIGHT;

      orbitControls.update();

      originalStateRef.current = null;
    }
  }, [activeMainMenu, activeSubMenu, camera, controls]);

  // WSAD keyboard movement for Bay Builder mode
  useEffect(() => {
    const isBayBuilderMode = activeMainMenu === "LayoutBuilder" && activeSubMenu === "layout-menu-1";
    if (!isBayBuilderMode) return;

    const moveSpeed = 2; // Movement speed
    const pressedKeys = new Set<string>();

    const handleKeyDown = (event: KeyboardEvent) => {
      pressedKeys.add(event.key.toLowerCase());
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(event.key.toLowerCase());
    };

    const updateCameraPosition = () => {
      if (!isBayBuilderMode || !controls) return;

      let deltaX = 0;
      let deltaY = 0;

      // WSAD movement
      if (pressedKeys.has('w')) deltaY += moveSpeed;
      if (pressedKeys.has('s')) deltaY -= moveSpeed;
      if (pressedKeys.has('a')) deltaX -= moveSpeed;
      if (pressedKeys.has('d')) deltaX += moveSpeed;

      if (deltaX !== 0 || deltaY !== 0) {
        const orbitControls = controls as OrbitControls;

        // Move camera and target together to maintain top-down view
        camera.position.x += deltaX;
        camera.position.y += deltaY;
        orbitControls.target.x += deltaX;
        orbitControls.target.y += deltaY;

        orbitControls.update();
      }
    };

    // Animation loop for smooth movement
    let animationId: number;
    const animate = () => {
      updateCameraPosition();
      animationId = requestAnimationFrame(animate);
    };

    globalThis.addEventListener('keydown', handleKeyDown);
    globalThis.addEventListener('keyup', handleKeyUp);
    animate();

    return () => {
      globalThis.removeEventListener('keydown', handleKeyDown);
      globalThis.removeEventListener('keyup', handleKeyUp);
      cancelAnimationFrame(animationId);
    };
  }, [activeMainMenu, activeSubMenu, camera, controls]);

  // Camera position/target update from store
  useEffect(() => {
    if (!controls) return;

    // Bay Builder mode should not be affected by camera updates
    const isBayBuilderMode = activeMainMenu === "LayoutBuilder" && activeSubMenu === "layout-menu-1";
    if (isBayBuilderMode) return;

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

      console.log('[CameraController] Camera updated:', {
        position: position.toArray(),
        target: target.toArray()
      });
    }
  }, [camera, controls, shouldUpdateCamera, position, target, _resetCameraUpdate, activeMainMenu, activeSubMenu]);

  // Z축 회전 처리 (Bay Builder 모드가 아닐 때만)
  useEffect(() => {
    if (!controls) return;

    // Bay Builder 모드에서는 기존 카메라 로직을 무시
    const isBayBuilderMode = activeMainMenu === "LayoutBuilder" && activeSubMenu === "layout-menu-1";
    if (isBayBuilderMode) return;

    // 회전 요청이 있으면 현재 target 기준으로 Z축 공전
    if (rotateZDeg !== 0) {
      const currentTarget = (controls as any).target;
      const axis = new THREE.Vector3(0, 0, 1);
      camera.position
        .sub(currentTarget)
        .applyAxisAngle(axis, THREE.MathUtils.degToRad(rotateZDeg))
        .add(currentTarget);
      _resetRotateZ();

      // @ts-ignore
      controls.update();
    }
  }, [camera, controls, rotateZDeg, _resetRotateZ, activeMainMenu, activeSubMenu]);

  // Vehicle following logic
  useFrame(() => {
    if (!controls || followingVehicleId === null) return;

    // Skip in Bay Builder mode
    const isBayBuilderMode = activeMainMenu === "LayoutBuilder" && activeSubMenu === "layout-menu-1";
    if (isBayBuilderMode) return;

    // Get vehicle position from vehicleDataArray
    // @ts-ignore - accessing global globalThis object
    const vehicleData = globalThis.vehicleDataArray?.get(followingVehicleId);

    if (vehicleData && vehicleData.status.status !== 0) {
      const vehX = vehicleData.movement.x;
      const vehY = vehicleData.movement.y;
      const vehZ = vehicleData.movement.z;

      const orbitControls = controls as OrbitControls;

      // Update camera position with offset
      camera.position.set(
        vehX + followOffset[0],
        vehY + followOffset[1],
        vehZ + followOffset[2]
      );

      // Update target to vehicle position
      orbitControls.target.set(vehX, vehY, vehZ);
      orbitControls.update();
    }
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
         // Zoom In (Decrease distance)
         const offset = new THREE.Vector3().subVectors(camera.position, orbitControls.target);
         const dist = offset.length();
         const newDist = Math.max(orbitControls.minDistance, dist * (1 - fineZoomFactor));
         
         offset.setLength(newDist);
         camera.position.copy(orbitControls.target).add(offset);
         orbitControls.update();
       } else if (['-', '_', 'NumpadSubtract'].includes(event.key)) {
         // Zoom Out (Increase distance)
         const offset = new THREE.Vector3().subVectors(camera.position, orbitControls.target);
         const dist = offset.length();
         const newDist = Math.min(orbitControls.maxDistance, dist * (1 + fineZoomFactor));
         
         offset.setLength(newDist);
         camera.position.copy(orbitControls.target).add(offset);
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
