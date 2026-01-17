import React from "react";
import { useVehicleControlStore } from "@/store/ui/vehicleControlStore";
import { useMenuStore } from "@/store/ui/menuStore";
import { vehicleDataArray, MovementData, VEHICLE_DATA_SIZE } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
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
        // Detect mode from activeSubMenu in store
        const activeSubMenu = useMenuStore.getState().activeSubMenu;
        const isShmMode = activeSubMenu === "test-shared-memory";

        let actualNumVehicles: number;
        let data: Float32Array | null;
        let dataSize: number;
        let xOffset: number;
        let yOffset: number;

        if (isShmMode) {
            // SHM mode: use shmSimulatorStore - use FULL data (22 floats per vehicle)
            actualNumVehicles = useShmSimulatorStore.getState().actualNumVehicles;
            data = useShmSimulatorStore.getState().getVehicleFullData();
            dataSize = SHM_VEHICLE_DATA_SIZE;
            xOffset = ShmMovementData.X;
            yOffset = ShmMovementData.Y;
        } else {
            // Array mode: use vehicleArrayStore
            actualNumVehicles = useVehicleArrayStore.getState().actualNumVehicles;
            data = vehicleDataArray.getData();
            dataSize = VEHICLE_DATA_SIZE;
            xOffset = MovementData.X;
            yOffset = MovementData.Y;
        }

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
             // Select the vehicle
            useVehicleControlStore.getState().selectVehicle(nearestVehicleId);

             // Open right panel only (don't change activeSubMenu to avoid unmounting VehicleTest)
            const menuStore = useMenuStore.getState();
            menuStore.setRightPanelOpen(true);

            console.log(`[VehicleSelector] Selected Vehicle #${nearestVehicleId} (Dist: ${Math.sqrt(minDistSq).toFixed(2)}m)`);
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
