import React from "react";
import { useVehicleControlStore } from "@/store/ui/vehicleControlStore";
import { useMenuStore } from "@/store/ui/menuStore";
import { vehicleDataArray, MovementData, VEHICLE_DATA_SIZE } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";

// Threshold for selection in meters
const SELECTION_THRESHOLD_SQ = 20 * 20; 

const VehicleSelector: React.FC = () => {
    // We don't strictly need useThree if we just use the mesh onClick event, 
    // which provides the intersection point directly.

    const findNearestVehicle = (clickX: number, clickY: number) => {
        const actualNumVehicles = useVehicleArrayStore.getState().actualNumVehicles;
        if (actualNumVehicles === 0) return;

        const data = vehicleDataArray.getData();
        
        let minDistSq = Infinity;
        let nearestVehicleId = -1;

        for (let i = 0; i < actualNumVehicles; i++) {
            const ptr = i * VEHICLE_DATA_SIZE;
            const x = data[ptr + MovementData.X];
            const y = data[ptr + MovementData.Y];

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
            
             // Open menu
            const menuStore = useMenuStore.getState();
            menuStore.setActiveMainMenu('Vehicle');
            menuStore.setActiveSubMenu('vehicle-menu-individual');
            menuStore.setRightPanelOpen(true);
            
            console.log(`[VehicleSelector] Selected Vehicle #${nearestVehicleId} (Dist: ${Math.sqrt(minDistSq).toFixed(2)}m)`);
        }
    };

    return (
        <mesh 
            visible={false} 
            rotation={[0,0,0]} 
            position={[0,0,3.8]} // Vehicles are at Z=3.8
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
