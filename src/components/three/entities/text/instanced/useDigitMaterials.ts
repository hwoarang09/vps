import { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";

// 0-9, N, E, V, H, _, F, A, B, S, T, L, O, P, C, D, I, K, G, M, R, U, W, X, Y, Z (26 letters + 10 digits + underscore)
export const ALL_CHARS = [
  "0","1","2","3","4","5","6","7","8","9",
  "A","B","C","D","E","F","G","H","I","J","K","L","M",
  "N","O","P","Q","R","S","T","U","V","W","X","Y","Z",
  "_","-",".",
] as const;
export const CHAR_COUNT = ALL_CHARS.length;

export const CHAR_MAP: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (const [index, char] of ALL_CHARS.entries()) {
    map[char] = index;
  }
  return map;
})();

export function textToDigits(text: string): number[] {
  return text.split("").map(c => CHAR_MAP[c.toUpperCase()] ?? 0);
}

interface DigitMaterialsOptions {
  color?: string;
  bgColor?: string;
  font?: string;
  size?: number;
}

export function useDigitMaterials({
  color = "#ffffff",
  bgColor = "transparent",
  font = "bold 96px system-ui, Roboto, Arial",
  size = 256,
}: DigitMaterialsOptions = {}) {
  const materials = useMemo(() => {
    return ALL_CHARS.map(char => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;

      ctx.clearRect(0, 0, size, size);
      if (bgColor !== "transparent") {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, size, size);
      }

      ctx.fillStyle = color;
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(char, size / 2, size / 2, size * 0.9);

      const tex = new THREE.Texture(canvas);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;

      return new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthTest: true,
        depthWrite: false,
      });
    });
  }, [color, bgColor, font, size]);

  // Cleanup materials and textures when component unmounts or deps change
  const ref = useRef(materials);
  useEffect(() => {
    const prevMaterials = ref.current;
    ref.current = materials;

    return () => {
      // Cleanup materials
      for (const mat of prevMaterials) {
        if (mat.map) {
          mat.map.dispose();
        }
        mat.dispose();
      }
    };
  }, [materials]);

  return materials;
}