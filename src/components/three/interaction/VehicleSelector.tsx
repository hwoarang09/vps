import React from "react";
import { useVehicleControlStore } from "@/store/ui/vehicleControlStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { VEHICLE_RENDER_SIZE } from "@/shmSimulator/MemoryLayoutManager";
import { VEHICLE_DATA_SIZE } from "@/common/vehicle/memory/VehicleDataArrayBase";
import { getMarkerConfig } from "@/config/renderConfig";

// Threshold for selection in meters
const SELECTION_THRESHOLD_SQ = 20 * 20;

const VehicleSelector: React.FC = () => {
    /**
     * Convert render buffer index to worker buffer index
     *
     * Render buffer: fab별 actualVehicles 연속 (예: fab0 1000대 + fab1 1000대)
     * Worker buffer: fab별 maxVehicles 연속 (예: fab0 5000칸 + fab1 5000칸)
     */
    const convertRenderToWorkerIndex = (renderIndex: number): number => {
        const controller = useShmSimulatorStore.getState().controller;
        if (!controller) return renderIndex;

        const renderLayout = controller.getRenderLayout();
        const workerLayout = controller.getWorkerLayout();
        if (!renderLayout || !workerLayout) return renderIndex;

        const { fabRenderAssignments } = renderLayout;
        const { fabAssignments } = workerLayout;

        // 1. renderIndex가 어떤 fab에 속하는지 찾기
        let targetFabId: string | null = null;
        let localIndex = 0;

        for (const assignment of fabRenderAssignments) {
            const startIndex = assignment.vehicleRenderOffset / (VEHICLE_RENDER_SIZE * Float32Array.BYTES_PER_ELEMENT);
            const endIndex = startIndex + assignment.actualVehicles;

            if (renderIndex >= startIndex && renderIndex < endIndex) {
                targetFabId = assignment.fabId;
                localIndex = renderIndex - startIndex;
                break;
            }
        }

        if (!targetFabId) return renderIndex;

        // 2. Worker buffer에서 해당 fab의 offset 찾기
        const workerAssignment = fabAssignments.get(targetFabId);
        if (!workerAssignment) return renderIndex;

        // Worker offset은 bytes 단위, index로 변환
        const workerStartIndex = workerAssignment.vehicleRegion.offset / (VEHICLE_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT);

        return workerStartIndex + localIndex;
    };

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
            // Convert render index to worker index for IndividualControlPanel
            const workerIndex = convertRenderToWorkerIndex(nearestRenderIndex);
            useVehicleControlStore.getState().selectVehicle(workerIndex);
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
