// components/react/menu/data/menuLevel2Config.tsx
import {
  CalendarDays,
  Timer,
  FileCheck,
  Hash,
  Shuffle,
  Building2,
  Cog,
  Square,
  Circle,
} from "lucide-react";
import { ReactComponent as Curve180Icon } from "@/assets/icons/curve180.svg";
import { ReactComponent as Curve90Icon } from "@/assets/icons/curve90.svg";
import { ReactComponent as StrmapIcon } from "@/assets/icons/str_edge.svg";
import { ReactComponent as RMapIcon } from "@/assets/icons/r_edge.svg";

// Shapez2-style PNG icons
import imgBlueprint from "@/assets/icons/game/menu-blueprint.svg";
import imgStationIn from "@/assets/icons/game/station-shape-in.png";

import imgSim from "@/assets/icons/game/menu-sim.png";

import imgGauge from "@/assets/icons/game/icon-gauge.svg";
import imgTrains from "@/assets/icons/game/menu-trains.png";
import imgRouting from "@/assets/icons/game/menu-routing.png";
import imgInspect from "@/assets/icons/game/sim-inspect.svg";
import imgSignal from "@/assets/icons/game/signal-wait-stop.png";
import imgLabel from "@/assets/icons/game/special-label.png";
import imgFluids from "@/assets/icons/game/menu-fluids.png";
import imgTracks from "@/assets/icons/game/menu-train-tracks.svg";
import imgDevToolsGear from "@/assets/icons/game/menu-devtools-gear.svg";

import {
  MenuLevel2Item,
  ACTIVE_STROKE_COLOR,
  INACTIVE_STROKE_COLOR,
  ICON_SIZE_LARGE,
} from "../shared";

const PS = 38; // PNG icon size for LV2

const pngIcon = (src: string, size = PS) => (
  <img src={src} alt="" width={size} height={size} style={{ imageRendering: "auto" }} draggable={false} />
);

export const menuLevel2Config: Record<string, MenuLevel2Item[]> = {
  Statistics: [
    {
      id: "stats-menu-1",
      label: "Realtime",

      iconFn: () => pngIcon(imgSim),
    },
    {
      id: "stats-menu-2",
      label: "Report",

      iconFn: (isActive: boolean) => (
        <CalendarDays
          size={ICON_SIZE_LARGE}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
  ],
  Operation: [
    {
      id: "operation-menu-6",
      label: "Layout",
      shortcutLabel: "l",
      iconFn: () => pngIcon(imgBlueprint),
    },
    {
      id: "operation-menu-7",
      label: "Transfer",
      shortcutLabel: "m",
      iconFn: () => pngIcon(imgRouting),
    },
    {
      id: "operation-menu-8",
      label: "Params",
      shortcutLabel: "p",
      iconFn: () => pngIcon(imgDevToolsGear),
    },
    {
      id: "operation-menu-2",
      label: "Schedule",
      iconFn: (isActive: boolean) => (
        <Timer
          size={ICON_SIZE_LARGE}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "operation-menu-1",
      label: "Routes",
      iconFn: () => pngIcon(imgRouting),
    },
    {
      id: "operation-menu-3",
      label: "Monitor",
      iconFn: () => pngIcon(imgInspect),
    },
    {
      id: "operation-menu-4",
      label: "Alerts",
      iconFn: () => pngIcon(imgSignal),
    },
    {
      id: "operation-menu-5",
      label: "Logs",
      iconFn: (isActive: boolean) => (
        <FileCheck
          size={ICON_SIZE_LARGE}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
  ],
  MapBuilder: [
    {
      id: "map-menu-1",
      label: "Straight",
      iconFn: (isActive: boolean) => (
        <StrmapIcon
          width={40}
          height={40}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            fill: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "map-menu-2",
      label: "90° Curve",
      iconFn: (isActive: boolean) => (
        <Curve90Icon
          width={40}
          height={40}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            fill: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "map-menu-3",
      label: "180° Curve",
      iconFn: (isActive: boolean) => (
        <Curve180Icon
          width={36}
          height={36}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            fill: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "map-menu-4",
      label: "S Curve",
      iconFn: (isActive: boolean) => (
        <StrmapIcon
          width={40}
          height={40}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            fill: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
            transform: "rotate(30deg)",
          }}
        />
      ),
    },
    {
      id: "map-menu-5",
      label: "H Shape",
      iconFn: (isActive: boolean) => (
        <Hash
          size={ICON_SIZE_LARGE}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "map-menu-6",
      label: "R Shape",
      iconFn: (isActive: boolean) => (
        <RMapIcon
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "map-menu-7",
      label: "Junction",
      iconFn: (isActive: boolean) => (
        <Shuffle
          size={ICON_SIZE_LARGE}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "map-menu-8",
      label: "Bridge",
      iconFn: (isActive: boolean) => (
        <Building2
          size={ICON_SIZE_LARGE}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "map-menu-9",
      label: "Custom",
      iconFn: (isActive: boolean) => (
        <Cog
          size={ICON_SIZE_LARGE}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
  ],
  LayoutBuilder: [
    {
      id: "layout-menu-1",
      label: "Bay Builder",
      iconFn: (isActive: boolean) => (
        <Square
          size={ICON_SIZE_LARGE}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "layout-menu-2",
      label: "Station Builder",
      iconFn: () => pngIcon(imgStationIn),
    },
    {
      id: "layout-menu-3",
      label: "Equipment Builder",
      iconFn: (isActive: boolean) => (
        <Cog
          size={ICON_SIZE_LARGE}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
  ],
  Visualization: [
    {
      id: "vis-performance",
      label: "Performance",
      iconFn: () => pngIcon(imgGauge),
    },
    {
      id: "vis-bay-label",
      label: "Bay Label",
      iconFn: () => pngIcon(imgLabel),
    },
    {
      id: "vis-heatmap",
      label: "Heatmap",
      iconFn: () => pngIcon(imgFluids),
    },
    {
      id: "vis-traffic-flow",
      label: "Traffic Flow",
      iconFn: () => pngIcon(imgRouting),
    },
    {
      id: "vis-deadlock-zone",
      label: "Deadlock Zone",
      iconFn: () => pngIcon(imgSignal),
    },
  ],
  DevTools: [
    {
      id: "devtools-lock",
      label: "Lock",
      shortcutLabel: "l",
      iconFn: () => pngIcon(imgSignal),
    },
  ],
  Search: [
    {
      id: "search-vehicle",
      label: "Vehicle Search",
      shortcutLabel: "v",
      iconFn: () => pngIcon(imgTrains),
    },
    {
      id: "search-edge",
      label: "Edge Search",
      shortcutLabel: "e",
      iconFn: () => pngIcon(imgTracks),
    },
    {
      id: "search-node",
      label: "Node Search",
      shortcutLabel: "n",
      iconFn: (isActive: boolean) => (
        <Circle
          size={ICON_SIZE_LARGE}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "search-station",
      label: "Station Search",
      shortcutLabel: "s",
      iconFn: () => pngIcon(imgStationIn),
    },
  ],
};
