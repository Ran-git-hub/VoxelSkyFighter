import * as THREE from "three";
import { CSM } from "three/addons/csm/CSM.js";
import { CSM_CASCADES, csmUniforms, worldUniforms } from "./WorldShading.js";
import { createSkyMesh } from "./Sky.js";
import { Clouds } from "./Clouds.js";
import { setNightGlow, setWetness, waterUniforms } from "./WorldMaterials.js";
import { Weather } from "./Weather.js";
import { BIOME, sampleColumn } from "./TerrainGen.js";

// Presets are just hours on the same sun path the day cycle follows, so
// switching between them and the cycle never jumps.
export const TIME_PRESETS = {
  dawn: { hour: 6.8, fog: 0.75 },
  noon: { hour: 12.5, fog: 0.7 },
  sunset: { hour: 17.3, fog: 0.75 },
  night: { hour: 0.5, fog: 0.9 },
};

const SUN_RISE = new THREE.Vector3(1, 0, 0.55).normalize();
const SUN_NOON = new THREE.Vector3(-0.55, 0, 1)
  .normalize()
  .multiplyScalar(Math.cos(THREE.MathUtils.degToRad(64)))
  .add(new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(64)), 0))
  .normalize();
const TAU_R = [0.046, 0.108, 0.265];
const TAU_M = 0.032;
const SUN_INTENSITY = 3.4;
const MOON_INTENSITY = 0.3;
const MOON_COLOR = new THREE.Color(0.62, 0.74, 1);
const DAY_LENGTH_SECONDS = 480;
const CASCADE_SPLITS = [0.22, 1];
const CASCADE_NORMAL_BIAS = [0.15, 0.7];
const SHADOW_FAR = 450;
const ENV_REBUILD_ANGLE = THREE.MathUtils.degToRad(1.5);
const ENV_REBUILD_OVERCAST = 0.04;

const smoothstep = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function airMass(cosZenith) {
  const zenithDeg = Math.min(THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(cosZenith, -1, 1))), 90);
  return 1 / (Math.max(cosZenith, 0) + 0.50572 * Math.pow(96.07995 - zenithDeg, -1.6364));
}

export function sunDirectionAt(hour, target) {
  const phase = ((hour - 6) / 12) * Math.PI;
  return target.copy(SUN_RISE).multiplyScalar(Math.cos(phase)).addScaledVector(SUN_NOON, Math.sin(phase)).normalize();
}

export class Atmosphere {
  constructor(scene, renderer, camera) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    this.hour = TIME_PRESETS.noon.hour;
    this.fogScale = 1;
    this.cycle = false;
    this.sunDirection = worldUniforms.uSunDir.value;
    this.lightDirection = worldUniforms.uLightDir.value;
    this.lightColor = new THREE.Color();
    this.envDirection = new THREE.Vector3(0, -1, 0);
    this.envOvercast = 0;
    this.envTarget = null;
    this.rayStrength = 0;
    this.flareStrength = 0;
    this.moonPhase = 0.5;
    this.aurora = 0;
    this.polar = false;
    this.polarTimer = 0;
    this.column = {};
    this.rayDirection = new THREE.Vector3(0, 1, 0);
    this.weather = new Weather(scene);
    this.exposure = 1;
    this.night = 0;
    this.viewDistance = 1200;

    this.csm = new CSM({
      camera,
      parent: scene,
      cascades: CSM_CASCADES,
      maxFar: SHADOW_FAR,
      mode: "custom",
      customSplitsCallback: (count, near, far, target) => target.push(...CASCADE_SPLITS),
      shadowMapSize: 2048,
      shadowBias: -0.0004,
      lightNear: 1,
      lightFar: 1800,
      lightMargin: 420,
      lightDirection: new THREE.Vector3(0, -1, 0),
    });
    this.csm.lights.forEach((light, index) => {
      light.shadow.normalBias = CASCADE_NORMAL_BIAS[index];
    });

    this.sky = createSkyMesh(900, true);
    scene.add(this.sky);
    this.envScene = new THREE.Scene();
    this.envScene.add(createSkyMesh(50, false));
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.clouds = new Clouds(scene);
    scene.background = null;
    scene.fog = null;
  }

  setPreset(name) {
    if (name === "cycle") {
      this.cycle = true;
      return;
    }
    this.cycle = false;
    this.hour = TIME_PRESETS[name].hour;
    this.fogScale = TIME_PRESETS[name].fog;
    this.applyTime(true);
  }

  setShadowMapSize(size) {
    this.csm.shadowMapSize = Math.max(size, 1);
    for (const light of this.csm.lights) {
      if (light.shadow.mapSize.x !== size && size > 0) {
        light.shadow.mapSize.set(size, size);
        light.shadow.map?.dispose();
        light.shadow.map = null;
      }
    }
  }

  setViewDistance(distance) {
    this.viewDistance = distance;
    worldUniforms.uViewDistance.value = distance;
    this.clouds.setFade(distance * 0.45, Math.min(distance * 0.7, 900));
  }

  refreshCascades() {
    this.csm.updateFrustums();
    this.csm.getExtendedBreaks(csmUniforms.CSM_cascades.value);
    csmUniforms.cameraNear.value = this.camera.near;
    csmUniforms.shadowFar.value = Math.min(this.camera.far, SHADOW_FAR);
  }

  applyTime(forceEnvironment) {
    const sun = sunDirectionAt(this.hour, this.sunDirection);
    const moon = worldUniforms.uMoonDir.value.copy(sun).negate();
    const sunVisible = smoothstep(-0.04, 0.06, sun.y);
    const moonVisible = smoothstep(-0.02, 0.15, moon.y) * (1 - sunVisible);

    if (sun.y > -0.03) {
      const mass = airMass(sun.y);
      this.lightColor.setRGB(
        Math.exp(-(TAU_R[0] + TAU_M) * mass),
        Math.exp(-(TAU_R[1] + TAU_M) * mass),
        Math.exp(-(TAU_R[2] + TAU_M) * mass)
      );
      this.lightColor.multiplyScalar(SUN_INTENSITY * sunVisible);
      this.lightDirection.copy(sun);
      this.rayStrength = 0.22 * sunVisible;
    } else {
      const moonLit = (1 - Math.cos(this.moonPhase * Math.PI * 2)) / 2;
      this.lightColor.copy(MOON_COLOR).multiplyScalar(MOON_INTENSITY * moonVisible * (0.35 + 0.65 * moonLit));
      this.lightDirection.copy(moon);
      this.rayStrength = 0.05 * moonVisible;
    }
    const weather = this.weather.state;
    this.lightColor.multiplyScalar((1 - 0.82 * weather.overcast) * (1 - 0.3 * weather.storm));
    worldUniforms.uSkyDim.value = 1 - 0.2 * weather.rain - 0.28 * weather.storm;
    waterUniforms.uRain.value = weather.rain;
    this.clouds.setWeather(weather.overcast, weather.storm);
    // Haze is what makes shafts visible, but a full deck leaves no gaps to shine through.
    this.rayStrength *= (1 - 0.9 * weather.overcast) * Math.min(1 + (weather.fog - 1) * 0.5, 2);
    this.flareStrength = sunVisible * (1 - weather.overcast) * (1 - weather.overcast);
    this.sunVisible = sunVisible;
    worldUniforms.uMoonPhase.value = this.moonPhase;
    worldUniforms.uOvercast.value = weather.overcast;
    worldUniforms.uWind.value.copy(this.weather.wind);
    setWetness(Math.min(1, weather.rain * 1.6));
    this.rayDirection.copy(this.lightDirection);
    // Shadows from a sun skimming the horizon stretch to infinity; clamp the
    // light a little above it so they stay within the cascades.
    if (this.lightDirection.y < 0.08) {
      this.lightDirection.y = 0.08;
      this.lightDirection.normalize();
    }

    this.csm.lightDirection.copy(this.lightDirection).negate();
    for (const light of this.csm.lights) {
      light.color.copy(this.lightColor);
      light.intensity = 1;
    }
    waterUniforms.uLightColor.value.copy(this.lightColor);

    const night = 1 - sunVisible;
    this.night = night;
    worldUniforms.uMoonRadiance.value.set(0.55, 0.62, 0.8).multiplyScalar(night);
    worldUniforms.uFogDensity.value = 0.0007 * this.fogScale * weather.fog;
    this.sky.material.uniforms.uStars.value = smoothstep(0.1, 0.9, night);
    setNightGlow(smoothstep(0.3, 0.95, night));
    this.exposure = THREE.MathUtils.lerp(2.6, 1, smoothstep(-0.15, 0.04, sun.y));

    this.mistColor = (1 - 0.8 * night) * (1 - 0.5 * weather.overcast);
    if (
      forceEnvironment ||
      this.envDirection.angleTo(sun) > ENV_REBUILD_ANGLE ||
      Math.abs(this.envOvercast - weather.overcast) > ENV_REBUILD_OVERCAST
    ) {
      this.envDirection.copy(sun);
      this.envOvercast = weather.overcast;
      const previous = this.envTarget;
      this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
      this.scene.environment = this.envTarget.texture;
      previous?.dispose();
    }
  }

  update(focus, cameraPosition, delta) {
    worldUniforms.uTime.value += delta;
    this.weather.update(delta, cameraPosition, 1 - this.night);
    if (this.cycle) {
      // Nights pass faster so most of the cycle is spent in daylight.
      const speed = this.sunDirection.y < -0.05 ? 2.5 : 1;
      const next = (this.hour + (delta * 24 * speed) / DAY_LENGTH_SECONDS) % 24;
      // The moon moves on one phase each noon, eight to the cycle.
      if (this.hour < 12 && next >= 12) {
        this.moonPhase = (this.moonPhase + 0.125) % 1;
      }
      this.hour = next;
    }
    if (this.cycle || this.weather.changing) {
      this.applyTime(false);
    }
    this.inCloud = this.clouds.inside(cameraPosition);
    this.polarTimer -= delta;
    if (this.polarTimer <= 0) {
      this.polarTimer = 1;
      sampleColumn(focus.x, focus.z, this.column);
      this.polar = this.column.biome === BIOME.SNOW || this.column.biome === BIOME.TAIGA;
    }
    const overcast = this.weather.state.overcast;
    this.aurora = THREE.MathUtils.damp(this.aurora, this.polar && this.night > 0.85 ? 1 - overcast : 0, 0.35, delta);
    worldUniforms.uAurora.value = this.aurora;
    worldUniforms.uRainbow.value = this.weather.rainbow * this.sunVisible;
    worldUniforms.uFlash.value = this.weather.flash * 0.5;
    this.renderer.toneMappingExposure = this.exposure * (1 + this.weather.flash * 1.4);

    this.sky.position.copy(cameraPosition);
    this.clouds.update(focus, delta);
    this.camera.updateMatrixWorld();
    this.csm.update();
  }
}
