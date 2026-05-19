// components/react/menu/data/menuLevel2Config.tsx
import {
  Timer,
  Circle,
} from "lucide-react";

// Shapez2-style PNG icons
import imgBlueprint from "@/assets/icons/game/menu-blueprint.svg";
import imgStationIn from "@/assets/icons/game/station-shape-in.png";

import imgSim from "@/assets/icons/game/menu-sim.png";

import imgGauge from "@/assets/icons/game/icon-gauge.svg";
import imgTrains from "@/assets/icons/game/menu-trains.png";
import imgRouting from "@/assets/icons/game/menu-routing.png";
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
      id: "stats-realtime",
      label: "Fab Stats",
      shortcutLabel: "r",
      iconFn: () => pngIcon(imgSim),
    },
    {
      id: "stats-db",
      label: "DB",
      shortcutLabel: "d",
      iconFn: () => pngIcon(imgLabel),
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
      id: "operation-menu-8",
      label: "Params",
      shortcutLabel: "p",
      iconFn: () => pngIcon(imgDevToolsGear),
    },
    {
      id: "operation-preset",
      label: "Preset",
      shortcutLabel: "r",
      iconFn: () => pngIcon(imgStationIn),
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
    {
      id: "vis-sensor-box",
      label: "Sensor Box",
      iconFn: () => pngIcon(imgTrains),
    },
    {
      id: "vis-fab-labels",
      label: "Fab Labels",
      iconFn: () => pngIcon(imgBlueprint),
    },
  ],
  DevTools: [
    {
      id: "devtools-lock",
      label: "Lock",
      shortcutLabel: "l",
      iconFn: () => pngIcon(imgSignal),
    },
    {
      id: "devtools-log-settings",
      label: "Log Settings",
      shortcutLabel: "g",
      iconFn: () => pngIcon(imgDevToolsGear),
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
