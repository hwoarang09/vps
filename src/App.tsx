import React from "react";
import ThreeScene from "./components/three/ThreeMain";
import MenuContainer from "@components/react/menu/MenuContainer";
import KeyboardShortcutHandler from "@components/react/system/KeyboardShortcutHandler";
import UnusualMoveModal from "@components/three/overlays/UnusualMoveModal";
import "./index.css";

const App: React.FC = () => (
  <div className="relative w-screen h-screen">
    <KeyboardShortcutHandler />
    <MenuContainer />
    <ThreeScene />
    <UnusualMoveModal />
  </div>
);

export default App;
