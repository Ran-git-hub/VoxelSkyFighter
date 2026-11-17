import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { FAR_LAYER, MID_LAYER, WATER_LAYER } from "../world/VoxelWorld.js";
import { waterUniforms } from "../world/WorldMaterials.js";
import { GodRayPass } from "./GodRays.js";

export const QUALITY_PRESETS = {
  low: { pixelRatio: 1, shadowMapSize: 0, bloom: false, ao: false, rays: false, reflections: false, viewDistance: 760, lodFactor: 0.7, vegetation: 0.35, plantRadius: 90, treeRadius: 300 },
  medium: { pixelRatio: 1.25, shadowMapSize: 1024, bloom: true, ao: false, rays: true, reflections: false, viewDistance: 1000, lodFactor: 0.85, vegetation: 0.6, plantRadius: 130, treeRadius: 380 },
  high: { pixelRatio: 1.5, shadowMapSize: 2048, bloom: true, ao: true, rays: true, reflections: true, viewDistance: 1250, lodFactor: 0.75, vegetation: 1, plantRadius: 170, treeRadius: 420 },
  ultra: { pixelRatio: 2, shadowMapSize: 4096, bloom: true, ao: true, rays: true, reflections: true, viewDistance: 1600, lodFactor: 1.3, vegetation: 1, plantRadius: 230, treeRadius: 600 },
};

const AO_RANGE = 90;
const MIN_RESOLUTION_SCALE = 0.6;
const UP = new THREE.Vector3(0, 1, 0);
const TEXTURE_BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.08 },
    contrast: { value: 1.04 },
    tint: { value: new THREE.Vector3(1.01, 1, 0.98) },
    vignette: { value: 0.28 },
    mist: { value: 0 },
    mistColor: { value: 0.9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform vec3 tint;
    uniform float vignette;
    uniform float mist;
    uniform float mistColor;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, saturation);
      color = (color - 0.5) * contrast + 0.5;
      color *= tint;
      float edge = length((vUv - 0.5) * vec2(1.15, 1.0));
      color *= 1.0 - vignette * smoothstep(0.35, 0.85, edge);
      color = mix(color, vec3(mistColor), mist);
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), texel.a);
    }
  `,
};

// Smears the image outward from the centre and draws thin streaks at the rim,
// both scaled by how far past cruise speed the plane is.
const SpeedShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0 },
    time: { value: 0 },
    aspect: { value: 1 },
  },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    uniform float time;
    uniform float aspect;
    varying vec2 vUv;

    float hash(float n) {
      return fract(sin(n * 91.3458) * 47453.5453);
    }

    void main() {
      vec2 fromCentre = vUv - 0.5;
      float edge = length(fromCentre * vec2(aspect, 1.0));
      float blur = amount * 0.07 * smoothstep(0.12, 0.75, edge);
      vec3 color = vec3(0.0);
      for (int i = 0; i < 8; i += 1) {
        color += texture2D(tDiffuse, vUv - fromCentre * blur * float(i) / 7.0).rgb;
      }
      color /= 8.0;

      float angle = atan(fromCentre.y, fromCentre.x * aspect);
      float slot = floor(angle * 28.6479);
      float seed = hash(slot);
      float within = abs(fract(angle * 28.6479) - 0.5);
      float travel = fract(edge * 1.4 - time * (1.6 + seed * 1.8) + seed * 7.0);
      float streak = step(0.72, seed) * (1.0 - smoothstep(0.03, 0.09, within)) * smoothstep(0.0, 0.15, travel) * (1.0 - smoothstep(0.25, 0.5, travel));
      color += vec3(0.85, 0.92, 1.0) * streak * amount * 0.4 * smoothstep(0.4, 0.8, edge);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export class Graphics {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.width = 1;
    this.height = 1;
    this.aoBox = new THREE.Box3();
    this.resolutionScale = 1;
    this.frameTimeAverage = 1 / 60;
    this.slowTimer = 0;
    this.fastTimer = 0;
    this.stats = { calls: 0, triangles: 0 };
    this.toggles = { godRays: true, reflections: true };

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Shadows are refreshed once per frame explicitly; otherwise the AO normal
    // pass would re-render every cascade a second time.
    renderer.shadowMap.autoUpdate = false;
    renderer.info.autoReset = false;
    camera.layers.enable(FAR_LAYER);
    camera.layers.enable(MID_LAYER);
    camera.layers.enable(WATER_LAYER);

    this.reflectionTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.reflectionCamera = new THREE.PerspectiveCamera();
    this.reflectionCamera.layers.enable(FAR_LAYER);
    this.reflectionCamera.layers.enable(MID_LAYER);
    this.reflectionPlane = new THREE.Plane();
    this.frustum = new THREE.Frustum();
    this.scratchMatrix = new THREE.Matrix4();
    this.scratchVector = new THREE.Vector3();
    this.clipPlane = new THREE.Vector4();
    this.clipCorner = new THREE.Vector4();
    waterUniforms.uReflection.value = this.reflectionTarget.texture;

    // The god ray pass reads scene depth to tell sky from everything in front of it.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
    this.composer = new EffectComposer(renderer, target);
    // Cloning a render target shares the depth texture's storage; the second buffer needs its own,
    // or sampling depth while drawing into the other buffer is a feedback loop.
    this.composer.renderTarget2.depthTexture = new THREE.DepthTexture(1, 1);
    this.composer.addPass(new RenderPass(scene, camera));
    this.rayPass = new GodRayPass(camera);
    this.composer.addPass(this.rayPass);

    this.aoPass = new GTAOPass(scene, camera, 1, 1);
    this.aoPass.updateGtaoMaterial({ radius: 6, distanceExponent: 1, thickness: 10, scale: 1.2, samples: 12 });
    this.aoPass.blendIntensity = 0.7;
    const renderAo = this.aoPass.render.bind(this.aoPass);
    // AO is invisible past a few hundred metres, so the extra normal pass
    // skips distant terrain, water, clouds and sky to save draw calls.
    this.aoPass.render = (...args) => {
      camera.layers.disable(FAR_LAYER);
      camera.layers.disable(MID_LAYER);
      camera.layers.disable(WATER_LAYER);
      this.onAoPass?.(true, this.aoBox);
      renderAo(...args);
      this.onAoPass?.(false, this.aoBox);
      camera.layers.enable(FAR_LAYER);
      camera.layers.enable(MID_LAYER);
      camera.layers.enable(WATER_LAYER);
    };
    this.composer.addPass(this.aoPass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.5, 1.6);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.gradePass = new ShaderPass(GradeShader);
    this.composer.addPass(this.gradePass);
    this.speedPass = new ShaderPass(SpeedShader);
    this.speedPass.enabled = false;
    this.composer.addPass(this.speedPass);
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaaPass);
  }

  setQuality(name) {
    this.qualityName = name;
    this.quality = QUALITY_PRESETS[name];
    this.aoPass.enabled = this.quality.ao;
    this.bloomPass.enabled = this.quality.bloom;
    this.rayPass.enabled = this.quality.rays && this.toggles.godRays;
    this.resolutionScale = 1;

    const shadows = this.quality.shadowMapSize > 0;
    if (shadows !== this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse((node) => {
        if (node.material) {
          node.material.needsUpdate = true;
        }
      });
    }
    this.applySize();
    return this.quality;
  }

  setToggle(key, value) {
    this.toggles[key] = value;
    if (this.quality) {
      this.rayPass.enabled = this.quality.rays && this.toggles.godRays;
    }
  }

  setSize(width, height) {
    // A hidden or collapsed page reports 0×0, and zero-sized render targets
    // flood the console with incomplete-framebuffer warnings.
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.applySize();
  }

  applySize() {
    const pixelRatio = Math.min(window.devicePixelRatio, this.quality.pixelRatio) * this.resolutionScale;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(this.width, this.height);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(this.width, this.height);

    const bufferWidth = Math.floor(this.width * pixelRatio);
    const bufferHeight = Math.floor(this.height * pixelRatio);
    this.aoPass.setSize(Math.max(1, Math.floor(bufferWidth / 2)), Math.max(1, Math.floor(bufferHeight / 2)));
    this.reflectionTarget.setSize(Math.max(1, Math.floor(bufferWidth / 2)), Math.max(1, Math.floor(bufferHeight / 2)));
    this.fxaaPass.material.uniforms.resolution.value.set(1 / bufferWidth, 1 / bufferHeight);
  }

  // Trades resolution for frame rate: drops quickly when frames run long and
  // climbs back slowly once there is headroom, to avoid oscillating.
  adaptResolution(delta) {
    this.frameTimeAverage = THREE.MathUtils.lerp(this.frameTimeAverage, delta, 0.05);
    const fps = 1 / this.frameTimeAverage;
    if (fps < 52) {
      this.slowTimer += delta;
      this.fastTimer = 0;
    } else if (fps > 58) {
      this.fastTimer += delta;
      this.slowTimer = 0;
    } else {
      this.slowTimer = 0;
      this.fastTimer = 0;
    }
    if (this.slowTimer > 1.5 && this.resolutionScale > MIN_RESOLUTION_SCALE) {
      this.resolutionScale = Math.max(MIN_RESOLUTION_SCALE, this.resolutionScale - 0.1);
      this.slowTimer = 0;
      this.applySize();
    } else if (this.fastTimer > 6 && this.resolutionScale < 1) {
      this.resolutionScale = Math.min(1, this.resolutionScale + 0.1);
      this.fastTimer = 0;
      this.applySize();
    }
  }

  // Night vision loses colour first (Purkinje shift), so grading desaturates
  // and cools the image as the sun sets.
  setNight(amount) {
    const uniforms = this.gradePass.uniforms;
    uniforms.saturation.value = 1.08 - amount * 0.45;
    uniforms.tint.value.set(1.01 - amount * 0.1, 1, 0.98 + amount * 0.1);
  }

  setFocus(position) {
    this.aoBox.min.set(position.x - AO_RANGE, position.y - AO_RANGE, position.z - AO_RANGE);
    this.aoBox.max.set(position.x + AO_RANGE, position.y + AO_RANGE, position.z + AO_RANGE);
    this.aoPass.setSceneClipBox(this.aoBox);
  }

  // Whites the view out while the camera is inside a cloud.
  setMist(inside, brightness, delta) {
    const uniforms = this.gradePass.uniforms;
    uniforms.mist.value = THREE.MathUtils.damp(uniforms.mist.value, inside ? 0.82 : 0, inside ? 14 : 5, delta);
    uniforms.mistColor.value = 0.25 + 0.7 * brightness;
  }

  setSpeed(amount, delta) {
    this.speedPass.enabled = amount > 0.01;
    this.speedPass.uniforms.amount.value = amount;
    this.speedPass.uniforms.time.value = (this.speedPass.uniforms.time.value + delta) % 1000;
    this.speedPass.uniforms.aspect.value = this.width / this.height;
  }

  setLight(direction, color, strength, flare) {
    this.rayPass.flare = flare;
    this.rayPass.direction.copy(direction);
    // Only the hue matters here: a dim low sun should still throw strong shafts.
    this.rayPass.color.copy(color).multiplyScalar(1 / Math.max(color.r, color.g, color.b, 1e-4));
    this.rayPass.strength = strength;
  }

  // Planar reflection: the scene drawn once more from a camera mirrored through
  // the water surface, with the near plane tilted onto the surface so nothing
  // below it leaks in. Skipped whenever no water is on screen.
  renderReflection() {
    const camera = this.camera;
    const level = this.waterLevel;
    this.frustum.setFromProjectionMatrix(this.scratchMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const active = this.quality.reflections && this.toggles.reflections && camera.position.y > level + 0.5 && this.waterInView?.(this.frustum);
    waterUniforms.uReflectionMix.value = active ? 1 : 0;
    if (!active) {
      return;
    }

    const mirror = this.reflectionCamera;
    const forward = camera.getWorldDirection(this.scratchVector);
    mirror.position.set(camera.position.x, 2 * level - camera.position.y, camera.position.z);
    mirror.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    mirror.up.y *= -1;
    mirror.lookAt(mirror.position.x + forward.x, mirror.position.y - forward.y, mirror.position.z + forward.z);
    mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(camera.projectionMatrix);
    waterUniforms.uReflectionMatrix.value.copy(TEXTURE_BIAS).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

    const plane = this.reflectionPlane.set(UP, -level).applyMatrix4(mirror.matrixWorldInverse);
    const clip = this.clipPlane.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = mirror.projectionMatrix.elements;
    const corner = this.clipCorner.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    clip.multiplyScalar(2 / clip.dot(corner));
    e[2] = clip.x;
    e[6] = clip.y;
    e[10] = clip.z + 1;
    e[14] = clip.w;

    this.onReflectionPass?.(mirror.position);
    this.renderer.setRenderTarget(this.reflectionTarget);
    this.renderer.render(this.scene, mirror);
    this.renderer.setRenderTarget(null);
    this.onReflectionPass?.(camera.position);
  }

  render(delta) {
    this.adaptResolution(delta);
    this.renderer.info.reset();
    this.renderReflection();
    this.renderer.shadowMap.needsUpdate = this.renderer.shadowMap.enabled;
    this.composer.render(delta);
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
  }
}
