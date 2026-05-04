// Edge fragment shader - white fill + black border on long sides
// Uses fwidth-based anti-aliasing to prevent staircase artifacts at distance
uniform vec3 uColor;
uniform vec3 uSelectedColor;
uniform vec3 uBorderColor;
uniform float uBorderWidth;
uniform float uOpacity;

varying float vSelected;
varying vec2 vUv;

void main() {
    // vUv.y is across rail width: 0 = one long side, 1 = other long side
    float distFromEdge = min(vUv.y, 1.0 - vUv.y);

    // Screen-space gradient of vUv.y — small when close, large when far.
    // smoothstep transition adapts to pixel coverage so the border edge
    // gets one pixel of blend instead of a hard alias.
    float fw = fwidth(vUv.y);
    float aa = max(0.005, fw * 1.5);
    float borderMask = smoothstep(uBorderWidth - aa, uBorderWidth + aa, distFromEdge);

    vec3 fill = mix(uColor, uSelectedColor, vSelected);
    vec3 finalColor = mix(uBorderColor, fill, borderMask);

    // When the rail becomes sub-pixel, individual pixels would flicker
    // between black and white. Fade to area-weighted average instead.
    // fwidth(vUv.y) ≈ 1/pixelWidth, so 0.2 ~5px, 0.5 ~2px wide.
    float fillFraction = 1.0 - 2.0 * uBorderWidth;
    vec3 avgColor = uBorderColor * (2.0 * uBorderWidth) + fill * fillFraction;
    float farFade = smoothstep(0.15, 0.5, fw);
    finalColor = mix(finalColor, avgColor, farFade);

    gl_FragColor = vec4(finalColor, uOpacity);
}
