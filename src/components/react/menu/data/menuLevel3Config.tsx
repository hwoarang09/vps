// components/react/menu/data/menuLevel3Config.tsx
export interface MenuLevel3Item {
  id: string;
  label: string;
  shortcutLabel?: string;
}

/**
 * Level 3 menu items, keyed by parent Level 2 menu ID.
 */
export const menuLevel3Config: Record<string, MenuLevel3Item[]> = {
  "operation-menu-8": [
    { id: "params-movement", label: "Movement", shortcutLabel: "1" },
    { id: "params-lock", label: "Lock", shortcutLabel: "2" },
    { id: "params-routing", label: "Routing", shortcutLabel: "3" },
    { id: "params-mode", label: "Mode", shortcutLabel: "4" },
  ],
};
