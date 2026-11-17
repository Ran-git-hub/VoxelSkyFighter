import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";

const SAMPLES = 40;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Marches from each pixel toward the light and counts how much open sky lies
// on the way, so anything in front of the sun (clouds, ridges) carves shafts.
const occlusionShader = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uLight;
uniform float uAspect;
varying vec2 vUv;

void main() {
  vec2 stride = (uLight - vUv) * (0.92 / float(${SAMPLES}));
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec2 uv = vUv + stride * jitter;
  float light = 0.0;
  float decay = 1.0;
  for (int i = 0; i < ${SAMPLES}; i += 1) {
    vec2 toLight = (uv - uLight) * vec2(uAspect, 1.0);
    float sky = step(1.0, texture2D(tDepth, clamp(uv, 0.0, 1.0)).x);
    light += sky * decay / (1.0 + dot(toLight, toLight) * 7.0);
    decay *= 0.975;
    uv += stride;
  }
  gl_FragColor = vec4(vec3(light / float(${SAMPLES})), 1.0);
}
`;

const compositeShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tRays;
uniform sampler2D tDepth;
uniform vec3 uColor;
uniform vec3 uTint;
uniform vec2 uLight;
uniform float uAspect;
uniform float uFlare;
varying vec2 vUv;

// Lens ghosts are squares, in keeping with a world made of blocks.
float ghost(vec2 centre, float size) {
  vec2 d = abs((vUv - centre) * vec2(uAspect, 1.0));
  float m = max(d.x, d.y);
  return (1.0 - smoothstep(size * 0.85, size, m)) * (0.45 + 0.55 * smoothstep(size * 0.55, size * 0.85, m));
}

void main() {
  vec4 scene = texture2D(tDiffuse, vUv);
  vec3 color = scene.rgb + uColor * texture2D(tRays, vUv).r;
  if (uFlare > 0.0) {
    // The flare dies as soon as something covers the light itself.
    float visible = 0.0;
    for (int i = 0; i < 5; i += 1) {
      vec2 tap = uLight + vec2(float(i - 2) * 0.006, float(i == 2 ? 0 : (i < 2 ? 1 : -1)) * 0.006);
      visible += step(1.0, texture2D(tDepth, clamp(tap, 0.0, 1.0)).x);
    }
    visible *= 0.2;
    vec2 axis = vec2(0.5) - uLight;
    vec3 flare = ghost(uLight + axis * 0.55, 0.018) * vec3(1.0, 0.75, 0.4) * 0.5;
    flare += ghost(uLight + axis * 0.9, 0.04) * vec3(0.4, 0.9, 0.6) * 0.22;
    flare += ghost(uLight + axis * 1.3, 0.026) * vec3(0.5, 0.6, 1.0) * 0.4;
    flare += ghost(uLight + axis * 1.7, 0.07) * vec3(1.0, 0.5, 0.7) * 0.16;
    flare += ghost(uLight + axis * 2.15, 0.12) * vec3(0.5, 0.7, 1.0) * 0.1;
    vec2 d = (vUv - uLight) * vec2(uAspect, 1.0);
    flare += vec3(0.7, 0.85, 1.0) * exp(-abs(d.y) * 140.0) * exp(-abs(d.x) * 2.6) * 0.45;
    flare += uTint * exp(-dot(d, d) * 30.0) * 0.2;
    color += flare * uFlare * visible;
  }
  gl_FragColor = vec4(color, scene.a);
}
`;

const point = new THREE.Vector3();
const forward = new THREE.Vector3();

export class GodRayPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.direction = new THREE.Vector3(0, 1, 0);
    this.color = new THREE.Color(1, 1, 1);
    this.strength = 0;
    this.flare = 0;
    this.raysTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.occlusion = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, uLight: { value: new THREE.Vector2() }, uAspect: { value: 1 } },
      vertexShader,
      fragmentShader: occlusionShader,
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tRays: { value: this.raysTarget.texture },
        tDepth: { value: null },
        uColor: { value: new THREE.Color() },
        uTint: { value: new THREE.Color() },
        uLight: { value: new THREE.Vector2() },
        uAspect: { value: 1 },
        uFlare: { value: 0 },
      },
      vertexShader,
      fragmentShader: compositeShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.occlusion);
  }

  setSize(width, height) {
    this.raysTarget.setSize(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)));
    this.occlusion.uniforms.uAspect.value = width / Math.max(1, height);
    this.composite.uniforms.uAspect.value = width / Math.max(1, height);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.camera.getWorldDirection(forward);
    const facing = forward.dot(this.direction);
    point.copy(this.camera.position).addScaledVector(this.direction, 1000).project(this.camera);
    const offscreen = Math.max(Math.abs(point.x), Math.abs(point.y));
    const strength = this.strength * THREE.MathUtils.smoothstep(facing, 0.1, 0.45) * (1 - THREE.MathUtils.smoothstep(offscreen, 1.1, 2.4));
    // Leaving the buffers unswapped makes the pass free when the light is behind the camera.
    const flare = facing > 0 ? this.flare * (1 - THREE.MathUtils.smoothstep(offscreen, 0.85, 1.1)) : 0;
    this.needsSwap = strength > 0.002 || flare > 0.002;
    if (!this.needsSwap) {
      return;
    }

    this.occlusion.uniforms.tDepth.value = readBuffer.depthTexture;
    this.occlusion.uniforms.uLight.value.set(point.x * 0.5 + 0.5, point.y * 0.5 + 0.5);
    this.quad.material = this.occlusion;
    renderer.setRenderTarget(this.raysTarget);
    this.quad.render(renderer);

    this.composite.uniforms.tDiffuse.value = readBuffer.texture;
    this.composite.uniforms.uColor.value.copy(this.color).multiplyScalar(strength);
    this.composite.uniforms.uTint.value.copy(this.color);
    this.composite.uniforms.tDepth.value = readBuffer.depthTexture;
    this.composite.uniforms.uLight.value.copy(this.occlusion.uniforms.uLight.value);
    this.composite.uniforms.uFlare.value = flare;
    this.quad.material = this.composite;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}
