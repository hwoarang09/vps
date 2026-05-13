import React, { useEffect, useState } from "react";
import ThreeScene from "./components/three/ThreeMain";
import MenuContainer from "@components/react/menu/MenuContainer";
import KeyboardShortcutHandler from "@components/react/system/KeyboardShortcutHandler";
import UnusualMoveModal from "@components/three/overlays/UnusualMoveModal";
import LoadingScreen from "@components/react/LoadingScreen";
import { initConfigFromDb } from "@/config/persistedConfig";
import { useLoadingStore } from "@store/ui/loadingStore";
import { useShmSimulatorStore } from "@store/vehicle/shmMode/shmSimulatorStore";
import { preloadMenuIcons } from "@/utils/preloadIcons";
import "./index.css";

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
      <LoadingScreen />
    </>
  );
};

export default App;
