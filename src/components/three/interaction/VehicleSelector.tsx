import React from "react";
import { useVehicleControlStore } from "@/store/ui/vehicleControlStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import {
    VEHICLE_DATA_SIZE as SHM_VEHICLE_DATA_SIZE,
    MovementData as ShmMovementData,
} from "@/common/vehicle/memory/VehicleDataArrayBase";
import { getMarkerConfig } from "@/config/renderConfig";

// Threshold for selection in meters
const SELECTION_THRESHOLD_SQ = 20 * 20;

const VehicleSelector: React.FC = () => {
    // We don't strictly need useThree if we just use the mesh onClick event,
    // which provides the intersection point directly.

    const findNearestVehicle = (clickX: number, clickY: number) => {
        // SHM mode only
        const actualNumVehicles = useShmSimulatorStore.getState().actualNumVehicles;
        const data = useShmSimulatorStore.getState().getVehicleFullData();
        const dataSize = SHM_VEHICLE_DATA_SIZE;
        const xOffset = ShmMovementData.X;
        const yOffset = ShmMovementData.Y;

        if (actualNumVehicles === 0 || !data) return;

        let minDistSq = Infinity;
        let nearestVehicleId = -1;

        for (let i = 0; i < actualNumVehicles; i++) {
            const ptr = i * dataSize;
            const x = data[ptr + xOffset];
            const y = data[ptr + yOffset];

            if (x === undefined || y === undefined) {
                continue;
            }

            const dx = x - clickX;
            const dy = y - clickY;
            const distSq = dx * dx + dy * dy;

            if (distSq < minDistSq) {
                minDistSq = distSq;
                nearestVehicleId = i;
            }
        }

        if (nearestVehicleId !== -1 && minDistSq <= SELECTION_THRESHOLD_SQ) {
            useVehicleControlStore.getState().selectVehicle(nearestVehicleId);
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
