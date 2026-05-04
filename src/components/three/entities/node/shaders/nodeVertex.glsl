// nodeVertex.glsl
uniform float uTime;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);

    float pulse = sin(uTime * 2.0) * 0.05 + 1.0;
    vec3 scaledPosition = position * pulse;

    // Apply per-instance transform — without this, every instance collapses
    // to local origin, rendering as a single pulsing red blob at world (0,0,0).
    vec4 instancePos = instanceMatrix * vec4(scaledPosition, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * instancePos;
    vPosition = instancePos.xyz;
}
