// components/react/menu/data/menuLevel2Config.tsx
import {
  TrendingUp,
  Calendar,
  BarChart3,
  CalendarDays,
  Zap,
  FileText,
  Map,
  Timer,
  Eye,
  Bell,
  FileCheck,
  Waves,
  Hash,
  Shuffle,
  Building2,
  Cog,
  FolderOpen,
  Download,
  Upload,
  Square,
  Lock,
  Car,
  Circle,
  GitBranch,
  MapPin,
} from "lucide-react";
import { ReactComponent as Curve180Icon } from "@/assets/icons/curve180.svg";
import { ReactComponent as Curve90Icon } from "@/assets/icons/curve90.svg";
import { ReactComponent as StrmapIcon } from "@/assets/icons/str_edge.svg";
import { ReactComponent as RMapIcon } from "@/assets/icons/r_edge.svg";

import {
  MenuLevel2Item,
  ACTIVE_STROKE_COLOR,
  INACTIVE_STROKE_COLOR,
  ACTIVE_FILL_COLOR,
  INACTIVE_FILL_COLOR,
  ICON_SIZE_LARGE,
  ICON_SIZE_SMALL,
} from "../shared";

export const menuLevel2Config: Record<string, MenuLevel2Item[]> = {
  MapLoader: [
    {
      id: "maploader-menu-1",
      label: "Load CFG",
      iconFn: (isActive) => (
        <FolderOpen
          size={ICON_SIZE_SMALL}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "maploader-menu-2",
      label: "Import",
      iconFn: (isActive) => (
        <Download
          size={ICON_SIZE_SMALL}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "maploader-menu-3",
      label: "Export",
      iconFn: (isActive) => (
        <Upload
          size={ICON_SIZE_SMALL}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
  ],
  Statistics: [
    {
      id: "stats-menu-1",
      label: "Realtime",
      iconFn: (isActive: boolean) => (
        <TrendingUp
          size={ICON_SIZE_LARGE}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "stats-menu-2",
      label: "Daily",
      iconFn: (isActive: boolean) => (
        <Calendar
          size={36}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "stats-menu-3",
      label: "Weekly",
      iconFn: (isActive: boolean) => (
        <BarChart3
          size={36}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "stats-menu-4",
      label: "Monthly",
      iconFn: (isActive: boolean) => (
        <CalendarDays
          size={36}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "stats-menu-5",
      label: "Performance",
      iconFn: (isActive: boolean) => (
        <Zap
          size={36}
          style={{
            fill: isActive ? ACTIVE_FILL_COLOR : INACTIVE_FILL_COLOR,
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 1,
          }}
        />
      ),
    },
  ],
  Vehicle: [
    {
      id: "vehicle-menu-overall",
      label: "Overall Status",
      iconFn: (isActive: boolean) => (
        <BarChart3
          size={36}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "vehicle-menu-history",
      label: "History",
      iconFn: (isActive: boolean) => (
        <FileText
          size={36}
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
      id: "operation-menu-1",
      label: "Routes",
      iconFn: (isActive: boolean) => (
        <Map
          size={36}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "operation-menu-2",
      label: "Schedule",
      iconFn: (isActive: boolean) => (
        <Timer
          size={36}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "operation-menu-3",
      label: "Monitor",
      iconFn: (isActive: boolean) => (
        <Eye
          size={36}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "operation-menu-4",
      label: "Alerts",
      iconFn: (isActive: boolean) => (
        <Bell
          size={36}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "operation-menu-5",
      label: "Logs",
      iconFn: (isActive: boolean) => (
        <FileCheck
          size={36}
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
        <Waves
          size={36}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "map-menu-5",
      label: "H Shape",
      iconFn: (isActive: boolean) => (
        <Hash
          size={36}
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
          // size={36}
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
          size={36}
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
          size={36}
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
          size={36}
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
          size={36}
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
      iconFn: (isActive: boolean) => (
        <Building2
          size={36}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "layout-menu-3",
      label: "Equipment Builder",
      iconFn: (isActive: boolean) => (
        <Cog
          size={36}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
  ],
  DevTools: [
    {
      id: "devtools-lock",
      label: "Lock",
      shortcutLabel: "l",
      iconFn: (isActive: boolean) => (
        <Lock
          size={ICON_SIZE_LARGE}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
  ],
  Search: [
    {
      id: "search-vehicle",
      label: "Vehicle",
      shortcutLabel: "v",
      iconFn: (isActive: boolean) => (
        <Car
          size={ICON_SIZE_LARGE}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
    {
      id: "search-node",
      label: "Node",
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
      id: "search-edge",
      label: "Edge",
      shortcutLabel: "e",
      iconFn: (isActive: boolean) => (
        <GitBranch
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
      label: "Station",
      shortcutLabel: "s",
      iconFn: (isActive: boolean) => (
        <MapPin
          size={ICON_SIZE_LARGE}
          style={{
            stroke: isActive ? ACTIVE_STROKE_COLOR : INACTIVE_STROKE_COLOR,
            strokeWidth: 2,
          }}
        />
      ),
    },
  ],
};
