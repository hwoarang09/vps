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
  "stats-history": [
    { id: "history-vehicle", label: "Vehicle", shortcutLabel: "1" },
    { id: "history-transfer", label: "Transfer", shortcutLabel: "2" },
    { id: "history-lock", label: "Lock", shortcutLabel: "3" },
    { id: "history-replay", label: "Replay", shortcutLabel: "4" },
  ],
  "operation-menu-7": [
    { id: "transfer-1", label: "SIMPLE", shortcutLabel: "1", transferMode: TransferMode.SIMPLE_LOOP },
    { id: "transfer-2", label: "LOOP", shortcutLabel: "2", transferMode: TransferMode.LOOP },
    { id: "transfer-3", label: "RANDOM", shortcutLabel: "3", transferMode: TransferMode.RANDOM },
    { id: "transfer-4", label: "MQTT", shortcutLabel: "4", transferMode: TransferMode.MQTT_CONTROL },
    { id: "transfer-5", label: "AUTO", shortcutLabel: "5", transferMode: TransferMode.AUTO_ROUTE },
  ],
};
