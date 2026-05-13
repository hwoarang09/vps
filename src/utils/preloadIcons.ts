import imgStatistics from "@/assets/icons/game/menu-statistics.svg";
import imgSearch from "@/assets/icons/game/sim-inspect.svg";
import imgOperation from "@/assets/icons/game/menu-routing.png";
import imgVisualization from "@/assets/icons/game/shape-stack.png";
import imgDevTools from "@/assets/icons/game/menu-devtools-gear.svg";
import imgBlueprint from "@/assets/icons/game/menu-blueprint.svg";
import imgStationIn from "@/assets/icons/game/station-shape-in.png";
import imgSim from "@/assets/icons/game/menu-sim.png";
import imgGauge from "@/assets/icons/game/icon-gauge.svg";
import imgTrains from "@/assets/icons/game/menu-trains.png";
import imgSignal from "@/assets/icons/game/signal-wait-stop.png";
import imgLabel from "@/assets/icons/game/special-label.png";
import imgFluids from "@/assets/icons/game/menu-fluids.png";
import imgTracks from "@/assets/icons/game/menu-train-tracks.svg";

const MENU_ICON_URLS = [
  imgStatistics,
  imgSearch,
  imgOperation,
  imgVisualization,
  imgDevTools,
  imgBlueprint,
  imgStationIn,
  imgSim,
  imgGauge,
  imgTrains,
  imgSignal,
  imgLabel,
  imgFluids,
  imgTracks,
];

export function preloadMenuIcons(): Promise<void> {
  return Promise.all(
    MENU_ICON_URLS.map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = src;
        }),
    ),
  ).then(() => undefined);
}
