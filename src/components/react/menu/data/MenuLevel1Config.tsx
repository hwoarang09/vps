import {
  MenuLevel1Item,
  ICON_SIZE_MEDIUM,
} from "../shared";

// Shapez2-style PNG icons

import imgStatistics from "@/assets/icons/game/menu-statistics.svg";
import imgSearch from "@/assets/icons/game/sim-inspect.svg";
import imgOperation from "@/assets/icons/game/menu-routing.png";
import imgMapBuilder from "@/assets/icons/game/menu-train-tracks.svg";
import imgLayoutBuilder from "@/assets/icons/game/menu-cut.png";
import imgVisualization from "@/assets/icons/game/shape-stack.png";
import imgDevTools from "@/assets/icons/game/menu-devtools-gear.svg";

const PS = ICON_SIZE_MEDIUM + 6;

const pngIcon = (src: string, size = PS) => (
  <img src={src} alt="" width={size} height={size} style={{ imageRendering: "auto" }} draggable={false} />
);

// Group menu items by category
export const menuLevel1Groups: MenuLevel1Item[][] = [
  [
    {
      id: "Operation",
      label: "Operation",
      shortcutLabel: "o",
      iconFn: () => pngIcon(imgOperation),
    },
  ],
  [
    {
      id: "Statistics",
      label: "Statistics",
      shortcutLabel: "s",
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
      id: "DevTools",
      label: "DevTools",
      shortcutLabel: "t",

      iconFn: () => pngIcon(imgDevTools),
    },
  ],
];
