import React, { useMemo } from "react";
import { useFabStore } from "@store/map/fabStore";
import { useVisualizationStore } from "@store/ui/visualizationStore";
import { useThemeStore } from "@store/ui/themeStore";
import InstancedText, { type TextGroup } from "../text/instanced/InstancedText";
import { textToDigits } from "../text/instanced/useDigitMaterials";
import { RENDER_ORDER_FAB_LABEL } from "@/utils/renderOrder";

/**
 * FabLabelRenderer
 * - Bay 라벨과 동일한 방식 (InstancedText, 바닥 flat)
 * - 각 Fab center에 "FAB0" + "C0-R1" 라벨 표시
 * - 높은 camHeightCutoff/lodDistance로 항상 보임
 */

const FAB_LABEL_SCALE = 30;
const FAB_SUBLABEL_SCALE = 15;
const FAB_Z = 5.0;
const FAB_LOD_DISTANCE = 99999;
const FAB_CAM_HEIGHT_CUTOFF = 99999;

const FabLabelRenderer: React.FC = () => {
  const showFabLabels = useVisualizationStore((s) => s.showFabLabels);
  const fabs = useFabStore((s) => s.fabs);
  const fabLabelColor = useThemeStore((s) => s.theme.textFabLabel);
  const fabSublabelColor = useThemeStore((s) => s.theme.textFabSublabel);

  // 메인 라벨: "FAB0", "FAB1", ...
  const mainGroups = useMemo((): TextGroup[] => {
    if (fabs.length <= 1) return [];
    return fabs.map((fab) => ({
      x: fab.centerX,
      y: fab.centerY,
      z: FAB_Z,
      digits: textToDigits(`FAB${fab.fabIndex}`),
    }));
  }, [fabs]);

  // 서브 라벨: "C0-R0", "C1-R0", ...  (col/row 명확 구분)
  const subGroups = useMemo((): TextGroup[] => {
    if (fabs.length <= 1) return [];
    // 메인 라벨 아래에 약간 offset (맵 Y 방향 = 아래)
    const yOffset = -(FAB_LABEL_SCALE * 1.2);
    return fabs.map((fab) => ({
      x: fab.centerX,
      y: fab.centerY + yOffset,
      z: FAB_Z,
      digits: textToDigits(`C${fab.col}-R${fab.row}`),
    }));
  }, [fabs]);

  if (!showFabLabels || mainGroups.length === 0) return null;

  return (
    <group name="fab-labels">
      <InstancedText
        groups={mainGroups}
        scale={FAB_LABEL_SCALE}
        color={fabLabelColor}
        lodDistance={FAB_LOD_DISTANCE}
        camHeightCutoff={FAB_CAM_HEIGHT_CUTOFF}
        billboard={false}
        opacity={0.9}
        renderOrder={RENDER_ORDER_FAB_LABEL}
      />
      <InstancedText
        groups={subGroups}
        scale={FAB_SUBLABEL_SCALE}
        color={fabSublabelColor}
        lodDistance={FAB_LOD_DISTANCE}
        camHeightCutoff={FAB_CAM_HEIGHT_CUTOFF}
        billboard={false}
        opacity={0.8}
        renderOrder={RENDER_ORDER_FAB_LABEL}
      />
    </group>
  );
};

export default FabLabelRenderer;
