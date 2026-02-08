import React, { useState, useEffect, useRef } from "react";
import { Search, Play, Pause, Settings, Octagon, Video, VideoOff } from "lucide-react";
import { useCameraStore } from "@/store/ui/cameraStore";
import { useVehicleGeneralStore } from "@/store/vehicle/vehicleGeneralStore";
import { useVehicleControlStore } from "@/store/ui/vehicleControlStore";
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
import { MAX_PATH_LENGTH, PATH_LEN, PATH_EDGES_START } from "@/common/vehicle/logic/TransferMgr";
import { getLockWaitDistanceFromMergingStr, getLockWaitDistanceFromMergingCurve } from "@/config/simulationConfig";
import {
    panelInputVariants,
    panelCardVariants,
    panelTextVariants,
    panelButtonVariants,
} from "../shared/panelStyles";
import { twMerge } from "tailwind-merge";

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
    vehicles: Map<number, any>;
    isShmMode: boolean;
}

// Helper to read vehicle data from SHM buffer
const readShmVehicleData = (data: Float32Array, vehicleIndex: number) => {
    const ptr = vehicleIndex * SHM_VEHICLE_DATA_SIZE;

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

// Helper to find nearest merge wait point
interface MergeWaitInfo {
    waitNodeName: string;
    mergeEdgeName: string;
    distanceToWait: number;
    edgeHops: number;
    isCurve: boolean;
}

const findNearestMergeWait = (
    currentEdge: FullEdge,
    currentRatio: number,
    nextEdges: number[],
    edges: FullEdge[]
): MergeWaitInfo | null => {
    const waitDistanceStr = getLockWaitDistanceFromMergingStr();
    const waitDistanceCurve = getLockWaitDistanceFromMergingCurve();

    let accumulatedDistance = currentEdge.distance * (1 - currentRatio);

    if (currentEdge.toNodeIsMerge) {
        const isCurve = currentEdge.vos_rail_type !== EdgeType.LINEAR;
        const distanceToWait = isCurve
            ? Math.max(0, -waitDistanceCurve)
            : Math.max(0, accumulatedDistance - waitDistanceStr);
        return {
            waitNodeName: currentEdge.to_node,
            mergeEdgeName: currentEdge.edge_name,
            distanceToWait,
            edgeHops: 0,
            isCurve,
        };
    }

    for (let i = 0; i < nextEdges.length; i++) {
        const nextEdgeIdx = nextEdges[i];
        if (nextEdgeIdx < 1 || nextEdgeIdx > edges.length) break;

        const nextEdge = edges[nextEdgeIdx - 1];
        if (!nextEdge) break;

        if (nextEdge.toNodeIsMerge) {
            const isCurve = nextEdge.vos_rail_type !== EdgeType.LINEAR;
            const distanceToWait = isCurve
                ? accumulatedDistance - waitDistanceCurve
                : accumulatedDistance + nextEdge.distance - waitDistanceStr;
            return {
                waitNodeName: nextEdge.to_node,
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

    const followingVehicleId = useCameraStore((state) => state.followingVehicleId);
    const followVehicle = useCameraStore((state) => state.followVehicle);
    const stopFollowingVehicle = useCameraStore((state) => state.stopFollowingVehicle);
    const isFollowing = followingVehicleId === vehicleIndex;

    useEffect(() => {
        intervalRef.current = setInterval(() => {
            setTick(t => t + 1);
        }, 100);
        return () => {
             if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    const handleStop = () => {
        if (isShmMode) return;
        vehicleDataArray.setMovingStatus(vehicleIndex, MovingStatus.STOPPED);
        const currentReason = vehicleDataArray.getStopReason(vehicleIndex);
        vehicleDataArray.setStopReason(vehicleIndex, currentReason | StopReason.INDIVIDUAL_CONTROL);
    };

    const handlePause = () => {
        if (isShmMode) return;
        vehicleDataArray.setMovingStatus(vehicleIndex, MovingStatus.PAUSED);
        const currentReason = vehicleDataArray.getStopReason(vehicleIndex);
        vehicleDataArray.setStopReason(vehicleIndex, currentReason | StopReason.INDIVIDUAL_CONTROL);
    };

    const handleResume = () => {
        if (isShmMode) return;
        vehicleDataArray.setMovingStatus(vehicleIndex, MovingStatus.MOVING);
        const currentReason = vehicleDataArray.getStopReason(vehicleIndex);
        vehicleDataArray.setStopReason(vehicleIndex, currentReason & ~(StopReason.E_STOP | StopReason.INDIVIDUAL_CONTROL));
    };

    const handleChangeSensor = () => {
        if (isShmMode) return;
        const vehicleData = vehicleDataArray.get(vehicleIndex);
        const currentSensor = vehicleData.sensor.presetIdx;
        vehicleData.sensor.presetIdx = (currentSensor + 1) % 5;
    };

    const handleToggleFollow = () => {
        if (isFollowing) {
            stopFollowingVehicle();
        } else {
            followVehicle(vehicleIndex);
        }
    };

    const getCurrentSensorPreset = () => {
        if (isShmMode) {
            const data = useShmSimulatorStore.getState().getVehicleFullData();
            if (!data) return 0;
            return data[vehicleIndex * SHM_VEHICLE_DATA_SIZE + ShmSensorData.PRESET_IDX];
        }
        return vehicleDataArray.get(vehicleIndex).sensor.presetIdx;
    };

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
    }

    const vehicleInfo = vehicles.get(vehicleIndex);
    const vehicleId = vehicleInfo?.id || `VEH${String(vehicleIndex).padStart(5, '0')}`;
    const stopReasons = getStopReasons(stopReasonMask);

    const currentEdgeName = useEdgeStore.getState().getEdgeByIndex(currentEdgeIdx)?.edge_name || "Unknown";
    const nextEdgeName = nextEdgeIdx !== -1
        ? (useEdgeStore.getState().getEdgeByIndex(nextEdgeIdx)?.edge_name || "Unknown")
        : "None";

    const destinationEdgeName = destinationEdgeIdx !== undefined && destinationEdgeIdx !== -1
        ? (useEdgeStore.getState().getEdgeByIndex(destinationEdgeIdx)?.edge_name || "Unknown")
        : "None";

    let targetEdgeInfo = "N/A";
    let targetRatioInfo = "N/A";

    if (collisionTarget !== -1) {
        if (isShmMode) {
            const data = useShmSimulatorStore.getState().getVehicleFullData();
            const actualNumVehicles = useShmSimulatorStore.getState().actualNumVehicles;

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

    const zones = [0, 1, 2];
    const zonePoints = isShmMode ? null : zones.map(z => ({
        name: ["Approach", "Brake", "Stop"][z],
        pts: sensorPointArray.getPoints(vehicleIndex, z)
    }));

    const edges = useEdgeStore.getState().edges as FullEdge[];
    const currentEdge = currentEdgeIdx >= 1 ? edges[currentEdgeIdx - 1] : undefined;
    const mergeWaitInfo = currentEdge && nextEdges.length > 0
        ? findNearestMergeWait(currentEdge, currentEdgeRatio, nextEdges, edges)
        : null;

    const nextEdgesInfo = nextEdges.map((edgeIdx, i) => {
        if (edgeIdx < 1) return null;
        const edge = edges[edgeIdx - 1];
        return edge ? { index: i, edgeIdx, name: edge.edge_name, toNode: edge.to_node, isMerge: edge.toNodeIsMerge ?? false } : null;
    }).filter(Boolean);

    // Control button style helper
    const controlBtnClass = (color: string, isActive = false) => twMerge(
        "flex flex-col items-center justify-center p-2 rounded transition-colors",
        `border border-${color}-500/50 bg-${color}-500/20 text-${color}-400 hover:bg-${color}-500/30`,
        isActive && `border-${color}-400 bg-${color}-500/40`
    );

    return (
        <div className="space-y-4">
            {/* Control Area */}
            <div className="grid grid-cols-5 gap-2">
                <button
                    onClick={handleStop}
                    className="flex flex-col items-center justify-center p-2 border border-red-500/50 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
                >
                    <Octagon size={20} className="mb-1" />
                    <span className="text-[10px] font-medium">Stop</span>
                </button>
                <button
                    onClick={handlePause}
                    className="flex flex-col items-center justify-center p-2 border border-orange-500/50 bg-orange-500/20 text-orange-400 rounded hover:bg-orange-500/30 transition-colors"
                >
                    <Pause size={20} className="mb-1" />
                    <span className="text-[10px] font-medium">Pause</span>
                </button>
                <button
                    onClick={handleResume}
                    className="flex flex-col items-center justify-center p-2 border border-green-500/50 bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 transition-colors"
                >
                    <Play size={20} className="mb-1" />
                    <span className="text-[10px] font-medium">Resume</span>
                </button>
                <button
                    onClick={handleToggleFollow}
                    className={twMerge(
                        "flex flex-col items-center justify-center p-2 border rounded transition-colors",
                        isFollowing
                            ? "border-purple-400 bg-purple-500/40 text-purple-300"
                            : "border-purple-500/50 bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
                    )}
                >
                    {isFollowing ? <Video size={20} className="mb-1" /> : <VideoOff size={20} className="mb-1" />}
                    <span className="text-[10px] font-medium">{isFollowing ? "Following" : "Follow"}</span>
                </button>
                <button
                    onClick={handleChangeSensor}
                    className="flex flex-col items-center justify-center p-2 border border-blue-500/50 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 transition-colors"
                >
                    <Settings size={20} className="mb-1" />
                    <span className="text-[10px] font-medium leading-tight text-center">
                        {Object.keys(PresetIndex).find(key => PresetIndex[key as keyof typeof PresetIndex] === getCurrentSensorPreset()) || "SENSOR"}
                    </span>
                </button>
            </div>

            {/* Status Area */}
            <div className={panelCardVariants({ variant: "glow-orange", padding: "md" })}>
                <div className="flex justify-between items-center mb-2">
                    <h4 className="font-semibold text-white">Vehicle Status</h4>
                    <span className="text-xs text-gray-500 font-mono">Tick: {tick % 100}</span>
                </div>

                <div className="space-y-1 text-sm bg-panel-bg-solid p-2 rounded border border-panel-border">
                    <div className="flex justify-between border-b border-panel-border pb-1 mb-1">
                        <span className="text-gray-400">ID / Index</span>
                        <span className="font-mono font-bold text-white">{vehicleId} <span className="text-gray-500 text-xs">#{vehicleIndex}</span></span>
                    </div>

                    <div className="flex justify-between">
                        <span className="text-gray-400">Status</span>
                        <span className={`font-mono font-bold ${status === MovingStatus.MOVING ? "text-green-400" : status === MovingStatus.PAUSED ? "text-orange-400" : "text-red-400"}`}>
                            {status === MovingStatus.MOVING ? "MOVING" : status === MovingStatus.PAUSED ? "PAUSED" : "STOPPED"}
                        </span>
                    </div>

                    <div className="flex justify-between">
                        <span className="text-gray-400">Velocity</span>
                        <span className="font-mono text-white">{velocity.toFixed(3)} m/s</span>
                    </div>

                    <div className="flex justify-between text-xs text-gray-500">
                        <span>Acc / Dec</span>
                        <span className="font-mono">{acceleration.toFixed(2)} / {deceleration.toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between text-xs text-accent-cyan font-medium mt-1">
                        <span>Cur Edge</span>
                        <span className="font-mono">{currentEdgeName} (#{currentEdgeIdx})</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                         <span>Next Edge</span>
                         <span className="font-mono">{nextEdgeName} {nextEdgeIdx !== -1 ? `(#${nextEdgeIdx})` : ""}</span>
                    </div>

                    {isShmMode && destinationEdgeName !== "None" && (
                        <div className="flex justify-between text-xs text-purple-400 font-medium mt-1">
                            <span>Destination</span>
                            <span className="font-mono">{destinationEdgeName} (Hops: {pathRemaining?.toFixed(0)})</span>
                        </div>
                    )}

                    {/* Path Display */}
                    {isShmMode && (() => {
                        const pathData = useShmSimulatorStore.getState().getPathData();
                        if (!pathData) return null;

                        const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
                        const len = pathData[pathPtr + PATH_LEN];

                        if (len === 0) return null;

                        const remainingPath: { edgeIdx: number; edgeName: string }[] = [];
                        for (let i = 0; i < len && i < 10; i++) {
                            const edgeIdx = pathData[pathPtr + PATH_EDGES_START + i];
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
                                <summary className="cursor-pointer text-purple-400 font-medium hover:text-purple-300">
                                    Path ({remainingPath.length}{len > 10 ? `+${len - 10}` : ''} edges)
                                </summary>
                                <div className="mt-1 pl-2 space-y-0.5 max-h-32 overflow-y-auto text-gray-400">
                                    {remainingPath.map((item, idx) => (
                                        <div key={idx} className="flex justify-between font-mono">
                                            <span>{idx + 1}.</span>
                                            <span>{item.edgeName}</span>
                                            <span className="text-gray-600">#{item.edgeIdx}</span>
                                        </div>
                                    ))}
                                    {len > 10 && (
                                        <div className="text-gray-600 text-center">... +{len - 10} more</div>
                                    )}
                                </div>
                            </details>
                        );
                    })()}

                    {/* Next Edges & Merge Node Info (SHM mode) */}
                    {isShmMode && nextEdgesInfo.length > 0 && (
                        <details className="text-xs mt-2" open>
                            <summary className="cursor-pointer text-accent-cyan font-medium hover:text-cyan-300">
                                Next Edges ({nextEdgesInfo.length}/5)
                            </summary>
                            <div className="mt-1 pl-2 space-y-0.5 text-gray-400">
                                {nextEdgesInfo.map((item) => (
                                    item && (
                                        <div key={item.index} className={`flex justify-between font-mono ${item.isMerge ? 'text-accent-orange font-bold' : ''}`}>
                                            <span>{item.index + 1}.</span>
                                            <span>{item.name}</span>
                                            <span className="text-gray-600">
                                                #{item.edgeIdx}
                                                {item.isMerge && <span className="ml-1 text-accent-orange">[M]</span>}
                                            </span>
                                        </div>
                                    )
                                ))}
                            </div>
                        </details>
                    )}

                    {/* Merge Wait Point Alert */}
                    {isShmMode && mergeWaitInfo && (
                        <div className="mt-2 p-2 bg-accent-orange/10 rounded border border-accent-orange/30 text-xs">
                            <div className="flex justify-between font-bold text-accent-orange mb-1">
                                <span>Merge Wait Point</span>
                                <span>{mergeWaitInfo.waitNodeName} ({mergeWaitInfo.isCurve ? 'Curve' : 'Str'})</span>
                            </div>
                            <div className="flex justify-between text-accent-orange-light">
                                <span>Distance to Wait:</span>
                                <span className="font-mono font-bold">{mergeWaitInfo.distanceToWait.toFixed(2)} m</span>
                            </div>
                            <div className="flex justify-between text-orange-300">
                                <span>Via Edge:</span>
                                <span className="font-mono">{mergeWaitInfo.mergeEdgeName}</span>
                            </div>
                            <div className="flex justify-between text-orange-300">
                                <span>Hops:</span>
                                <span className="font-mono">{mergeWaitInfo.edgeHops === 0 ? 'Current' : mergeWaitInfo.edgeHops}</span>
                            </div>
                        </div>
                    )}

                    <div className="my-2 border-t border-panel-border"></div>

                    <div className="flex justify-between">
                        <span className="text-gray-400">Sensor Preset</span>
                        <span className="font-mono text-white">{Object.keys(PresetIndex).find(key => PresetIndex[key as keyof typeof PresetIndex] === sensorPreset) || sensorPreset}</span>
                    </div>

                    <div className="flex justify-between">
                        <span className="text-gray-400">Hit Zone</span>
                        <span className={`font-mono font-bold ${hitZone > 0 ? "text-red-400" : "text-gray-400"}`}>
                            {HitZoneMap[Math.round(hitZone)] || hitZone} ({hitZone.toFixed(0)})
                        </span>
                    </div>

                    {collisionTarget !== -1 && (
                        <div className="mt-2 p-2 bg-red-500/10 rounded border border-red-500/30 text-xs text-red-300">
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

                    <div className="my-2 border-t border-panel-border"></div>

                    {zonePoints && (
                        <div className="space-y-2">
                            <details className="group">
                                <summary className="font-semibold text-xs text-gray-500 cursor-pointer list-none flex items-center gap-1 select-none">
                                    <span className="group-open:rotate-90 transition-transform">▸</span>
                                    Sensor Points (World)
                                </summary>
                                <div className="text-[10px] space-y-2 mt-2 pl-2">
                                    <div className="grid grid-cols-2 gap-1 bg-panel-bg p-1 rounded">
                                        <span className="font-bold col-span-2 text-gray-300">Body Quad</span>
                                        <span className="text-gray-400">FL: {zonePoints[0].pts.fl[0].toFixed(2)}, {zonePoints[0].pts.fl[1].toFixed(2)}</span>
                                        <span className="text-gray-400">FR: {zonePoints[0].pts.fr[0].toFixed(2)}, {zonePoints[0].pts.fr[1].toFixed(2)}</span>
                                        <span className="text-gray-400">BL: {zonePoints[0].pts.bl[0].toFixed(2)}, {zonePoints[0].pts.bl[1].toFixed(2)}</span>
                                        <span className="text-gray-400">BR: {zonePoints[0].pts.br[0].toFixed(2)}, {zonePoints[0].pts.br[1].toFixed(2)}</span>
                                    </div>

                                    {zonePoints.map((z, idx) => (
                                        <div key={idx} className="bg-panel-bg p-1 rounded border border-panel-border">
                                            <div className="font-bold mb-1 text-gray-300">{z.name} (SL/SR)</div>
                                            <div className="grid grid-cols-1 gap-1">
                                                <span className="text-gray-400">SL: {z.pts.sl[0].toFixed(2)}, {z.pts.sl[1].toFixed(2)}</span>
                                                <span className="text-gray-400">SR: {z.pts.sr[0].toFixed(2)}, {z.pts.sr[1].toFixed(2)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        </div>
                    )}

                    <div className="my-2 border-t border-panel-border"></div>

                    <div className="flex justify-between">
                        <span className="text-gray-400">Traffic State</span>
                        <span className={`font-mono ${trafficState === TrafficState.WAITING ? "text-accent-orange animate-pulse" : "text-accent-cyan"}`}>
                            {TrafficStateMap[trafficState] || trafficState}
                        </span>
                    </div>

                    <div className="flex flex-col mt-1">
                        <span className="mb-1 text-gray-500">Stop Reasons:</span>
                        <div className="flex flex-wrap gap-1">
                            {stopReasons.map(r => (
                                <span key={r} className={`px-1.5 py-0.5 text-[10px] rounded border ${r === "NONE" ? "bg-panel-bg text-gray-500 border-panel-border" : "bg-red-500/20 text-red-400 border-red-500/30 font-bold"}`}>
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
    const shmController = useShmSimulatorStore((state) => state.controller);
    const isShmMode = shmController !== null;

    const vehiclesRef = useRef(vehicles);
    vehiclesRef.current = vehicles;

    const followVehicle = useCameraStore((state) => state.followVehicle);
    const stopFollowingVehicle = useCameraStore((state) => state.stopFollowingVehicle);

    const handleSearch = () => {
        if (!searchTerm) {
            setFoundVehicleIndex(null);
            stopFollowingVehicle();
            return;
        }

        const shmActualNumVehicles = useShmSimulatorStore.getState().actualNumVehicles;
        const arrayActualNumVehicles = useVehicleArrayStore.getState().actualNumVehicles;
        const actualNumVehicles = isShmMode ? shmActualNumVehicles : arrayActualNumVehicles;

        let found = -1;

        const match = searchTerm.match(/(\d+)/);
        if (match) {
            const idNum = Number.parseInt(match[0], 10);
            const targetIdx = idNum;

            if (isShmMode) {
                if (targetIdx >= 0 && targetIdx < actualNumVehicles) {
                    found = targetIdx;
                }
            } else {
                const v = vehiclesRef.current.get(targetIdx);
                if (v) {
                    found = targetIdx;
                }
            }
        }

        if (found >= 0) {
            setFoundVehicleIndex(found);
            followVehicle(found);
        } else {
            setFoundVehicleIndex(null);
            stopFollowingVehicle();
            alert("Vehicle not found");
        }
    };

    useEffect(() => {
        if (selectedVehicleId !== null) {
            setFoundVehicleIndex(selectedVehicleId);
            setSearchTerm(`VEH${String(selectedVehicleId).padStart(5, '0')}`);
            followVehicle(selectedVehicleId);
        }
    }, [selectedVehicleId, followVehicle]);

    return (
        <div className="space-y-4">
            {/* Search Area */}
            <div className="relative">
                <input
                    type="text"
                    placeholder="Search Vehicle (e.g. VEH00001)"
                    className={twMerge(
                        panelInputVariants({ size: "md", width: "full" }),
                        "pl-10 pr-4 py-2"
                    )}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                <Search className="absolute left-3 top-2.5 text-gray-500" size={20} />
            </div>

            {/* Monitor Area */}
            {foundVehicleIndex !== null ? (
                <VehicleMonitor
                    vehicleIndex={foundVehicleIndex}
                    vehicles={vehicles}
                    isShmMode={isShmMode}
                />
            ) : (
                <div className="text-center text-gray-500 py-8">
                    <Search size={48} className="mx-auto mb-4 opacity-50" />
                    <p className={panelTextVariants({ variant: "muted", size: "sm" })}>차량 ID를 검색하세요</p>
                    <p className={panelTextVariants({ variant: "muted", size: "xs" })}>예: VEH00001 또는 1</p>
                </div>
            )}
        </div>
    );
};

export default IndividualControlPanel;
