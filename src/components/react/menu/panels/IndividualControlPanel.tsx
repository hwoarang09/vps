
import React, { useState, useEffect, useRef } from "react";
import { Search, Play, Pause, Settings, Octagon } from "lucide-react";
import { useVehicleGeneralStore } from "@/store/vehicle/vehicleGeneralStore";
import { useVehicleControlStore } from "@/store/ui/vehicleControlStore";
import { useMenuStore } from "@/store/ui/menuStore";
import { vehicleDataArray, MovingStatus, StopReason, TrafficState } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import {
    VEHICLE_DATA_SIZE as SHM_VEHICLE_DATA_SIZE,
    MovementData as ShmMovementData,
    SensorData as ShmSensorData,
    LogicData as ShmLogicData,
} from "@/common/vehicle/memory/VehicleDataArrayBase";
import { NEXT_EDGE_COUNT } from "@/common/vehicle/initialize/constants";
import type { Edge as FullEdge } from "@/types/edge";
import { EdgeType } from "@/types";
import { PresetIndex } from "@/store/vehicle/arrayMode/sensorPresets";
import { useEdgeStore } from "@/store/map/edgeStore";
import { sensorPointArray } from "@/store/vehicle/arrayMode/sensorPointArray";
import { MAX_PATH_LENGTH } from "@/common/vehicle/logic/TransferMgr";
import { getLockWaitDistanceFromMergingStr, getLockWaitDistanceFromMergingCurve } from "@/config/simulationConfig";

// Helper to decode StopReason bitmask
const getStopReasons = (reasonMask: number): string[] => {
    if (reasonMask === 0) return ["NONE"];
    const reasons: string[] = [];
    if (reasonMask & StopReason.OBS_LIDAR) reasons.push("LIDAR");
    if (reasonMask & StopReason.OBS_CAMERA) reasons.push("CAMERA");
    if (reasonMask & StopReason.E_STOP) reasons.push("E_STOP");
    if (reasonMask & StopReason.LOCKED) reasons.push("LOCKED");
    if (reasonMask & StopReason.DESTINATION_REACHED) reasons.push("DEST");
    if (reasonMask & StopReason.PATH_BLOCKED) reasons.push("BLOCKED");
    if (reasonMask & StopReason.LOAD_ON) reasons.push("LOADING");
    if (reasonMask & StopReason.LOAD_OFF) reasons.push("UNLOADING");
    if (reasonMask & StopReason.NOT_INITIALIZED) reasons.push("INIT");
    if (reasonMask & StopReason.INDIVIDUAL_CONTROL) reasons.push("MANUAL");
    if (reasonMask & StopReason.SENSORED) reasons.push("SENSOR");
    return reasons;
};

// Map for Traffic State
const TrafficStateMap: Record<number, string> = {
    [TrafficState.FREE]: "FREE",
    [TrafficState.WAITING]: "WAITING",
    [TrafficState.ACQUIRED]: "ACQUIRED",
};

// Map for Hit Zone
const HitZoneMap: Record<number, string> = {
    [-1]: "None",
    0: "Approach",
    1: "Brake",
    2: "Stop",
};

interface VehicleMonitorProps {
    vehicleIndex: number;
    // We pass vehiclesmap just for ID lookup, or we can look it up from store.
    // Passing it as prop prevents Monitor from subscribing to store updates directly if we want,
    // but Monitor depends on "vehicles" to look up ID.
    vehicles: Map<number, any>;
    isShmMode: boolean;
}

// Helper to read vehicle data from SHM buffer
const readShmVehicleData = (data: Float32Array, vehicleIndex: number) => {
    const ptr = vehicleIndex * SHM_VEHICLE_DATA_SIZE;

    // Read next edges array (5 entries)
    const nextEdges: number[] = [];
    for (let i = 0; i < NEXT_EDGE_COUNT; i++) {
        nextEdges.push(data[ptr + ShmMovementData.NEXT_EDGE_0 + i]);
    }

    return {
        movement: {
            movingStatus: data[ptr + ShmMovementData.MOVING_STATUS],
            velocity: data[ptr + ShmMovementData.VELOCITY],
            acceleration: data[ptr + ShmMovementData.ACCELERATION],
            deceleration: data[ptr + ShmMovementData.DECELERATION],
            currentEdge: data[ptr + ShmMovementData.CURRENT_EDGE],
            nextEdge: data[ptr + ShmMovementData.NEXT_EDGE_0],
            nextEdges,
            edgeRatio: data[ptr + ShmMovementData.EDGE_RATIO],
        },
        sensor: {
            presetIdx: data[ptr + ShmSensorData.PRESET_IDX],
            hitZone: data[ptr + ShmSensorData.HIT_ZONE],
            collisionTarget: data[ptr + ShmSensorData.COLLISION_TARGET],
        },
        logic: {
            trafficState: data[ptr + ShmLogicData.TRAFFIC_STATE],
            stopReason: data[ptr + ShmLogicData.STOP_REASON],
            destinationEdge: data[ptr + ShmLogicData.DESTINATION_EDGE],
            pathRemaining: data[ptr + ShmLogicData.PATH_REMAINING],
        },
    };
};

// Helper to find nearest merge wait point in next edges
interface MergeWaitInfo {
    waitNodeName: string;      // 대기 대상 노드 (곡선: fn, 직선: tn)
    mergeEdgeName: string;     // merge edge 이름
    distanceToWait: number;    // wait 지점까지의 거리
    edgeHops: number;
    isCurve: boolean;          // 곡선 여부
}

const findNearestMergeWait = (
    currentEdge: FullEdge,
    currentRatio: number,
    nextEdges: number[],
    edges: FullEdge[]
): MergeWaitInfo | null => {
    const waitDistanceStr = getLockWaitDistanceFromMergingStr();
    const waitDistanceCurve = getLockWaitDistanceFromMergingCurve();

    // Check current edge first
    let accumulatedDistance = currentEdge.distance * (1 - currentRatio);

    // If current edge's to_node is merge, return it
    if (currentEdge.toNodeIsMerge) {
        const isCurve = currentEdge.vos_rail_type !== EdgeType.LINEAR;
        const waitNode = isCurve ? currentEdge.from_node : currentEdge.to_node;
        // 현재 edge 안에 있으므로, 곡선이면 fn은 이미 지남
        const distanceToWait = isCurve
            ? Math.max(0, -waitDistanceCurve) // 이미 fn 지났으므로 음수가 될 수 있음
            : Math.max(0, accumulatedDistance - waitDistanceStr);
        return {
            waitNodeName: waitNode,
            mergeEdgeName: currentEdge.edge_name,
            distanceToWait,
            edgeHops: 0,
            isCurve,
        };
    }

    // Search through next edges (up to 5)
    for (let i = 0; i < nextEdges.length; i++) {
        const nextEdgeIdx = nextEdges[i];
        if (nextEdgeIdx < 0 || nextEdgeIdx >= edges.length) break;

        const nextEdge = edges[nextEdgeIdx];
        if (!nextEdge) break;

        if (nextEdge.toNodeIsMerge) {
            const isCurve = nextEdge.vos_rail_type !== EdgeType.LINEAR;
            // 곡선: fn(시작점)이 wait 대상, 직선: tn(끝점)이 wait 대상
            const waitNode = isCurve ? nextEdge.from_node : nextEdge.to_node;
            // 곡선: fn까지 거리 - waitDistanceCurve
            // 직선: tn까지 거리 - waitDistanceStr
            const distanceToWait = isCurve
                ? accumulatedDistance - waitDistanceCurve
                : accumulatedDistance + nextEdge.distance - waitDistanceStr;
            return {
                waitNodeName: waitNode,
                mergeEdgeName: nextEdge.edge_name,
                distanceToWait: Math.max(0, distanceToWait),
                edgeHops: i + 1,
                isCurve,
            };
        }

        accumulatedDistance += nextEdge.distance;
    }

    return null;
};

const VehicleMonitor: React.FC<VehicleMonitorProps> = ({ vehicleIndex, vehicles, isShmMode }) => {
    const [tick, setTick] = useState(0);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    // Poll for status updates
    useEffect(() => {
        intervalRef.current = setInterval(() => {
            setTick(t => t + 1);
        }, 100); // 10Hz update
        return () => {
             if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    const handleStop = () => {
        if (isShmMode) {
            // SHM mode: read-only (worker controls state)
            return;
        }
        vehicleDataArray.setMovingStatus(vehicleIndex, MovingStatus.STOPPED);
        const currentReason = vehicleDataArray.getStopReason(vehicleIndex);
        vehicleDataArray.setStopReason(vehicleIndex, currentReason | StopReason.INDIVIDUAL_CONTROL);
    };

    const handlePause = () => {
        if (isShmMode) {
            return;
        }
        vehicleDataArray.setMovingStatus(vehicleIndex, MovingStatus.PAUSED);
        const currentReason = vehicleDataArray.getStopReason(vehicleIndex);
        vehicleDataArray.setStopReason(vehicleIndex, currentReason | StopReason.INDIVIDUAL_CONTROL);
    };

    const handleResume = () => {
        if (isShmMode) {
            return;
        }
        vehicleDataArray.setMovingStatus(vehicleIndex, MovingStatus.MOVING);
        const currentReason = vehicleDataArray.getStopReason(vehicleIndex);
        // Clear E_STOP and INDIVIDUAL_CONTROL
        vehicleDataArray.setStopReason(vehicleIndex, currentReason & ~(StopReason.E_STOP | StopReason.INDIVIDUAL_CONTROL));
    };

    const handleChangeSensor = () => {
        if (isShmMode) {
            return;
        }
        const vehicleData = vehicleDataArray.get(vehicleIndex);
        const currentSensor = vehicleData.sensor.presetIdx;
        vehicleData.sensor.presetIdx = (currentSensor + 1) % 5;
    };

    const getCurrentSensorPreset = () => {
        if (isShmMode) {
            const data = useShmSimulatorStore.getState().getVehicleFullData();
            if (!data) return 0;
            return data[vehicleIndex * SHM_VEHICLE_DATA_SIZE + ShmSensorData.PRESET_IDX];
        }
        return vehicleDataArray.get(vehicleIndex).sensor.presetIdx;
    };

    // Force read data - choose data source based on mode
    let status: number, velocity: number, acceleration: number, deceleration: number;
    let sensorPreset: number, hitZone: number, trafficState: number, stopReasonMask: number;
    let currentEdgeIdx: number, currentEdgeRatio: number, nextEdgeIdx: number, collisionTarget: number;
    let destinationEdgeIdx: number | undefined, pathRemaining: number | undefined;
    let nextEdges: number[] = [];

    if (isShmMode) {
        const data = useShmSimulatorStore.getState().getVehicleFullData();
        if (!data) {
            return <div className="text-gray-500">No SHM data available</div>;
        }
        const vData = readShmVehicleData(data, vehicleIndex);
        status = vData.movement.movingStatus;
        velocity = vData.movement.velocity;
        acceleration = vData.movement.acceleration;
        deceleration = vData.movement.deceleration;
        sensorPreset = vData.sensor.presetIdx;
        hitZone = vData.sensor.hitZone;
        trafficState = vData.logic.trafficState;
        stopReasonMask = vData.logic.stopReason;
        currentEdgeIdx = vData.movement.currentEdge;
        currentEdgeRatio = vData.movement.edgeRatio;
        nextEdgeIdx = vData.movement.nextEdge;
        nextEdges = vData.movement.nextEdges;
        collisionTarget = vData.sensor.collisionTarget;
        destinationEdgeIdx = vData.logic.destinationEdge;
        pathRemaining = vData.logic.pathRemaining;
    } else {
        const vData = vehicleDataArray.get(vehicleIndex);
        status = vData.movement.movingStatus;
        velocity = vData.movement.velocity;
        acceleration = vData.movement.acceleration;
        deceleration = vData.movement.deceleration;
        sensorPreset = vData.sensor.presetIdx;
        hitZone = vData.sensor.hitZone;
        trafficState = vData.logic.trafficState;
        stopReasonMask = vData.logic.stopReason;
        currentEdgeIdx = vData.movement.currentEdge;
        currentEdgeRatio = vData.movement.edgeRatio;
        nextEdgeIdx = vData.movement.nextEdge;
        collisionTarget = vData.sensor.collisionTarget;
        // For non-SHM mode, we'd need to get next edges from vehicleDataArray if available
        // For now, leave it empty - the feature is mainly for SHM mode
    }
    
    const vehicleInfo = vehicles.get(vehicleIndex);
    // Generate ID from index if not in vehicles map (e.g., SHM mode)
    const vehicleId = vehicleInfo?.id || `VEH${String(vehicleIndex).padStart(5, '0')}`;
    const stopReasons = getStopReasons(stopReasonMask);

    // Debug Info: Self
    const currentEdgeName = useEdgeStore.getState().getEdgeByIndex(currentEdgeIdx)?.edge_name || "Unknown";
    const nextEdgeName = nextEdgeIdx !== -1
        ? (useEdgeStore.getState().getEdgeByIndex(nextEdgeIdx)?.edge_name || "Unknown")
        : "None";

    const destinationEdgeName = destinationEdgeIdx !== undefined && destinationEdgeIdx !== -1
        ? (useEdgeStore.getState().getEdgeByIndex(destinationEdgeIdx)?.edge_name || "Unknown")
        : "None";

    // Debug Info: Target
    let targetEdgeInfo = "N/A";
    let targetRatioInfo = "N/A";

    if (collisionTarget !== -1) {
        if (isShmMode) {
            const data = useShmSimulatorStore.getState().getVehicleFullData();
            const actualNumVehicles = useShmSimulatorStore.getState().actualNumVehicles;

            // Validate collision target is within valid range
            if (data && collisionTarget >= 0 && collisionTarget < actualNumVehicles) {
                const tData = readShmVehicleData(data, collisionTarget);
                const tEdgeIdx = tData.movement.currentEdge;
                const tEdgeRatio = tData.movement.edgeRatio;
                const tEdgeName = useEdgeStore.getState().getEdgeByIndex(tEdgeIdx)?.edge_name || "Unknown";
                targetEdgeInfo = `${tEdgeName} (#${tEdgeIdx})`;
                targetRatioInfo = tEdgeRatio !== undefined ? tEdgeRatio.toFixed(3) : "N/A";
            }
        } else {
            const actualNumVehicles = useVehicleArrayStore.getState().actualNumVehicles;

            // Validate collision target is within valid range
            if (collisionTarget >= 0 && collisionTarget < actualNumVehicles) {
                const tData = vehicleDataArray.get(collisionTarget);
                const tEdgeIdx = tData.movement.currentEdge;
                const tEdgeRatio = tData.movement.edgeRatio;
                const tEdgeName = useEdgeStore.getState().getEdgeByIndex(tEdgeIdx)?.edge_name || "Unknown";
                targetEdgeInfo = `${tEdgeName} (#${tEdgeIdx})`;
                targetRatioInfo = tEdgeRatio !== undefined ? tEdgeRatio.toFixed(3) : "N/A";
            }
        }
    }

    // Sensor Points (All 3 Zones) - only available in array mode
    const zones = [0, 1, 2];
    const zonePoints = isShmMode ? null : zones.map(z => ({
        name: ["Approach", "Brake", "Stop"][z],
        pts: sensorPointArray.getPoints(vehicleIndex, z)
    }));

    // Find nearest merge node (SHM mode only for now)
    // Cast to FullEdge to access topology properties (toNodeIsMerge, etc.)
    const edges = useEdgeStore.getState().edges as FullEdge[];
    const currentEdge = edges[currentEdgeIdx];
    const mergeWaitInfo = currentEdge && nextEdges.length > 0
        ? findNearestMergeWait(currentEdge, currentEdgeRatio, nextEdges, edges)
        : null;

    // Get next edges info for display
    const nextEdgesInfo = nextEdges.map((edgeIdx, i) => {
        if (edgeIdx < 0) return null;
        const edge = edges[edgeIdx];
        return edge ? { index: i, edgeIdx, name: edge.edge_name, toNode: edge.to_node, isMerge: edge.toNodeIsMerge ?? false } : null;
    }).filter(Boolean);

    return (
        <div className="space-y-6">
             {/* Control Area */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">Controls</label>
                <div className="grid grid-cols-4 gap-2">
                    <button
                        onClick={handleStop}
                        className="flex flex-col items-center justify-center p-3 border border-red-200 bg-red-50 text-red-700 rounded hover:bg-red-100 transition-colors"
                    >
                        <Octagon size={24} className="mb-1 fill-red-100" />
                        <span className="text-xs font-medium">Stop</span>
                    </button>
                    <button
                        onClick={handlePause}
                        className="flex flex-col items-center justify-center p-3 border border-orange-200 bg-orange-50 text-orange-700 rounded hover:bg-orange-100 transition-colors"
                    >
                        <Pause size={24} className="mb-1" />
                        <span className="text-xs font-medium">Pause</span>
                    </button>
                    <button
                        onClick={handleResume}
                        className="flex flex-col items-center justify-center p-3 border border-green-200 bg-green-50 text-green-700 rounded hover:bg-green-100 transition-colors"
                    >
                        <Play size={24} className="mb-1" />
                        <span className="text-xs font-medium">Resume</span>
                    </button>
                    
                    <button
                        onClick={handleChangeSensor}
                        className="flex flex-col items-center justify-center p-3 border border-blue-200 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors"
                    >
                            <Settings size={24} className="mb-1" />
                            <span className="text-[10px] font-medium leading-tight text-center px-1">
                            {Object.keys(PresetIndex).find(key => PresetIndex[key as keyof typeof PresetIndex] === getCurrentSensorPreset()) || "SENSOR"}
                            </span>
                    </button>
                </div>
            </div>

            {/* Status Area */}
            <div className="mt-4 p-4 border border-gray-200 rounded bg-gray-50">
                <div className="flex justify-between items-center mb-2">
                        <h4 className="font-semibold">Vehicle Status</h4>
                        <span className="text-xs text-gray-400 font-mono">Tick: {tick % 100}</span>
                </div>
                
                <div className="space-y-1 text-sm bg-white p-2 rounded border border-gray-100">
                    <div className="flex justify-between border-b border-gray-100 pb-1 mb-1">
                        <span className="text-gray-500">ID / Index</span>
                        <span className="font-mono font-bold">{vehicleId} <span className="text-gray-400 text-xs">#{vehicleIndex}</span></span>
                    </div>

                    <div className="flex justify-between">
                        <span>Status</span>
                        <span className={`font-mono font-bold ${status === MovingStatus.MOVING ? "text-green-600" : status === MovingStatus.PAUSED ? "text-orange-600" : "text-red-600"}`}>
                            {status === MovingStatus.MOVING ? "MOVING" : status === MovingStatus.PAUSED ? "PAUSED" : "STOPPED"}
                        </span>
                    </div>

                    <div className="flex justify-between">
                        <span>Velocity</span>
                        <span className="font-mono">{velocity.toFixed(3)} m/s</span>
                    </div>
                    
                    <div className="flex justify-between text-xs text-gray-600">
                        <span>Acc / Dec</span>
                        <span className="font-mono">{acceleration.toFixed(2)} / {deceleration.toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between text-xs text-blue-600 font-medium mt-1">
                        <span>Cur Edge</span>
                        <span className="font-mono">{currentEdgeName} (#{currentEdgeIdx})</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                         <span>Next Edge</span>
                         <span className="font-mono">{nextEdgeName} {nextEdgeIdx !== -1 ? `(#${nextEdgeIdx})` : ""}</span>
                    </div>

                    {isShmMode && destinationEdgeName !== "None" && (
                        <div className="flex justify-between text-xs text-purple-600 font-medium mt-1">
                            <span>Destination</span>
                            <span className="font-mono">{destinationEdgeName} (Hops: {pathRemaining?.toFixed(0)})</span>
                        </div>
                    )}

                    {/* Path Display */}
                    {isShmMode && (() => {
                        const pathData = useShmSimulatorStore.getState().getPathData();
                        if (!pathData) return null;

                        const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
                        const currentIdx = pathData[pathPtr + 0];
                        const totalLen = pathData[pathPtr + 1];

                        if (totalLen === 0 || currentIdx >= totalLen) return null;

                        const remainingPath: { edgeIdx: number; edgeName: string }[] = [];
                        for (let i = currentIdx; i < totalLen && i < currentIdx + 10; i++) {
                            const edgeIdx = pathData[pathPtr + 2 + i];
                            if (edgeIdx >= 0) {
                                const edge = useEdgeStore.getState().getEdgeByIndex(edgeIdx);
                                remainingPath.push({
                                    edgeIdx,
                                    edgeName: edge?.edge_name || `Edge#${edgeIdx}`
                                });
                            }
                        }

                        if (remainingPath.length === 0) return null;

                        return (
                            <details className="text-xs mt-2">
                                <summary className="cursor-pointer text-purple-700 font-medium hover:text-purple-900">
                                    Path ({remainingPath.length}{totalLen - currentIdx > 10 ? `+${totalLen - currentIdx - 10}` : ''} edges)
                                </summary>
                                <div className="mt-1 pl-2 space-y-0.5 max-h-32 overflow-y-auto text-gray-600">
                                    {remainingPath.map((item, idx) => (
                                        <div key={idx} className="flex justify-between font-mono">
                                            <span>{idx + 1}.</span>
                                            <span>{item.edgeName}</span>
                                            <span className="text-gray-400">#{item.edgeIdx}</span>
                                        </div>
                                    ))}
                                    {totalLen - currentIdx > 10 && (
                                        <div className="text-gray-400 text-center">... +{totalLen - currentIdx - 10} more</div>
                                    )}
                                </div>
                            </details>
                        );
                    })()}

                    {/* Next Edges & Merge Node Info (SHM mode) */}
                    {isShmMode && nextEdgesInfo.length > 0 && (
                        <details className="text-xs mt-2" open>
                            <summary className="cursor-pointer text-cyan-700 font-medium hover:text-cyan-900">
                                Next Edges ({nextEdgesInfo.length}/5)
                            </summary>
                            <div className="mt-1 pl-2 space-y-0.5 text-gray-600">
                                {nextEdgesInfo.map((item) => (
                                    item && (
                                        <div key={item.index} className={`flex justify-between font-mono ${item.isMerge ? 'text-orange-600 font-bold' : ''}`}>
                                            <span>{item.index + 1}.</span>
                                            <span>{item.name}</span>
                                            <span className="text-gray-400">
                                                #{item.edgeIdx}
                                                {item.isMerge && <span className="ml-1 text-orange-500">[M]</span>}
                                            </span>
                                        </div>
                                    )
                                ))}
                            </div>
                        </details>
                    )}

                    {/* Merge Wait Point Alert */}
                    {isShmMode && mergeWaitInfo && (
                        <div className="mt-2 p-2 bg-orange-50 rounded border border-orange-200 text-xs">
                            <div className="flex justify-between font-bold text-orange-800 mb-1">
                                <span>Merge Wait Point</span>
                                <span>{mergeWaitInfo.waitNodeName} ({mergeWaitInfo.isCurve ? 'Curve' : 'Str'})</span>
                            </div>
                            <div className="flex justify-between text-orange-700">
                                <span>Distance to Wait:</span>
                                <span className="font-mono font-bold">{mergeWaitInfo.distanceToWait.toFixed(2)} m</span>
                            </div>
                            <div className="flex justify-between text-orange-600">
                                <span>Via Edge:</span>
                                <span className="font-mono">{mergeWaitInfo.mergeEdgeName}</span>
                            </div>
                            <div className="flex justify-between text-orange-600">
                                <span>Hops:</span>
                                <span className="font-mono">{mergeWaitInfo.edgeHops === 0 ? 'Current' : mergeWaitInfo.edgeHops}</span>
                            </div>
                        </div>
                    )}

                    <div className="my-2 border-t border-gray-200"></div>

                    <div className="flex justify-between">
                        <span>Sensor Preset</span>
                        <span className="font-mono">{Object.keys(PresetIndex).find(key => PresetIndex[key as keyof typeof PresetIndex] === sensorPreset) || sensorPreset}</span>
                    </div>

                    <div className="flex justify-between">
                        <span>Hit Zone</span>
                            <span className={`font-mono font-bold ${hitZone > 0 ? "text-red-600" : "text-gray-600"}`}>
                            {HitZoneMap[Math.round(hitZone)] || hitZone} ({hitZone.toFixed(0)})
                        </span>
                    </div>

                    {collisionTarget !== -1 && (
                        <div className="mt-2 p-2 bg-red-50 rounded border border-red-100 text-xs text-red-800">
                             <div className="flex justify-between font-bold mb-1">
                                <span>Collision Target:</span>
                                <span>VEH{collisionTarget.toString().padStart(5, '0')} (#{collisionTarget})</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Target Loc:</span>
                                <span className="font-mono">{targetEdgeInfo} : {targetRatioInfo}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">My Loc:</span>
                                <span className="font-mono">{currentEdgeName} (#{currentEdgeIdx}) : {currentEdgeRatio.toFixed(3)}</span>
                            </div>
                        </div>
                    )}

                    <div className="my-2 border-t border-gray-200"></div>

                    {zonePoints && (
                    <div className="space-y-2">
                        <details className="group">
                             <summary className="font-semibold text-xs text-gray-500 cursor-pointer list-none flex items-center gap-1 select-none">
                                <span className="group-open:rotate-90 transition-transform">▸</span>
                                Sensor Points (World)
                            </summary>
                            <div className="text-[10px] space-y-2 mt-2 pl-2">
                                {/* Common Body */}
                                <div className="grid grid-cols-2 gap-1 bg-gray-50 p-1 rounded">
                                    <span className="font-bold col-span-2">Body Quad</span>
                                    <span>FL: {zonePoints[0].pts.fl[0].toFixed(2)}, {zonePoints[0].pts.fl[1].toFixed(2)}</span>
                                    <span>FR: {zonePoints[0].pts.fr[0].toFixed(2)}, {zonePoints[0].pts.fr[1].toFixed(2)}</span>
                                    <span>BL: {zonePoints[0].pts.bl[0].toFixed(2)}, {zonePoints[0].pts.bl[1].toFixed(2)}</span>
                                    <span>BR: {zonePoints[0].pts.br[0].toFixed(2)}, {zonePoints[0].pts.br[1].toFixed(2)}</span>
                                </div>

                                {/* Zones */}
                                {zonePoints.map((z, idx) => (
                                    <div key={idx} className="bg-gray-50 p-1 rounded border border-gray-100">
                                        <div className="font-bold mb-1">{z.name} (SL/SR)</div>
                                        <div className="grid grid-cols-1 gap-1">
                                            <span>SL: {z.pts.sl[0].toFixed(2)}, {z.pts.sl[1].toFixed(2)}</span>
                                            <span>SR: {z.pts.sr[0].toFixed(2)}, {z.pts.sr[1].toFixed(2)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </details>
                    </div>
                    )}

                    <div className="my-2 border-t border-gray-200"></div>

                    <div className="flex justify-between">
                        <span>Traffic State</span>
                            <span className={`font-mono ${trafficState === TrafficState.WAITING ? "text-orange-600 animate-pulse" : "text-blue-600"}`}>
                            {TrafficStateMap[trafficState] || trafficState}
                        </span>
                    </div>

                        <div className="flex flex-col mt-1">
                        <span className="mb-1 text-gray-500">Stop Reasons:</span>
                        <div className="flex flex-wrap gap-1">
                            {stopReasons.map(r => (
                                <span key={r} className={`px-1.5 py-0.5 text-[10px] rounded border ${r === "NONE" ? "bg-gray-100 text-gray-500 border-gray-200" : "bg-red-50 text-red-700 border-red-200 font-bold"}`}>
                                    {r}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

const IndividualControlPanel: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState("");
    const [foundVehicleIndex, setFoundVehicleIndex] = useState<number | null>(null);
    const vehicles = useVehicleGeneralStore((state) => state.vehicles);
    const selectedVehicleId = useVehicleControlStore((state) => state.selectedVehicleId);
    const activeSubMenu = useMenuStore((state) => state.activeSubMenu);

    // Detect SHM mode based on active submenu
    const isShmMode = activeSubMenu === "test-shared-memory";

    // Keep a ref to vehicles to access latest state in debounce without triggering re-runs
    const vehiclesRef = useRef(vehicles);
    vehiclesRef.current = vehicles;

    // Helper to find vehicle index by ID string
    // Optimization based on user feedback: ID is strictly sequential (VEH001 -> Index 0)
    const handleSearch = () => {
        if (!searchTerm) {
            setFoundVehicleIndex(null);
            return;
        }

        let found = -1;
        
        // Direct Index Mapping
        const match = searchTerm.match(/(\d+)/);
        if (match) {
            const idNum = Number.parseInt(match[0], 10);
            const targetIdx = idNum; // ID corresponds to index directly (VEH00001 -> Index 1)

            const v = vehiclesRef.current.get(targetIdx);
            
            // If the vehicle exists at that index, we consider it found.
            // We relaxed the check so "1" finds "VEH00001"
            if (v) {
                found = targetIdx;
            }
        }

        if (found >= 0) {
            setFoundVehicleIndex(found);
            // Optionally sync back to store? Maybe not needed if this panel is the "driver"
            // useVehicleControlStore.getState().selectVehicle(found); 
        } else {
            setFoundVehicleIndex(null);
            alert("Vehicle not found");
        }
    };

    // Effect to sync from store selection to this panel
    useEffect(() => {
        if (selectedVehicleId !== null) {
            setFoundVehicleIndex(selectedVehicleId);
            setSearchTerm(`VEH${String(selectedVehicleId).padStart(5, '0')}`);
        }
    }, [selectedVehicleId]);

    return (
        <div className="space-y-6">
            {/* Search Area */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Search Vehicle (Enter ID)</label>
                <div className="relative">
                    <input
                        type="text"
                        placeholder="ID (e.g. VEH00001)"
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    />
                    <Search className="absolute left-3 top-2.5 text-gray-400" size={20} />
                </div>
            </div>

            {/* Monitor Area - Isolated Re-renders */}
            {foundVehicleIndex !== null && (
                <VehicleMonitor
                    vehicleIndex={foundVehicleIndex}
                    vehicles={vehicles}
                    isShmMode={isShmMode}
                />
            )}
        </div>
    );
};

export default IndividualControlPanel;
