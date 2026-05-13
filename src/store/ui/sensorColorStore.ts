import { create } from "zustand";
import { persist } from "zustand/middleware";

const DEFAULT_BODY = "#00ffff";
const DEFAULT_ZONE0 = "#ffff00";
const DEFAULT_ZONE1 = "#ff8800";
const DEFAULT_ZONE2 = "#ff0000";

interface SensorColorStore {
  bodyColor: string;
  zone0Color: string;
  zone1Color: string;
  zone2Color: string;
  setBodyColor: (hex: string) => void;
  setZone0Color: (hex: string) => void;
  setZone1Color: (hex: string) => void;
  setZone2Color: (hex: string) => void;
  reset: () => void;
}

export const useSensorColorStore = create<SensorColorStore>()(
  persist(
    (set) => ({
      bodyColor: DEFAULT_BODY,
      zone0Color: DEFAULT_ZONE0,
      zone1Color: DEFAULT_ZONE1,
      zone2Color: DEFAULT_ZONE2,
      setBodyColor: (hex) => set({ bodyColor: hex }),
      setZone0Color: (hex) => set({ zone0Color: hex }),
      setZone1Color: (hex) => set({ zone1Color: hex }),
      setZone2Color: (hex) => set({ zone2Color: hex }),
      reset: () =>
        set({
          bodyColor: DEFAULT_BODY,
          zone0Color: DEFAULT_ZONE0,
          zone1Color: DEFAULT_ZONE1,
          zone2Color: DEFAULT_ZONE2,
        }),
    }),
    { name: "vps-sensor-colors" },
  ),
);
