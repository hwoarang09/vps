// components/react/menu/data/commands.ts
import { useMenuStore } from "@/store/ui/menuStore";
import { useVisualizationStore } from "@/store/ui/visualizationStore";
import { useFabStore } from "@/store/map/fabStore";
import { useCameraStore } from "@/store/ui/cameraStore";
import { menuLevel2Config } from "./menuLevel2Config";
import { menuLevel3Config } from "./menuLevel3Config";
import { menuLevel1Groups } from "./MenuLevel1Config";

export interface Command {
  id: string;
  label: string;
  keywords?: string[];
  section: "navigation" | "visualization" | "fab" | "simulation";
  run: () => void;
}

/** Direct-toggle visualization menu IDs — these skip the normal panel flow */
const VIS_DIRECT_TOGGLES: Record<string, () => void> = {
  "vis-performance": () => {
    const s = useVisualizationStore.getState();
    s.togglePerfLeft();
    s.togglePerfRight();
  },
  "vis-sensor-box": () => {
    useVisualizationStore.getState().toggleSensorBox();
  },
  "vis-fab-labels": () => {
    useVisualizationStore.getState().toggleFabLabels();
  },
};

/**
 * Navigate to a Level 2 menu item — replicates MenuLevel2.handleLevel2MenuClick
 * but driven entirely from store calls.
 */
function navigateToSubMenu(mainMenuId: string, subMenuId: string): void {
  const ms = useMenuStore.getState();
  ms.setActiveMainMenu(mainMenuId as any);
  ms.setActiveSubMenu(subMenuId);

  const hasL3 = subMenuId in menuLevel3Config;
  const noRightPanel =
    hasL3 ||
    subMenuId === "operation-menu-2" ||
    subMenuId === "stats-realtime" ||
    subMenuId === "stats-db" ||
    subMenuId.startsWith("test-");

  if (hasL3) {
    ms.setActiveThirdMenu(menuLevel3Config[subMenuId][0].id);
  } else if (!noRightPanel) {
    ms.setRightPanelOpen(true);
  }
}

/**
 * Build the full command list from menu configs + fab switcher + visualization toggles.
 * Called once per palette open (cheap — no hooks needed).
 */
export function buildCommands(): Command[] {
  const commands: Command[] = [];

  // ── Level 1 → Level 2 menu items ──
  for (const group of menuLevel1Groups) {
    for (const l1 of group) {
      const l2Items = menuLevel2Config[l1.id];
      if (!l2Items) continue;

      for (const l2 of l2Items) {
        const directToggle = VIS_DIRECT_TOGGLES[l2.id];

        commands.push({
          id: l2.id,
          label: `${l1.label} > ${l2.label}`,
          keywords: [l1.label, l2.label, l2.id],
          section: directToggle !== undefined ? "visualization" : "navigation",
          run: directToggle ?? (() => navigateToSubMenu(l1.id, l2.id)),
        });

        // ── Level 3 sub-items ──
        const l3Items = menuLevel3Config[l2.id];
        if (l3Items) {
          for (const l3 of l3Items) {
            commands.push({
              id: l3.id,
              label: `${l1.label} > ${l2.label} > ${l3.label}`,
              keywords: [l1.label, l2.label, l3.label, l3.id],
              section: "navigation",
              run: () => {
                navigateToSubMenu(l1.id, l2.id);
                useMenuStore.getState().setActiveThirdMenu(l3.id);
              },
            });
          }
        }
      }
    }
  }

  // ── Fab switcher ──
  const { fabs } = useFabStore.getState();
  for (let i = 0; i < fabs.length; i++) {
    const fab = fabs[i];
    commands.push({
      id: `fab-switch-${i}`,
      label: `Switch to FAB ${fab.fabIndex}`,
      keywords: ["fab", "switch", String(fab.fabIndex)],
      section: "fab",
      run: () => {
        const { fabs: curFabs, activeFabIndex: curIdx, setActiveFabIndex: setIdx } =
          useFabStore.getState();
        const prevFab = curFabs[curIdx];
        setIdx(i);
        const nextFab = curFabs[i];
        if (nextFab && prevFab) {
          const dx = nextFab.centerX - prevFab.centerX;
          const dy = nextFab.centerY - prevFab.centerY;
          const { position: p, target: t, setCameraView } = useCameraStore.getState();
          setCameraView([p.x + dx, p.y + dy, p.z], [t.x + dx, t.y + dy, t.z]);
        }
      },
    });
  }

  // ── Standalone visualization toggles (also reachable via menu, but nice for search) ──
  commands.push({
    id: "toggle-performance",
    label: "Toggle Performance Monitor",
    keywords: ["perf", "performance", "fps", "monitor"],
    section: "visualization",
    run: VIS_DIRECT_TOGGLES["vis-performance"],
  });
  commands.push({
    id: "toggle-sensor-box",
    label: "Toggle Sensor Box",
    keywords: ["sensor", "box", "collision"],
    section: "visualization",
    run: VIS_DIRECT_TOGGLES["vis-sensor-box"],
  });
  commands.push({
    id: "toggle-fab-labels",
    label: "Toggle Fab Labels",
    keywords: ["fab", "label", "labels"],
    section: "visualization",
    run: VIS_DIRECT_TOGGLES["vis-fab-labels"],
  });

  return commands;
}
