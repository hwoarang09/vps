// Edge fragment shader - 선택 상태 지원
uniform vec3 uColor;
uniform vec3 uSelectedColor;
uniform float uOpacity;

varying float vSelected;

void main() {
    vec3 finalColor = mix(uColor, uSelectedColor, vSelected);
    gl_FragColor = vec4(finalColor, uOpacity);
}