import {
  MenuLevel1Item,
  ICON_SIZE_MEDIUM,
} from "../shared";

// Shapez2-style PNG icons
import imgMapLoader from "@/assets/icons/game/menu-blueprint.svg";
import imgStatistics from "@/assets/icons/game/menu-sim.png";
import imgSearch from "@/assets/icons/game/sim-inspect.png";
import imgVehicle from "@/assets/icons/game/menu-trains.png";
import imgOperation from "@/assets/icons/game/menu-rotate.png";
import imgMapBuilder from "@/assets/icons/game/menu-train-tracks.png";
import imgLayoutBuilder from "@/assets/icons/game/menu-shapes.png";
import imgVisualization from "@/assets/icons/game/shape-stack.png";
import imgDataPanel from "@/assets/icons/game/special-label.png";
import imgDevTools from "@/assets/icons/game/menu-elec.png";

const PS = ICON_SIZE_MEDIUM + 6;

const pngIcon = (src: string, size = PS) => (
  <img src={src} alt="" width={size} height={size} style={{ imageRendering: "auto" }} draggable={false} />
);

// Group menu items by category
export const menuLevel1Groups: MenuLevel1Item[][] = [
  [
    {
      id: "MapLoader",
      label: "MapLoader",
      iconFn: () => pngIcon(imgMapLoader),
    },
  ],
  [
    {
      id: "Statistics",
      label: "Statistics",
      iconFn: () => pngIcon(imgStatistics),
    },
  ],
  [
    {
      id: "Search",
      label: "Search",
      shortcutLabel: "f",
      iconFn: () => pngIcon(imgSearch),
    },
  ],
  [
    {
      id: "Vehicle",
      label: "Vehicle",
      shortcutLabel: "v",
      iconFn: () => pngIcon(imgVehicle),
    },
    {
      id: "Operation",
      label: "Operation",
      iconFn: () => pngIcon(imgOperation),
    },
  ],
  [
    {
      id: "MapBuilder",
      label: "MapBuilder",
      iconFn: () => pngIcon(imgMapBuilder),
    },
    {
      id: "LayoutBuilder",
      label: "LayoutBuilder",
      iconFn: () => pngIcon(imgLayoutBuilder),
    },
  ],
  [
    {
      id: "Visualization",
      label: "Visualization",
      iconFn: () => pngIcon(imgVisualization),
    },
  ],
  [
    {
      id: "DataPanel",
      label: "DataPanel",
      iconFn: () => pngIcon(imgDataPanel),
    },
  ],
  [
    {
      id: "DevTools",
      label: "DevTools",
      shortcutLabel: "d",
      iconFn: () => pngIcon(imgDevTools),
    },
  ],
];
