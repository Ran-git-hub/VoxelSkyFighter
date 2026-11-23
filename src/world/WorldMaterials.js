import * as THREE from "three";
import { L, LAYERS } from "./TerrainGen.js";
import { blockArrayTexture } from "./BlockTextures.js";
import { ATMOSPHERE_GLSL, setupWorldMaterial, worldUniforms } from "./WorldShading.js";

const ROUGHNESS = {
  snow: 0.5,
  sand: 0.88,
  stone: 0.78,
  gravel: 0.9,
  asphalt: 0.82,
  whiteConcrete: 0.7,
  concrete: 0.78,
  window: 0.12,
  metal: 0.34,
  leaves: 0.75,
  spruceLeaves: 0.75,
  lamp: 0.4,
  clay: 0.7,
  roofTiles: 0.7,
  ice: 0.12,
  packedIce: 0.3,
  lava: 0.6,
  basalt: 0.85,
  terracotta: 0.8,
};

// How deep the texel pattern reads as relief, and what share of texels catch the sun as glints.
const BUMP = {
  stone: 1.7,
  cobble: 2,
  gravel: 1.6,
  bricks: 1.6,
  roofTiles: 1.4,
  sandstone: 1.1,
  dirt: 1,
  logSide: 1.3,
  spruceLog: 1.3,
  oakPlanks: 0.9,
  darkPlanks: 0.9,
  sand: 0.45,
  snow: 0.3,
  snowSide: 0.5,
  asphalt: 0.5,
  window: 0,
  lamp: 0,
  metal: 0.2,
  tallGrass: 0,
  flowerRed: 0,
  flowerYellow: 0,
  basalt: 1.8,
  lava: 0.6,
  ice: 0.25,
  packedIce: 0.5,
  terracotta: 0.9,
  paleTerracotta: 0.9,
  redSand: 0.45,
};
const GLINT = { snow: 0.14, snowSide: 0.08, sand: 0.07, sandstone: 0.03, stone: 0.02, gravel: 0.03, ice: 0.22, packedIce: 0.1, redSand: 0.05, basalt: 0.02 };
const EMISSION = { lamp: 2.5, lava: 3.2 };

export const layerUniforms = {
  uBlockArray: { value: null },
  uLayerRoughness: { value: LAYERS.map((name) => ROUGHNESS[name] ?? 0.92) },
  uLayerEmission: { value: LAYERS.map((name) => EMISSION[name] ?? 0) },
  uLayerBump: { value: LAYERS.map((name) => BUMP[name] ?? 0.7) },
  uLayerGlint: { value: LAYERS.map((name) => GLINT[name] ?? 0) },
  uWet: { value: 0 },
};

export function setWetness(amount) {
  layerUniforms.uWet.value = amount;
}

export function setNightGlow(amount) {
  // Windows light up as the sun goes down; lamps stay lit all day.
  layerUniforms.uLayerEmission.value[L.window] = amount * 1.6;
}

function blockPatch(wind) {
  return (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec2 aBlockUv;
attribute float aLayer;
attribute float aAo;
varying vec2 vBlockUv;
varying float vLayer;
varying float vAo;
${wind ? "attribute float aSway;\nuniform float uTime;\nuniform vec2 uWind;" : ""}`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vBlockUv = aBlockUv;
vLayer = aLayer;
vAo = aAo;
${
  wind
    ? `#ifdef USE_INSTANCING
  vec3 swayBase = instanceMatrix[3].xyz;
#else
  vec3 swayBase = vec3(0.0);
#endif
float swayPhase = uTime * 1.7 + swayBase.x * 0.07 + swayBase.z * 0.05;
float gust = 0.55 + 0.45 * sin(uTime * 0.37 + swayBase.x * 0.004 + swayBase.z * 0.003);
transformed.xz += uWind * aSway * gust * (sin(swayPhase) * 0.08 + sin(swayPhase * 2.3) * 0.03);`
    : ""
}`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform highp sampler2DArray uBlockArray;
uniform float uLayerRoughness[${LAYERS.length}];
uniform float uLayerEmission[${LAYERS.length}];
uniform float uLayerBump[${LAYERS.length}];
uniform float uLayerGlint[${LAYERS.length}];
uniform float uWet;
varying vec2 vBlockUv;
varying float vLayer;
varying float vAo;`
      )
      .replace(
        "#include <map_fragment>",
        `int blockLayer = int(vLayer + 0.5);
vec4 blockTexel = texture(uBlockArray, vec3(vBlockUv, float(blockLayer)));
diffuseColor *= blockTexel;
diffuseColor.rgb *= 1.0 - 0.25 * uWet;
// Relief comes from the block texture itself: darker texels sit lower. Sampling
// whole texels keeps the bumps on the pixel grid instead of smoothing them.
const vec3 LUMA = vec3(0.3, 0.59, 0.11);
float reliefHere = dot(blockTexel.rgb, LUMA);
float reliefFade = uLayerBump[blockLayer] * (1.0 - smoothstep(250.0, 700.0, length(vViewPosition)));
vec2 relief = vec2(
  reliefHere - dot(texture(uBlockArray, vec3(vBlockUv + vec2(0.0625, 0.0), float(blockLayer))).rgb, LUMA),
  reliefHere - dot(texture(uBlockArray, vec3(vBlockUv + vec2(0.0, 0.0625), float(blockLayer))).rgb, LUMA)
) * reliefFade;
vec2 texelCell = floor(vBlockUv * 16.0);
float texelHash = fract(sin(dot(texelCell, vec2(127.1, 311.7))) * 43758.5453);`
      )
      .replace("#include <roughnessmap_fragment>", `float roughnessFactor = uLayerRoughness[blockLayer] * (1.0 - 0.55 * uWet);
roughnessFactor = clamp(roughnessFactor + (texelHash - 0.5) * 0.16, 0.05, 1.0);
roughnessFactor = mix(roughnessFactor, 0.18, step(1.0 - uLayerGlint[blockLayer], texelHash));`)
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
vec3 reliefDp1 = dFdx(vViewPosition);
vec3 reliefDp2 = dFdy(vViewPosition);
vec2 reliefDuv1 = dFdx(vBlockUv);
vec2 reliefDuv2 = dFdy(vBlockUv);
vec3 reliefT = reliefDp1 * reliefDuv2.y - reliefDp2 * reliefDuv1.y;
vec3 reliefB = reliefDp2 * reliefDuv1.x - reliefDp1 * reliefDuv2.x;
float reliefScale = max(dot(reliefT, reliefT), dot(reliefB, reliefB));
if (reliefScale > 0.0) {
  normal = normalize(normal + (reliefT * relief.x + reliefB * relief.y) * inversesqrt(reliefScale) * 1.6);
}`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
totalEmissiveRadiance += blockTexel.rgb * uLayerEmission[blockLayer];`
      )
      // Baked AO mostly darkens bounce light, with a little on direct light
      // for the familiar voxel contact shading.
      .replace(
        "#include <aomap_fragment>",
        `reflectedLight.indirectDiffuse *= vAo;
reflectedLight.indirectSpecular *= vAo;
reflectedLight.directDiffuse *= mix(1.0, vAo, 0.4);`
      );
  };
}

let terrainMaterial = null;
let vegetationMaterial = null;

// Terrain columns have no bottom faces, so the default back-face shadow pass
// would leave the ground out of the shadow map entirely.
export function getTerrainMaterial() {
  if (!terrainMaterial) {
    layerUniforms.uBlockArray.value = blockArrayTexture();
    terrainMaterial = setupWorldMaterial(new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, shadowSide: THREE.FrontSide }), {
      key: "terrain",
      uniforms: layerUniforms,
      patch: blockPatch(false),
    });
  }
  return terrainMaterial;
}

export function getVegetationMaterial() {
  if (!vegetationMaterial) {
    layerUniforms.uBlockArray.value = blockArrayTexture();
    vegetationMaterial = setupWorldMaterial(new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, shadowSide: THREE.FrontSide }), {
      key: "vegetation",
      uniforms: layerUniforms,
      patch: blockPatch(true),
    });
  }
  return vegetationMaterial;
}

const waterVertex = /* glsl */ `
attribute float aDepth;
varying vec3 vWorldPos;
varying float vDepth;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vDepth = aDepth;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const waterFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uLightColor;
uniform sampler2D uReflection;
uniform mat4 uReflectionMatrix;
uniform float uReflectionMix;
uniform float uRain;
varying vec3 vWorldPos;
varying float vDepth;
${ATMOSPHERE_GLSL}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

float waves(vec2 p) {
  float t = uTime;
  return sin(p.x * 0.55 + t * 1.3) * 0.25 + sin(p.y * 0.7 - t * 1.05 + p.x * 0.3) * 0.2 +
    valueNoise(p * 0.45 + vec2(t * 0.35, t * 0.2)) * 0.6 + valueNoise(p * 1.3 - vec2(t * 0.6, -t * 0.4)) * 0.25;
}

void main() {
  // Snap to the 16-texels-per-block grid so ripples read as pixels, not gloss.
  vec2 cell = floor(vWorldPos.xz * 8.0) / 8.0;
  float h0 = waves(cell);
  vec3 normal = normalize(vec3((h0 - waves(cell + vec2(0.125, 0.0))) * 3.0, 1.0, (h0 - waves(cell + vec2(0.0, 0.125))) * 3.0));
  // Raindrops: texels that flick up at random, each roughening the surface for an instant.
  float drop = uRain * step(1.0 - 0.07 * uRain, hash12(cell * 5.3 + floor(uTime * 9.0) * 0.37));
  normal = normalize(normal + vec3(hash12(cell + 3.1) - 0.5, 0.0, hash12(cell + 7.7) - 0.5) * uRain * 0.5);

  vec3 view = normalize(cameraPosition - vWorldPos);
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
  vec3 reflected = reflect(-view, normal);
  reflected.y = abs(reflected.y);
  vec3 reflection = skyRadiance(reflected);
  if (uReflectionMix > 0.0) {
    // Nudging the lookup along the ripple normal makes the mirror image wobble in the same pixel grid.
    vec4 mirrored = uReflectionMatrix * vec4(vWorldPos.x + normal.x * 9.0, vWorldPos.y, vWorldPos.z + normal.z * 9.0, 1.0);
    reflection = mix(reflection, texture2DProj(uReflection, mirrored).rgb, uReflectionMix);
  }

  float shade = cloudShadow(vWorldPos);
  vec3 ambient = skyRadiance(vec3(0.0, 1.0, 0.0)) * 0.9 + uLightColor * max(uLightDir.y, 0.0) * 0.25 * shade;
  float depth = vDepth * 2.0;
  vec3 shallow = mix(vec3(0.3, 0.5, 0.4), vec3(0.09, 0.36, 0.33), smoothstep(0.5, 3.0, vDepth));
  vec3 deep = vec3(0.008, 0.05, 0.1);
  vec3 body = mix(shallow, deep, 1.0 - exp(-depth * 0.07)) * ambient;

  vec3 color = mix(body, reflection, fresnel);
  vec3 halfway = normalize(uLightDir + view);
  color += uLightColor * pow(max(dot(normal, halfway), 0.0), 420.0) * 6.0 * shade;

  float foamMask = 1.0 - smoothstep(0.5, 1.6, vDepth);
  float foam = step(hash12(cell * 1.7 + floor(uTime * 2.5)), 0.5 * foamMask);
  color = mix(color, ambient * 0.95, foam * 0.85);

  color = mix(color, ambient * 1.3, drop * 0.7);

  gl_FragColor = vec4(applyAtmosphere(color, vWorldPos), 1.0);
  #include <colorspace_fragment>
}
`;

export const waterUniforms = {
  uLightColor: { value: new THREE.Color() },
  uReflection: { value: null },
  uReflectionMatrix: { value: new THREE.Matrix4() },
  uReflectionMix: { value: 0 },
  uRain: { value: 0 },
};

let waterMaterial = null;

export function getWaterMaterial() {
  if (!waterMaterial) {
    waterMaterial = new THREE.ShaderMaterial({
      uniforms: { ...worldUniforms, ...waterUniforms },
      vertexShader: waterVertex,
      fragmentShader: waterFragment,
    });
  }
  return waterMaterial;
}
