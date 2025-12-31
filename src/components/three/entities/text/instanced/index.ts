export { default as InstancedText } from "./InstancedText";
export { default as VehicleTextRenderer } from "./VehicleTextRenderer";
export { default as MapTextRenderer } from "./MapTextRenderer";

export { useDigitMaterials, textToDigits, CHAR_MAP, CHAR_COUNT, ALL_CHARS } from "./useDigitMaterials";
export {
  HIDE_MATRIX,
  buildSlotData,
  applyHighAltitudeCulling,
  updateBillboardRotation,
  type TextGroup,
  type SlotData,
} from "./instancedTextUtils";