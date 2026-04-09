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
import { NEXT_EDGE_COUNT, OrderData } from "@/common/vehicle/initialize/constants";
import type { Edge as FullEdge } from "@/types/edge";
import { EdgeType } from "@/types";
import { PresetIndex } from "@/store/vehicle/arrayMode/sensorPresets";
import { useEdgeStore } from "@/store/map/edgeStore";
import { sensorPointArray } from "@/store/vehicle/arrayMode/sensorPointArray";
import { MAX_PATH_LENGTH, PATH_LEN, PATH_EDGES_START } from "@/common/vehicle/logic/TransferMgr";
import { getLockWaitDistanceFromMergingStr, getLockWaitDistanceFromMergingCurve } from "@/config/worker/simulationConfig";
import {
    panelInputVariants,
} from "../shared/panelStyles";
import { twMerge } from "tailwind-merge";
import { useVehicleEdgeHighlightStore } from "@/store/ui/vehicleEdgeHighlightStore";

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

const TrafficStateMap: Record<number, string> = {
    [TrafficState.FREE]: "FREE",
    [TrafficState.WAITING]: "WAITING",
    [TrafficState.ACQUIRED]: "ACQUIRED",
};

const HitZoneMap: Record<number, string> = {
    [-1]: "None",
    0: "Approach",
    1: "Brake",
    2: "Stop",
};

type TabType = "basic" | "route" | "sensor";

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
            jobState: data[ptr + ShmLogicData.JOB_STATE],
            orderId: data[ptr + OrderData.ORDER_ID],
            orderSrcStation: data[ptr + OrderData.ORDER_SRC_STATION],
            orderDestStation: data[ptr + OrderData.ORDER_DEST_STATION],
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

// ─── Tab: Basic ─────────────────────────────────────────
const JOB_STATE_LABEL: Record<number, { label: string; color: string }> = {
    0: { label: "INIT",           color: "text-gray-500" },
    1: { label: "IDLE",           color: "text-gray-400" },
    2: { label: "MOVE_TO_LOAD",   color: "text-pink-400 font-bold text-sm" },
    3: { label: "● LOADING",      color: "text-pink-300 font-bold text-sm animate-pulse" },
    4: { label: "MOVE_TO_UNLOAD", color: "text-yellow-300 font-bold text-sm" },
    5: { label: "● UNLOADING",    color: "text-yellow-200 font-bold text-sm animate-pulse" },
    6: { label: "ERROR",          color: "text-red-500 font-bold text-sm" },
};

const BasicTab: React.FC<{ data: VehicleData }> = ({ data }) => {
    const {
        vehicleId, vehicleIndex, status, velocity, acceleration, deceleration,
        currentEdgeName, currentEdgeIdx, currentEdge, nextEdgeName, nextEdgeIdx,
        destinationEdgeName, pathRemaining, isShmMode, trafficState, stopReasons,
        jobState, orderId, orderSrcStation, orderDestStation,
    } = data;

    const railType = currentEdge
        ? (currentEdge.vos_rail_type === EdgeType.LINEAR ? "Str" : "Curve")
        : "—";

    return (
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
                <span>Cur Edge <span className="text-gray-600">({railType})</span></span>
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

            {isShmMode && (
                <>
                    <div className="my-1.5 border-t border-panel-border" />
                    <div className={`rounded px-2 py-1 ${
                        jobState === 2 ? "bg-pink-500/20 border border-pink-500/40" :
                        jobState === 3 ? "bg-pink-500/30 border border-pink-400/60" :
                        jobState === 4 ? "bg-yellow-500/20 border border-yellow-500/40" :
                        jobState === 5 ? "bg-yellow-500/30 border border-yellow-400/60" :
                        "bg-transparent"
                    }`}>
                        <div className="flex justify-between">
                            <span className="text-gray-400 text-xs">Job State</span>
                            <span className={`font-mono ${(JOB_STATE_LABEL[jobState] ?? JOB_STATE_LABEL[0]).color}`}>
                                {(JOB_STATE_LABEL[jobState] ?? { label: String(jobState) }).label}
                            </span>
                        </div>
                        {orderId > 0 && (
                            <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                                <span>Order #{orderId}</span>
                                <span className="font-mono">
                                    S<span className="text-pink-300 font-bold">{orderSrcStation}</span>
                                    {" → "}
                                    D<span className="text-yellow-300 font-bold">{orderDestStation}</span>
                                </span>
                            </div>
                        )}
                    </div>
                </>
            )}

            <div className="my-1.5 border-t border-panel-border" />

            <div className="flex justify-between">
                <span className="text-gray-400">Traffic</span>
                <span className={`font-mono ${trafficState === TrafficState.WAITING ? "text-accent-orange animate-pulse" : "text-accent-cyan"}`}>
                    {TrafficStateMap[trafficState] || trafficState}
                </span>
            </div>

            <div className="flex items-center gap-1 mt-1 flex-wrap">
                <span className="text-gray-500 text-xs shrink-0">Stop:</span>
                {stopReasons.map(r => (
                    <span key={r} className={`px-1 py-0.5 text-[10px] rounded border ${r === "NONE" ? "bg-panel-bg text-gray-500 border-panel-border" : "bg-red-500/20 text-red-400 border-red-500/30 font-bold"}`}>
                        {r}
                    </span>
                ))}
            </div>
        </div>
    );
};

// ─── Tab: Route ─────────────────────────────────────────
const RouteTab: React.FC<{ data: VehicleData }> = ({ data }) => {
    const {
        vehicleIndex, nextEdgesInfo, mergeWaitInfo, isShmMode,
    } = data;
    const [pathExpanded, setPathExpanded] = useState(false);

    return (
        <div className="space-y-2 text-xs">
            {/* Next Edges - 항상 표시 */}
            <div className="bg-panel-bg-solid p-2 rounded border border-panel-border">
                <div className="text-accent-cyan font-medium mb-1">Next Edges ({nextEdgesInfo.length}/5)</div>
                {nextEdgesInfo.length > 0 ? (
                    <div className="space-y-0.5 text-gray-400">
                        {nextEdgesInfo.map((item) => (
                            item && (
                                <div key={item.index} className={`flex justify-between font-mono ${item.isMerge ? 'text-accent-orange font-bold' : ''}`}>
                                    <span>{item.index + 1}. {item.name}</span>
                                    <span className="text-gray-600">
                                        #{item.edgeIdx}
                                        {item.isMerge && <span className="ml-1 text-accent-orange">[M]</span>}
                                    </span>
                                </div>
                            )
                        ))}
                    </div>
                ) : (
                    <div className="text-gray-600 font-mono text-center py-1">—</div>
                )}
            </div>

            {/* Path (SHM only) */}
            {isShmMode && (() => {
                const pathData = useShmSimulatorStore.getState().getPathData();
                if (!pathData) return null;

                const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
                const len = pathData[pathPtr + PATH_LEN];

                const displayCount = pathExpanded ? len : Math.min(len, 10);
                const items: { edgeIdx: number; edgeName: string }[] = [];
                for (let i = 0; i < displayCount; i++) {
                    const edgeIdx = pathData[pathPtr + PATH_EDGES_START + i];
                    if (edgeIdx >= 0) {
                        const edge = useEdgeStore.getState().getEdgeByIndex(edgeIdx);
                        items.push({ edgeIdx, edgeName: edge?.edge_name || `Edge#${edgeIdx}` });
                    }
                }

                return (
                    <div className="bg-panel-bg-solid p-2 rounded border border-panel-border">
                        <div className="text-purple-400 font-medium mb-1">
                            Path ({len} edges)
                        </div>
                        {len > 0 ? (
                            <div className={twMerge("space-y-0.5 overflow-y-auto text-gray-400", pathExpanded ? "max-h-60" : "max-h-40")}>
                                {items.map((item, idx) => (
                                    <div key={idx} className="flex justify-between font-mono">
                                        <span>{idx + 1}. {item.edgeName}</span>
                                        <span className="text-gray-600">#{item.edgeIdx}</span>
                                    </div>
                                ))}
                                {!pathExpanded && len > 10 && (
                                    <button
                                        onClick={() => setPathExpanded(true)}
                                        className="w-full text-center text-purple-400 hover:text-purple-300 py-1 transition-colors cursor-pointer"
                                    >
                                        +{len - 10} more
                                    </button>
                                )}
                                {pathExpanded && len > 10 && (
                                    <button
                                        onClick={() => setPathExpanded(false)}
                                        className="w-full text-center text-gray-500 hover:text-gray-400 py-1 transition-colors cursor-pointer"
                                    >
                                        collapse
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="text-gray-600 font-mono text-center py-1">—</div>
                        )}
                    </div>
                );
            })()}

            {/* Merge Wait Point - 항상 표시, Path 아래 */}
            <div className={twMerge(
                "p-2 rounded border",
                mergeWaitInfo
                    ? "bg-accent-orange/10 border-accent-orange/30"
                    : "bg-panel-bg-solid border-panel-border"
            )}>
                <div className={twMerge(
                    "font-medium mb-1",
                    mergeWaitInfo ? "flex justify-between font-bold text-accent-orange" : "text-gray-500"
                )}>
                    <span>Merge Wait</span>
                    {mergeWaitInfo && (
                        <span>{mergeWaitInfo.waitNodeName} ({mergeWaitInfo.isCurve ? 'Curve' : 'Str'})</span>
                    )}
                </div>
                {mergeWaitInfo ? (
                    <>
                        <div className="flex justify-between text-accent-orange-light">
                            <span>Dist:</span>
                            <span className="font-mono font-bold">{mergeWaitInfo.distanceToWait.toFixed(2)} m</span>
                        </div>
                        <div className="flex justify-between text-orange-300">
                            <span>Via:</span>
                            <span className="font-mono">{mergeWaitInfo.mergeEdgeName}</span>
                        </div>
                        <div className="flex justify-between text-orange-300">
                            <span>Hops:</span>
                            <span className="font-mono">{mergeWaitInfo.edgeHops === 0 ? 'Current' : mergeWaitInfo.edgeHops}</span>
                        </div>
                    </>
                ) : (
                    <div className="text-gray-600 font-mono text-center py-1">—</div>
                )}
            </div>

            {!isShmMode && nextEdgesInfo.length === 0 && (
                <div className="text-gray-500 text-center py-4">No route data (Array mode)</div>
            )}
        </div>
    );
};

// ─── Tab: Sensor ────────────────────────────────────────
const SensorTab: React.FC<{ data: VehicleData }> = ({ data }) => {
    const {
        sensorPreset, hitZone, collisionTarget,
        currentEdgeName, currentEdgeIdx, currentEdgeRatio,
        targetEdgeInfo, targetRatioInfo, zonePoints,
    } = data;

    return (
        <div className="space-y-2 text-sm">
            <div className="bg-panel-bg-solid p-2 rounded border border-panel-border space-y-1">
                <div className="flex justify-between">
                    <span className="text-gray-400">Preset</span>
                    <span className="font-mono text-white text-xs">
                        {Object.keys(PresetIndex).find(key => PresetIndex[key as keyof typeof PresetIndex] === sensorPreset) || sensorPreset}
                    </span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-400">Hit Zone</span>
                    <span className={`font-mono font-bold ${hitZone > 0 ? "text-red-400" : "text-gray-400"}`}>
                        {HitZoneMap[Math.round(hitZone)] || hitZone} ({hitZone.toFixed(0)})
                    </span>
                </div>
            </div>

            {/* Collision Target */}
            {collisionTarget !== -1 && (
                <div className="p-2 bg-red-500/10 rounded border border-red-500/30 text-xs text-red-300">
                    <div className="flex justify-between font-bold mb-1">
                        <span>Collision Target</span>
                        <span>VEH{collisionTarget.toString().padStart(5, '0')} (#{collisionTarget})</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">Target:</span>
                        <span className="font-mono">{targetEdgeInfo} : {targetRatioInfo}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">Me:</span>
                        <span className="font-mono">{currentEdgeName} (#{currentEdgeIdx}) : {currentEdgeRatio.toFixed(3)}</span>
                    </div>
                </div>
            )}

            {/* Sensor Points (Array mode only) */}
            {zonePoints && (
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
            )}
        </div>
    );
};

// ─── Shared data interface for tabs ─────────────────────
interface VehicleData {
    vehicleId: string;
    vehicleIndex: number;
    status: number;
    velocity: number;
    acceleration: number;
    deceleration: number;
    currentEdgeName: string;
    currentEdgeIdx: number;
    currentEdge: FullEdge | undefined;
    currentEdgeRatio: number;
    nextEdgeName: string;
    nextEdgeIdx: number;
    nextEdges: number[];
    nextEdgesInfo: { index: number; edgeIdx: number; name: string; toNode: string; isMerge: boolean }[];
    destinationEdgeName: string;
    pathRemaining: number | undefined;
    sensorPreset: number;
    hitZone: number;
    collisionTarget: number;
    targetEdgeInfo: string;
    targetRatioInfo: string;
    trafficState: number;
    stopReasons: string[];
    mergeWaitInfo: MergeWaitInfo | null;
    isShmMode: boolean;
    zonePoints: { name: string; pts: any }[] | null;
    jobState: number;
    orderId: number;
    orderSrcStation: number;
    orderDestStation: number;
}

// ─── VehicleMonitor ─────────────────────────────────────
const VehicleMonitor: React.FC<VehicleMonitorProps> = ({ vehicleIndex, vehicles, isShmMode }) => {
    const [tick, setTick] = useState(0);
    const [activeTab, setActiveTab] = useState<TabType>("basic");
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

    // Clear edge highlight on unmount
    useEffect(() => {
        return () => {
            useVehicleEdgeHighlightStore.getState().clear();
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

    let status: number, velocity: number, acceleration: number, deceleration: number;
    let sensorPreset: number, hitZone: number, trafficState: number, stopReasonMask: number;
    let currentEdgeIdx: number, currentEdgeRatio: number, nextEdgeIdx: number, collisionTarget: number;
    let destinationEdgeIdx: number | undefined, pathRemaining: number | undefined;
    let nextEdges: number[] = [];
    let jobState = 0, orderId = 0, orderSrcStation = 0, orderDestStation = 0;

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
        jobState = vData.logic.jobState;
        orderId = vData.logic.orderId;
        orderSrcStation = vData.logic.orderSrcStation;
        orderDestStation = vData.logic.orderDestStation;
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
    }).filter(Boolean) as VehicleData["nextEdgesInfo"];

    const vehicleData: VehicleData = {
        vehicleId, vehicleIndex, status, velocity, acceleration, deceleration,
        currentEdgeName, currentEdgeIdx, currentEdge, currentEdgeRatio,
        nextEdgeName, nextEdgeIdx, nextEdges, nextEdgesInfo,
        destinationEdgeName, pathRemaining, sensorPreset, hitZone,
        collisionTarget, targetEdgeInfo, targetRatioInfo,
        trafficState, stopReasons, mergeWaitInfo, isShmMode, zonePoints,
        jobState, orderId, orderSrcStation, orderDestStation,
    };

    // Update edge highlight for selected vehicle
    const highlightStore = useVehicleEdgeHighlightStore.getState();
    highlightStore.setCurrentEdge(currentEdgeIdx >= 1 ? currentEdgeIdx : null);
    highlightStore.setNextEdge(nextEdgeIdx >= 1 ? nextEdgeIdx : null);

    // Path edges highlight (SHM only)
    if (isShmMode) {
        const pathData = useShmSimulatorStore.getState().getPathData();
        if (pathData) {
            const pathPtr = vehicleIndex * MAX_PATH_LENGTH;
            const len = pathData[pathPtr + PATH_LEN];

            const excludeSet = new Set<number>();
            if (currentEdgeIdx >= 1) excludeSet.add(currentEdgeIdx);
            for (const ne of nextEdges) {
                if (ne >= 1) excludeSet.add(ne);
            }

            const pathOnly: number[] = [];
            for (let i = 0; i < len; i++) {
                const edgeIdx = pathData[pathPtr + PATH_EDGES_START + i];
                if (edgeIdx >= 1 && !excludeSet.has(edgeIdx)) {
                    pathOnly.push(edgeIdx);
                }
            }
            highlightStore.setPathEdges(pathOnly);
        }
    }

    const tabs: { key: TabType; label: string }[] = [
        { key: "basic", label: "기본" },
        { key: "route", label: "경로" },
        { key: "sensor", label: "센서" },
    ];

    return (
        <div className="space-y-2">
            {/* Control Buttons - compact, icon only */}
            <div className="flex gap-1.5">
                <button onClick={handleStop} title="Stop"
                    className="flex items-center justify-center w-8 h-8 rounded border border-red-500/50 bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
                    <Octagon size={14} />
                </button>
                <button onClick={handlePause} title="Pause"
                    className="flex items-center justify-center w-8 h-8 rounded border border-orange-500/50 bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors">
                    <Pause size={14} />
                </button>
                <button onClick={handleResume} title="Resume"
                    className="flex items-center justify-center w-8 h-8 rounded border border-green-500/50 bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors">
                    <Play size={14} />
                </button>
                <button onClick={handleToggleFollow} title={isFollowing ? "Following" : "Follow"}
                    className={twMerge(
                        "flex items-center justify-center w-8 h-8 rounded border transition-colors",
                        isFollowing
                            ? "border-purple-400 bg-purple-500/40 text-purple-300"
                            : "border-purple-500/50 bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
                    )}>
                    {isFollowing ? <Video size={14} /> : <VideoOff size={14} />}
                </button>
                <button onClick={handleChangeSensor} title="Sensor Preset"
                    className="flex items-center justify-center w-8 h-8 rounded border border-blue-500/50 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors">
                    <Settings size={14} />
                </button>
                <span className="ml-auto text-[10px] text-gray-600 font-mono self-center">T:{tick % 100}</span>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-panel-border">
                {tabs.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={twMerge(
                            "flex-1 py-1.5 text-xs font-medium transition-colors",
                            activeTab === tab.key
                                ? "text-accent-cyan border-b-2 border-accent-cyan"
                                : "text-gray-500 hover:text-gray-300"
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {activeTab === "basic" && <BasicTab data={vehicleData} />}
            {activeTab === "route" && <RouteTab data={vehicleData} />}
            {activeTab === "sensor" && <SensorTab data={vehicleData} />}
        </div>
    );
};

// ─── IndividualControlPanel ─────────────────────────────
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
        }
    }, [selectedVehicleId]);

    return (
        <div className="flex flex-col h-full">
            {/* Search Area */}
            <div className="relative shrink-0 pb-3">
                <input
                    type="text"
                    placeholder="VEH00001 or 1"
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
            {foundVehicleIndex !== null && (
                <div className="flex-1 overflow-y-auto min-h-0">
                    <VehicleMonitor
                        vehicleIndex={foundVehicleIndex}
                        vehicles={vehicles}
                        isShmMode={isShmMode}
                    />
                </div>
            )}
        </div>
    );
};

export default IndividualControlPanel;
