// src/components/ConfigDataPanel.tsx
import React, { useMemo, useState, useEffect } from "react";
import { useNodeStore } from "../../../store/map/nodeStore";
import { useEdgeStore } from "../../../store/map/edgeStore";
import { useCameraStore } from "../../../store/ui/cameraStore";
import { cn } from "@/lib/utils";
import { EdgeType } from "@/types";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableFooter,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

type TabKey = "nodes" | "edges" | "vehicles";

const headerCell =
  "sticky top-0 z-10 h-10 px-3 bg-slate-800/95 backdrop-blur-lg text-[12px] font-semibold text-slate-200 border-b border-slate-600/50";
const bodyCell =
  "px-3 py-2 align-middle text-[12px] transition-colors duration-200";
const monoRight = "font-mono tabular-nums text-[12px] text-right";
const firstCol =
  "sticky left-0 z-10 bg-slate-900/95 backdrop-blur-sm border-r border-slate-600/50";

function fmtNum(v: unknown, d = 1) {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "-";
}

function typeColor(type?: string) {
  switch (type) {
    case EdgeType.LINEAR:
    case "S":
      return {
        bg: "linear-gradient(135deg, #3B82F6, #1E40AF)",
        fg: "#fff",
        shadow: "shadow-blue-500/20",
      };
    case EdgeType.CURVE_90:
      return {
        bg: "linear-gradient(135deg, #A855F7, #7C3AED)",
        fg: "#fff",
        shadow: "shadow-purple-500/20",
      };
    case EdgeType.CURVE_180:
      return {
        bg: "linear-gradient(135deg, #EC4899, #BE185D)",
        fg: "#fff",
        shadow: "shadow-pink-500/20",
      };
    case EdgeType.CURVE_CSC:
      return {
        bg: "linear-gradient(135deg, #F97316, #EA580C)",
        fg: "#fff",
        shadow: "shadow-orange-500/20",
      };
    default:
      return {
        bg: "linear-gradient(135deg, #64748B, #475569)",
        fg: "#fff",
        shadow: "shadow-slate-500/20",
      };
  }
}

const MiniBadge: React.FC<{
  bg: string;
  fg: string;
  shadow: string;
  children: React.ReactNode;
}> = ({ bg, fg, shadow, children }) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide shadow-md transform hover:scale-105 transition-all duration-200",
      shadow
    )}
    style={{ background: bg, color: fg }}
  >
    {children}
  </span>
);

const ColorChip: React.FC<{ color?: string; label?: string }> = ({
  color = "#ffffff",
  label = "default",
}) => (
  <div className="flex items-center gap-1.5">
    <div
      className="w-3 h-3 rounded-full border border-slate-600 shadow-sm"
      style={{ backgroundColor: color }}
    />
    <span className="text-[11px] text-slate-400 font-medium truncate max-w-[60px]">
      {label}
    </span>
  </div>
);

const ConfigDataPanel: React.FC = () => {
  const [tab, setTab] = useState<TabKey>("nodes");
  const { nodes, previewNodes } = useNodeStore();
  const { edges } = useEdgeStore();
  const { followVehicle, stopFollowingVehicle, followingVehicleId } = useCameraStore();

  const nodeCount = useMemo(() => nodes.length, [nodes]);
  const edgeCount = useMemo(() => edges.length, [edges]);

  // Vehicle data state
  const [vehicles, setVehicles] = useState<Array<{
    id: number;
    x: number;
    y: number;
    z: number;
    velocity: number;
    edgeIndex: number;
    status: number;
  }>>([]);

  // Update vehicle list periodically
  useEffect(() => {
    if (tab !== "vehicles") return;

    const updateVehicles = () => {
      // @ts-ignore - accessing global window object
      const vehicleDataArray = window.vehicleDataArray;
      if (!vehicleDataArray) return;

      const activeVehicles = [];
      const maxVehicles = 10000; // Check up to 10000 vehicles

      for (let i = 0; i < maxVehicles; i++) {
        const veh = vehicleDataArray.get(i);
        if (veh && veh.status.status !== 0) {
          activeVehicles.push({
            id: i,
            x: veh.movement.x,
            y: veh.movement.y,
            z: veh.movement.z,
            velocity: veh.movement.velocity,
            edgeIndex: veh.status.currentEdge,
            status: veh.status.status,
          });
        }
      }

      setVehicles(activeVehicles);
    };

    // Update immediately
    updateVehicles();

    // Update every 500ms
    const interval = setInterval(updateVehicles, 500);
    return () => clearInterval(interval);
  }, [tab]);

  const handleVehicleClick = (vehicleId: number) => {
    if (followingVehicleId === vehicleId) {
      stopFollowingVehicle();
    } else {
      followVehicle(vehicleId);
    }
  };

  return (
    <Card
      className={cn(
        "fixed left-2 right-2 bottom-16 max-h-[50vh] z-[1000] w-auto max-w-fit mx-auto",
        "border border-slate-700/50 bg-slate-900/95 backdrop-blur-xl shadow-2xl rounded-lg",
        "ring-1 ring-slate-600/30"
      )}
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <div className="flex items-center justify-between border-b border-slate-700/50 px-3 py-2 bg-slate-800/80 rounded-t-lg">
          <TabsList className="bg-slate-700/50 rounded-lg p-0.5 shadow-inner">
            <TabsTrigger
              value="nodes"
              className="text-xs font-semibold px-3 py-1.5 rounded-md data-[state=active]:bg-slate-600 data-[state=active]:shadow-md data-[state=active]:text-blue-300 text-slate-300 transition-all duration-200"
            >
              Node Data
            </TabsTrigger>
            <TabsTrigger
              value="edges"
              className="text-xs font-semibold px-3 py-1.5 rounded-md data-[state=active]:bg-slate-600 data-[state=active]:shadow-md data-[state=active]:text-purple-300 text-slate-300 transition-all duration-200"
            >
              Edge Data
            </TabsTrigger>
            <TabsTrigger
              value="vehicles"
              className="text-xs font-semibold px-3 py-1.5 rounded-md data-[state=active]:bg-slate-600 data-[state=active]:shadow-md data-[state=active]:text-green-300 text-slate-300 transition-all duration-200"
            >
              Vehicles
            </TabsTrigger>
          </TabsList>
          <div className="text-xs text-slate-400 font-medium">
            {tab === "nodes" ? `${nodeCount} nodes` : tab === "edges" ? `${edgeCount} edges` : `${vehicles.length} vehicles`}
          </div>
        </div>

        <CardContent className="p-3">
          <TabsContent value="nodes" className="mt-0">
            <ScrollArea className="h-[40vh] w-full rounded-lg border border-slate-700/50 bg-slate-800/30">
              <Table className="w-full">
                <TableHeader>
                  <TableRow className="border-0">
                    <TableHead
                      className={cn(headerCell, firstCol, "w-[100px]")}
                    >
                      Name
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[60px]")}>
                      X
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[60px]")}>
                      Y
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[60px]")}>
                      Z
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[70px]")}>
                      Merge
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[70px]")}>
                      Diverge
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[70px]")}>
                      Terminal
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[80px]")}>
                      Barcode
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[100px]")}>
                      Color
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[60px]")}>
                      Size
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[80px]")}>
                      Source
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.map((n: any, i: number) => (
                    <TableRow
                      key={n.node_name}
                      className={cn(
                        "border-b border-slate-700/30 hover:bg-slate-700/30 transition-colors duration-200",
                        i % 2 === 1 && "bg-slate-800/30"
                      )}
                    >
                      <TableCell
                        className={cn(
                          bodyCell,
                          firstCol,
                          "font-semibold text-slate-200"
                        )}
                      >
                        {n.node_name}
                      </TableCell>
                      <TableCell
                        className={cn(
                          bodyCell,
                          monoRight,
                          "text-blue-400 font-bold"
                        )}
                      >
                        {fmtNum(n.editor_x)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          bodyCell,
                          monoRight,
                          "text-green-400 font-bold"
                        )}
                      >
                        {fmtNum(n.editor_y)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          bodyCell,
                          monoRight,
                          "text-purple-400 font-bold"
                        )}
                      >
                        {fmtNum(n.editor_z)}
                      </TableCell>
                      <TableCell className={cn(bodyCell, "text-center")}>
                        {n.isMerge ? (
                          <span className="inline-block w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold leading-5">M</span>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </TableCell>
                      <TableCell className={cn(bodyCell, "text-center")}>
                        {n.isDiverge ? (
                          <span className="inline-block w-5 h-5 rounded-full bg-yellow-500 text-white text-[10px] font-bold leading-5">D</span>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </TableCell>
                      <TableCell className={cn(bodyCell, "text-center")}>
                        {n.isTerminal ? (
                          <span className="inline-block w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold leading-5">T</span>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </TableCell>
                      <TableCell
                        className={cn(
                          bodyCell,
                          "font-mono text-slate-400 text-[11px]"
                        )}
                      >
                        {n.barcode ?? "-"}
                      </TableCell>
                      <TableCell className={bodyCell}>
                        <ColorChip
                          color={n.color}
                          label={n.color ?? "default"}
                        />
                      </TableCell>
                      <TableCell
                        className={cn(
                          bodyCell,
                          monoRight,
                          "text-orange-400 font-bold"
                        )}
                      >
                        {fmtNum(n.size)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          bodyCell,
                          "truncate text-slate-500 font-medium"
                        )}
                      >
                        {n.source ?? "unknown"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {nodeCount > 0 && (
                  <TableFooter>
                    <TableRow className="bg-slate-800/60">
                      <TableCell
                        colSpan={11}
                        className="text-[12px] font-bold text-slate-300 py-3"
                      >
                        Total: {nodeCount} nodes
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </ScrollArea>

            {previewNodes?.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-bold text-amber-400 mb-2 flex items-center gap-2">
                  Preview Nodes
                  <span className="bg-amber-900/50 text-amber-300 px-2 py-0.5 rounded-full text-[10px] font-bold">
                    {previewNodes.length}
                  </span>
                </div>
                <ScrollArea className="max-h-[30vh] w-full rounded-lg border border-amber-700/50 bg-amber-900/20">
                  <Table className="w-full">
                    <TableHeader>
                      <TableRow className="border-0">
                        <TableHead
                          className={cn(
                            headerCell,
                            firstCol,
                            "bg-amber-800/95 w-[100px]"
                          )}
                        >
                          Name
                        </TableHead>
                        <TableHead
                          className={cn(headerCell, "bg-amber-800/95 w-[60px]")}
                        >
                          X
                        </TableHead>
                        <TableHead
                          className={cn(headerCell, "bg-amber-800/95 w-[60px]")}
                        >
                          Y
                        </TableHead>
                        <TableHead
                          className={cn(headerCell, "bg-amber-800/95 w-[60px]")}
                        >
                          Z
                        </TableHead>
                        <TableHead
                          className={cn(
                            headerCell,
                            "bg-amber-800/95 w-[100px]"
                          )}
                        >
                          Color
                        </TableHead>
                        <TableHead
                          className={cn(headerCell, "bg-amber-800/95 w-[60px]")}
                        >
                          Size
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewNodes.map((n: any, i: number) => (
                        <TableRow
                          key={n.node_name}
                          className={cn(
                            "border-b border-amber-800/30 hover:bg-amber-800/30 transition-colors duration-200",
                            i % 2 === 1 && "bg-amber-900/30"
                          )}
                        >
                          <TableCell
                            className={cn(
                              bodyCell,
                              firstCol,
                              "font-semibold text-amber-200"
                            )}
                          >
                            {n.node_name}
                          </TableCell>
                          <TableCell
                            className={cn(
                              bodyCell,
                              monoRight,
                              "text-blue-400 font-bold"
                            )}
                          >
                            {fmtNum(n.editor_x)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              bodyCell,
                              monoRight,
                              "text-green-400 font-bold"
                            )}
                          >
                            {fmtNum(n.editor_y)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              bodyCell,
                              monoRight,
                              "text-purple-400 font-bold"
                            )}
                          >
                            {fmtNum(n.editor_z)}
                          </TableCell>
                          <TableCell className={bodyCell}>
                            <ColorChip
                              color={n.color}
                              label={n.color ?? "default"}
                            />
                          </TableCell>
                          <TableCell
                            className={cn(
                              bodyCell,
                              monoRight,
                              "text-orange-400 font-bold"
                            )}
                          >
                            {fmtNum(n.size)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            )}
          </TabsContent>

          <TabsContent value="edges" className="mt-0">
            <ScrollArea className="h-[40vh] w-full rounded-lg border border-slate-700/50 bg-slate-800/30">
              <Table className="w-full">
                <TableHeader>
                  <TableRow className="border-0">
                    <TableHead
                      className={cn(headerCell, firstCol, "w-[100px]")}
                    >
                      Name
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[70px]")}>
                      From
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[70px]")}>
                      To
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[90px]")}>
                      Type
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[60px]")}>
                      Axis
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[60px]")}>
                      From M
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[60px]")}>
                      From D
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[60px]")}>
                      To M
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[60px]")}>
                      To D
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[100px]")}>
                      Next
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[300px]")}>
                      Waypoints
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[60px]")}>
                      Distance
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[60px]")}>
                      Radius
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[60px]")}>
                      Rotation
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[80px]")}>
                      Source
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {edges.map((e: any, i: number) => {
                    const c = typeColor(e.vos_rail_type);
                    return (
                      <TableRow
                        key={e.edge_name}
                        className={cn(
                          "border-b border-slate-700/30 hover:bg-slate-700/30 transition-colors duration-200",
                          i % 2 === 1 && "bg-slate-800/30"
                        )}
                      >
                        <TableCell
                          className={cn(
                            bodyCell,
                            firstCol,
                            "font-semibold text-slate-200"
                          )}
                        >
                          {e.edge_name}
                        </TableCell>
                        <TableCell
                          className={cn(
                            bodyCell,
                            "font-semibold text-green-400"
                          )}
                        >
                          {e.from_node}
                        </TableCell>
                        <TableCell
                          className={cn(bodyCell, "font-semibold text-red-400")}
                        >
                          {e.to_node}
                        </TableCell>
                        <TableCell className={bodyCell}>
                          <MiniBadge bg={c.bg} fg={c.fg} shadow={c.shadow}>
                            {e.vos_rail_type}
                          </MiniBadge>
                        </TableCell>
                        <TableCell className={cn(bodyCell, monoRight, "text-cyan-400 font-bold")}>
                          {e.axis !== undefined ? `${fmtNum(e.axis, 0)}°` : "-"}
                        </TableCell>
                        <TableCell className={cn(bodyCell, "text-center")}>
                          {e.fromNodeIsMerge ? (
                            <span className="inline-block w-4 h-4 rounded-full bg-red-500"></span>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </TableCell>
                        <TableCell className={cn(bodyCell, "text-center")}>
                          {e.fromNodeIsDiverge ? (
                            <span className="inline-block w-4 h-4 rounded-full bg-yellow-500"></span>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </TableCell>
                        <TableCell className={cn(bodyCell, "text-center")}>
                          {e.toNodeIsMerge ? (
                            <span className="inline-block w-4 h-4 rounded-full bg-red-500"></span>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </TableCell>
                        <TableCell className={cn(bodyCell, "text-center")}>
                          {e.toNodeIsDiverge ? (
                            <span className="inline-block w-4 h-4 rounded-full bg-yellow-500"></span>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </TableCell>
                        <TableCell className={cn(bodyCell, "font-mono text-[10px] text-blue-400")}>
                          {e.nextEdgeIndices && e.nextEdgeIndices.length > 0 ? (
                            <span className="bg-blue-900/50 px-1 py-0.5 rounded">
                              [{e.nextEdgeIndices.join(", ")}]
                            </span>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-[11px] text-slate-400 font-mono">
                          {Array.isArray(e.waypoints) ? (
                            <span className="bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded font-bold">
                              {e.waypoints.join(", ")}
                            </span>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            bodyCell,
                            monoRight,
                            "text-indigo-400 font-bold"
                          )}
                        >
                          {fmtNum(e.distance)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            bodyCell,
                            monoRight,
                            "text-cyan-400 font-bold"
                          )}
                        >
                          {fmtNum(e.radius)}
                        </TableCell>
                        <TableCell
                          className={cn(bodyCell, "text-slate-400 font-medium")}
                        >
                          {e.rotation ?? "-"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            bodyCell,
                            "truncate text-slate-500 font-medium"
                          )}
                        >
                          {e.source ?? "unknown"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                {edgeCount > 0 && (
                  <TableFooter>
                    <TableRow className="bg-slate-800/60">
                      <TableCell
                        colSpan={15}
                        className="text-[12px] font-bold text-slate-300 py-3"
                      >
                        Total: {edgeCount} edges
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </ScrollArea>
          </TabsContent>

          {/* Vehicles Tab */}
          <TabsContent value="vehicles" className="mt-0">
            <ScrollArea className="h-[40vh] w-full rounded-lg border border-slate-700/50 bg-slate-800/30">
              <Table className="w-full">
                <TableHeader>
                  <TableRow className="border-0">
                    <TableHead className={cn(headerCell, firstCol, "w-[80px]")}>
                      ID
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[80px]")}>
                      X
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[80px]")}>
                      Y
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[80px]")}>
                      Z
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[80px]")}>
                      Velocity
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[80px]")}>
                      Edge
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[80px]")}>
                      Status
                    </TableHead>
                    <TableHead className={cn(headerCell, "w-[100px]")}>
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vehicles.map((veh) => (
                    <TableRow
                      key={veh.id}
                      className={cn(
                        "border-b border-slate-700/30 hover:bg-slate-700/40 transition-colors duration-150",
                        followingVehicleId === veh.id && "bg-green-900/30"
                      )}
                    >
                      <TableCell className={cn(bodyCell, firstCol, "font-semibold text-green-400")}>
                        {veh.id}
                      </TableCell>
                      <TableCell className={cn(bodyCell, monoRight)}>
                        {fmtNum(veh.x, 1)}
                      </TableCell>
                      <TableCell className={cn(bodyCell, monoRight)}>
                        {fmtNum(veh.y, 1)}
                      </TableCell>
                      <TableCell className={cn(bodyCell, monoRight)}>
                        {fmtNum(veh.z, 1)}
                      </TableCell>
                      <TableCell className={cn(bodyCell, monoRight)}>
                        {fmtNum(veh.velocity, 2)}
                      </TableCell>
                      <TableCell className={cn(bodyCell, monoRight)}>
                        {veh.edgeIndex}
                      </TableCell>
                      <TableCell className={bodyCell}>
                        <MiniBadge
                          bg={veh.status === 1 ? "linear-gradient(135deg, #10B981, #059669)" : "linear-gradient(135deg, #64748B, #475569)"}
                          fg="#fff"
                          shadow={veh.status === 1 ? "shadow-green-500/20" : "shadow-slate-500/20"}
                        >
                          {veh.status === 1 ? "MOVING" : veh.status === 2 ? "CHARGING" : veh.status === 3 ? "IDLE" : "UNKNOWN"}
                        </MiniBadge>
                      </TableCell>
                      <TableCell className={bodyCell}>
                        <button
                          onClick={() => handleVehicleClick(veh.id)}
                          className={cn(
                            "px-2 py-1 text-[10px] font-bold rounded transition-all duration-200",
                            followingVehicleId === veh.id
                              ? "bg-red-600 hover:bg-red-700 text-white"
                              : "bg-green-600 hover:bg-green-700 text-white"
                          )}
                        >
                          {followingVehicleId === veh.id ? "Unfollow" : "Follow"}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="border-0 bg-slate-800/80">
                    <TableCell
                      colSpan={8}
                      className="text-center text-xs text-slate-400 py-2 font-medium"
                    >
                      Total: {vehicles.length} active vehicles
                      {followingVehicleId !== null && ` | Following: Vehicle ${followingVehicleId}`}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </ScrollArea>
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
};

export default ConfigDataPanel;
