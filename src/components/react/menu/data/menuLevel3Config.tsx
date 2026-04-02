// components/react/menu/data/menuLevel3Config.tsx
import { TransferMode } from "@store/vehicle/arrayMode/vehicleStore";

export interface MenuLevel3Item {
  id: string;
  label: string;
  shortcutLabel?: string;
  /** TransferMode value (for transfer mode items) */
  transferMode?: TransferMode;
}

/**
 * Level 3 menu items, keyed by parent Level 2 menu ID.
 */
export const menuLevel3Config: Record<string, MenuLevel3Item[]> = {
  "operation-menu-7": [
    { id: "transfer-1", label: "SIMPLE", shortcutLabel: "1", transferMode: TransferMode.SIMPLE_LOOP },
    { id: "transfer-2", label: "LOOP", shortcutLabel: "2", transferMode: TransferMode.LOOP },
    { id: "transfer-3", label: "RANDOM", shortcutLabel: "3", transferMode: TransferMode.RANDOM },
    { id: "transfer-4", label: "MQTT", shortcutLabel: "4", transferMode: TransferMode.MQTT_CONTROL },
    { id: "transfer-5", label: "AUTO", shortcutLabel: "5", transferMode: TransferMode.AUTO_ROUTE },
  ],
  "operation-menu-8": [
    { id: "params-movement", label: "Movement", shortcutLabel: "1" },
    { id: "params-lock", label: "Lock", shortcutLabel: "2" },
    { id: "params-routing", label: "Routing", shortcutLabel: "3" },
  ],
};
