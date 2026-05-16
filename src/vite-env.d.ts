/// <reference types="vite/client" />
/// <reference types="@react-three/fiber" />
declare module "*.svg" {
  import * as React from "react";
  export const ReactComponent: React.FC<React.SVGProps<SVGSVGElement>>;
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.glsl?raw" {
  const content: string;
  export default content;
}

declare module "*.glsl" {
  const content: string;
  export default content;
}

// 빌드 시 vite define 으로 주입되는 package.json version
declare const __APP_VERSION__: string;

// Global window extensions
interface Window {
  vehicleDataArray?: any;
  vehicleSharedMovement?: any;
}
