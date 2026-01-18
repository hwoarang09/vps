import {
  TrainTrack,
  ChartPie,
  Car,
  ShipWheel,
  Folder,
  Table,
  Building,
  Wrench,
} from "lucide-react";
import {
  MenuLevel1Item,
  ACTIVE_STROKE_COLOR,
  INACTIVE_STROKE_COLOR,
  ACTIVE_FILL_COLOR,
  INACTIVE_FILL_COLOR,
  ICON_SIZE_MEDIUM,
} from "../shared";

// Group menu items by category
export const menuLevel1Groups: MenuLevel1Item[][] = [
  // Group 1: Map Loader
  [
    {
      id: "MapLoader",
      label: "MapLoader",
      iconFn: (isActive) => (
        <Folder
          size={ICON_SIZE_MEDIUM}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
  ],
  // Group 2: Statistics
  [
    {
      id: "Statistics",
      label: "Statistics",
      iconFn: (isActive) => (
        <ChartPie
          size={ICON_SIZE_MEDIUM}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
  ],
  // Group 3: Vehicle & Operation
  [
    {
      id: "Vehicle",
      label: "Vehicle",
      shortcutLabel: "v",
      iconFn: (isActive) => (
        <Car
          size={ICON_SIZE_MEDIUM}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "Operation",
      label: "Operation",
      iconFn: (isActive) => (
        <ShipWheel
          size={ICON_SIZE_MEDIUM}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 1.5,
          }}
        />
      ),
    },
  ],
  // Group 4: MapBuilder & LayoutBuilder
  [
    {
      id: "MapBuilder",
      label: "MapBuilder",
      iconFn: (isActive) => (
        <TrainTrack
          size={ICON_SIZE_MEDIUM}
          style={{
            fill: isActive ? ACTIVE_FILL_COLOR : INACTIVE_FILL_COLOR,
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 1.5,
          }}
        />
      ),
    },
    {
      id: "LayoutBuilder",
      label: "LayoutBuilder",
      iconFn: (isActive) => (
        <Building
          size={ICON_SIZE_MEDIUM}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 1.5,
          }}
        />
      ),
    },
  ],
  // Group 5: Debug
  [
    {
      id: "DataPanel",
      label: "DataPanel",
      iconFn: (isActive) => (
        <Table
          size={ICON_SIZE_MEDIUM}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
  ],
  // Group 6: DevTools
  [
    {
      id: "DevTools",
      label: "DevTools",
      shortcutLabel: "d",
      iconFn: (isActive) => (
        <Wrench
          size={ICON_SIZE_MEDIUM}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
  ],
];
