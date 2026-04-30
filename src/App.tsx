import React, { useEffect, useState } from "react";
import ThreeScene from "./components/three/ThreeMain";
import MenuContainer from "@components/react/menu/MenuContainer";
import KeyboardShortcutHandler from "@components/react/system/KeyboardShortcutHandler";
import UnusualMoveModal from "@components/three/overlays/UnusualMoveModal";
import { initConfigFromDb } from "@/config/persistedConfig";
import "./index.css";

const App: React.FC = () => {
  const [configReady, setConfigReady] = useState(false);

  useEffect(() => {
    initConfigFromDb().then(() => setConfigReady(true));
  }, []);

  if (!configReady) return null;

  return (
    <div className="relative w-screen h-screen">
      <KeyboardShortcutHandler />
      <MenuContainer />
      <ThreeScene />
      <UnusualMoveModal />
    </div>
  );
};

export default App;
