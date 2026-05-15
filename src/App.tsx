import React, { useEffect, useState } from "react";
import ThreeScene from "./components/three/ThreeMain";
import MenuContainer from "@components/react/menu/MenuContainer";
import KeyboardShortcutHandler from "@components/react/system/KeyboardShortcutHandler";
import UnusualMoveModal from "@components/three/overlays/UnusualMoveModal";
import LoadingScreen from "@components/react/LoadingScreen";
import IconWarmCache from "@components/react/IconWarmCache";
import { initConfigFromDb } from "@/config/persistedConfig";
import { useLoadingStore } from "@store/ui/loadingStore";
import { useShmSimulatorStore } from "@store/vehicle/shmMode/shmSimulatorStore";
import { useCameraStore } from "@store/ui/cameraStore";
import { useFabStore } from "@store/map/fabStore";
import { preloadMenuIcons } from "@/utils/preloadIcons";
import { Analytics } from "@vercel/analytics/react";
import "./index.css";

const focusCameraOnFabZero = () => {
  const fabs = useFabStore.getState().fabs;
  if (fabs.length === 0) return;
  const fab0 = fabs[0];
  const spanX = fab0.xMax - fab0.xMin;
  const spanY = fab0.yMax - fab0.yMin;
  const span = Math.max(spanX, spanY, 10);
  // Top-down view, 살짝 남쪽으로 기울여서 입체감
  const height = span * 0.7;
  const tilt = span * 0.15;
  useCameraStore.getState().setCameraView(
    [fab0.centerX, fab0.centerY - tilt, height],
    [fab0.centerX, fab0.centerY, 0],
  );
};

const App: React.FC = () => {
  const [configReady, setConfigReady] = useState(false);
  const isShmInitialized = useShmSimulatorStore((s) => s.isInitialized);

  useEffect(() => {
    initConfigFromDb().then(() => {
      setConfigReady(true);
      useLoadingStore.getState().setConfigReady();
    });
  }, []);

  useEffect(() => {
    preloadMenuIcons().then(() => {
      useLoadingStore.getState().setIconsLoaded();
    });
  }, []);

  useEffect(() => {
    if (isShmInitialized) {
      focusCameraOnFabZero();
      useLoadingStore.getState().setAllReady();
    }
  }, [isShmInitialized]);

  return (
    <>
      {configReady && (
        <div className="relative w-screen h-screen">
          <KeyboardShortcutHandler />
          <MenuContainer />
          <ThreeScene />
          <UnusualMoveModal />
        </div>
      )}
      <IconWarmCache />
      <LoadingScreen />
      <Analytics />
    </>
  );
};

export default App;
