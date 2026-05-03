import React from "react";
import { useVehicleControlStore } from "@/store/ui/vehicleControlStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { VEHICLE_RENDER_SIZE } from "@/shmSimulator/MemoryLayoutManager";
import { getMarkerConfig } from "@/config/threejs/renderConfig";

// Threshold for selection in meters
const SELECTION_THRESHOLD_SQ = 20 * 20;

const VehicleSelector: React.FC = () => {
    const findNearestVehicle = (clickX: number, clickY: number) => {
        // SHM mode only - use render buffer (has fab offset applied)
        const actualNumVehicles = useShmSimulatorStore.getState().actualNumVehicles;
        const data = useShmSimulatorStore.getState().getVehicleData();

        if (actualNumVehicles === 0 || !data) return;

        let minDistSq = Infinity;
        let nearestRenderIndex = -1;

        // Render buffer layout: [x, y, z, rotation] per vehicle (4 floats)
        for (let i = 0; i < actualNumVehicles; i++) {
            const ptr = i * VEHICLE_RENDER_SIZE;
            const x = data[ptr + 0];
            const y = data[ptr + 1];

            if (x === undefined || y === undefined) {
                continue;
            }

            const dx = x - clickX;
            const dy = y - clickY;
            const distSq = dx * dx + dy * dy;

            if (distSq < minDistSq) {
                minDistSq = distSq;
                nearestRenderIndex = i;
            }
        }

        if (nearestRenderIndex !== -1 && minDistSq <= SELECTION_THRESHOLD_SQ) {
            // render index → fab-local 변환 후 store에 저장
            const controller = useShmSimulatorStore.getState().controller;
            const sel = controller?.renderIndexToFabLocal(nearestRenderIndex) ?? null;
            if (sel) {
                useVehicleControlStore.getState().selectVehicle(sel);
            }
        }
    };

    return (
        <mesh
            visible={false}
            rotation={[0,0,0]}
            position={[0,0,getMarkerConfig().Z]} // Vehicles are at Z height
            onClick={(e) => {
                e.stopPropagation();
                // Only allow selection if Ctrl is pressed
                if (!e.ctrlKey) return;
                findNearestVehicle(e.point.x, e.point.y);
            }}
        >
             <planeGeometry args={[10000, 10000]} />
             <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
    );
};

export default VehicleSelector;
