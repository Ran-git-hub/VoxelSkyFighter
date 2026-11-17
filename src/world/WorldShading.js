import * as THREE from "three";

export const CSM_CASCADES = 2;

// One set of uniform objects is handed to every world material, so updating a
// value here reaches all of them without walking the scene each frame.
export const worldUniforms = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunRadiance: { value: new THREE.Vector3(20, 20, 20) },
  uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uMoonRadiance: { value: new THREE.Vector3(0, 0, 0) },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  uNightAmbient: { value: new THREE.Vector3(0.002, 0.003, 0.006) },
  uFogDensity: { value: 0.0016 },
  uFogFalloff: { value: 0.0045 },
  uViewDistance: { value: 1200 },
  uCloudMap: { value: null },
  uCloudParams: { value: new THREE.Vector4(0, 0, 1 / 384, 210) },
  uCloudShadow: { value: 0.65 },
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(1, 0.4) },
  uOvercast: { value: 0 },
  uFlash: { value: 0 },
  uSkyDim: { value: 1 },
  uRainbow: { value: 0 },
  uAurora: { value: 0 },
  uMoonPhase: { value: 0.5 },
};

export const csmUniforms = {
  CSM_cascades: { value: Array.from({ length: CSM_CASCADES }, () => new THREE.Vector2()) },
  cameraNear: { value: 0.5 },
  shadowFar: { value: 450 },
};

export const ATMOSPHERE_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunRadiance;
uniform vec3 uMoonDir;
uniform vec3 uMoonRadiance;
uniform vec3 uLightDir;
uniform vec3 uNightAmbient;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uViewDistance;
uniform sampler2D uCloudMap;
uniform vec4 uCloudParams;
uniform float uCloudShadow;
uniform float uOvercast;
uniform float uFlash;
uniform float uSkyDim;

const vec3 TAU_R = vec3(0.046, 0.108, 0.265);
const float TAU_M = 0.032;

// Kasten-Young relative air mass; clamped at the horizon so twilight keeps a
// finite optical depth instead of blowing up.
float airMass(float cosZenith) {
  float zenithDeg = min(degrees(acos(clamp(cosZenith, -1.0, 1.0))), 90.0);
  return 1.0 / (max(cosZenith, 0.0) + 0.50572 * pow(96.07995 - zenithDeg, -1.6364));
}

vec3 scatterLight(vec3 dir, vec3 lightDir, vec3 radiance) {
  float mu = dot(dir, lightDir);
  vec3 tau = TAU_R + TAU_M;
  // Light scattered toward the zenith does so high up, where the path to the
  // sun is thinner; without this a low sun tints the whole sky orange.
  float altitudeFactor = mix(1.0, 0.3, sqrt(max(dir.y, 0.0)));
  vec3 lightT = exp(-tau * airMass(lightDir.y) * altitudeFactor);
  float phaseR = 0.0596831 * (1.0 + mu * mu);
  float g = 0.72;
  float phaseM = 0.04 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
  vec3 inscatter = (TAU_R * phaseR + TAU_M * phaseM) / tau * (1.0 - exp(-tau * airMass(max(dir.y, 0.0))));
  return radiance * lightT * inscatter * smoothstep(-0.12, 0.02, lightDir.y);
}

vec3 skyRadiance(vec3 dir) {
  vec3 sky = scatterLight(dir, uSunDir, uSunRadiance) + scatterLight(dir, uMoonDir, uMoonRadiance) +
    uNightAmbient * (0.6 + 0.4 * max(dir.y, 0.0));
  // A cloud deck swallows the blue and the glow round the sun, leaving flat cool grey.
  vec3 grey = vec3(0.78, 0.84, 0.94) * dot(sky, vec3(0.2126, 0.7152, 0.0722)) * 0.55 * uSkyDim;
  return mix(sky, grey, uOvercast) + vec3(0.6, 0.7, 1.0) * uFlash;
}

// Analytic exponential height fog: integrates density exp(-falloff * y) along
// the view ray, so valleys fill with haze while peaks stay clear.
vec3 applyAtmosphere(vec3 color, vec3 worldPos) {
  vec3 ray = worldPos - cameraPosition;
  float dist = length(ray);
  vec3 dir = ray / max(dist, 1e-4);
  float rd = uFogFalloff * dir.y * dist;
  float integral = abs(rd) > 1e-4 ? (1.0 - exp(-rd)) / rd : 1.0;
  float amount = uFogDensity * exp(-uFogFalloff * max(cameraPosition.y, 0.0)) * dist * integral;
  float fog = 1.0 - exp(-amount);
  fog = max(fog, smoothstep(uViewDistance * 0.7, uViewDistance, dist));
  // Sample the sky a little above the horizon: the horizon itself is nearly white,
  // which turned distant terrain into flat grey instead of blue aerial haze.
  vec3 horizonDir = normalize(vec3(dir.x, max(dir.y, 0.0) + 0.16, dir.z));
  return mix(color, skyRadiance(horizonDir), fog);
}

float cloudShadow(vec3 p) {
  if (p.y > uCloudParams.w || uLightDir.y < 0.02) {
    return 1.0;
  }
  float t = (uCloudParams.w - p.y) / uLightDir.y;
  vec2 q = (p.xz + uLightDir.xz * t - uCloudParams.xy) * uCloudParams.z;
  return 1.0 - uCloudShadow * texture2D(uCloudMap, q).r;
}
`;

let installed = false;

export function installShaderPatches() {
  if (installed) {
    return;
  }
  installed = true;
  const chunks = THREE.ShaderChunk;
  chunks.fog_pars_vertex += `
#ifdef WORLD_SHADING
  varying vec3 vWorldPos;
#endif`;
  chunks.fog_vertex += `
#ifdef WORLD_SHADING
  vec4 worldShadingPos = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    worldShadingPos = instanceMatrix * worldShadingPos;
  #endif
  vWorldPos = (modelMatrix * worldShadingPos).xyz;
#endif`;
  chunks.fog_pars_fragment += `
#ifdef WORLD_SHADING
  varying vec3 vWorldPos;
  ${ATMOSPHERE_GLSL}
#endif`;
  chunks.fog_fragment = `
#ifdef WORLD_SHADING
  gl_FragColor.rgb = applyAtmosphere(gl_FragColor.rgb, vWorldPos);
#else
  ${chunks.fog_fragment}
#endif`;
  // Point lights get darkened under cloud shadows too; they only live for a
  // fraction of a second, which is cheaper than splitting the light loop.
  chunks.lights_fragment_end = `
#if defined( WORLD_SHADING ) && !defined( NO_CLOUD_SHADOW )
  float worldCloud = cloudShadow(vWorldPos);
  reflectedLight.directDiffuse *= worldCloud;
  reflectedLight.directSpecular *= worldCloud;
#endif
${chunks.lights_fragment_end}`;
}

// Every lit world material must go through here: the CSM light loop sums all
// cascades for materials that lack its defines, which would triple the sun.
export function setupWorldMaterial(material, { key = "world", defines = {}, uniforms = {}, patch = null } = {}) {
  material.defines = { ...(material.defines || {}), USE_CSM: 1, CSM_CASCADES, WORLD_SHADING: 1, ...defines };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, worldUniforms, csmUniforms, uniforms);
    patch?.(shader);
  };
  material.customProgramCacheKey = () => key;
  return material;
}
