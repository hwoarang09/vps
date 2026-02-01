// Edge vertex shader for InstancedMesh
uniform float uTime;
uniform float uLength;

attribute float aSelected;

varying vec3 vPosition;
varying float vProgress;
varying vec2 vUv;
varying float vSelected;

void main() {
    vPosition = position;
    vUv = uv;
    vSelected = aSelected;

    // Calculate progress along the edge (0.0 to 1.0)
    vProgress = (position.x + 0.5);

    // Apply instance matrix transformation
    vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
    vec4 modelPosition = modelMatrix * instancePosition;
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;

    gl_Position = projectedPosition;
}