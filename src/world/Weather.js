import * as THREE from "three";
import { CLOUD_HEIGHT } from "./Clouds.js";

// overcast greys the sky and dims the sun, fog multiplies haze density.
export const WEATHER_PRESETS = {
  clear: { overcast: 0, rain: 0, fog: 1, storm: 0 },
  cloudy: { overcast: 0.6, rain: 0, fog: 1.4, storm: 0 },
  rain: { overcast: 0.85, rain: 0.6, fog: 2.2, storm: 0 },
  storm: { overcast: 1, rain: 1, fog: 2.8, storm: 1 },
  fog: { overcast: 0.45, rain: 0, fog: 5.5, storm: 0 },
};

const AUTO_POOL = ["clear", "clear", "clear", "cloudy", "cloudy", "rain", "rain", "storm", "fog"];
const TRANSITION_RATE = 0.09;
const RAIN_DROPS = 7000;
const RAIN_BOX = 120;
const RAIN_FALL = 58;
const RAIN_LAYER = 1;
const BOLT_SEGMENTS = 15;
const BOLT_LIFE = 0.28;

const rainVertex = /* glsl */ `
attribute vec2 aDrop;
uniform vec3 uOffset;
uniform vec3 uStreak;
uniform float uAmount;
uniform float uCeiling;
varying float vAlpha;
void main() {
  // Drops live in a box that wraps around the camera, so the rain is endless without moving any buffers.
  vec3 p = mod(position + uOffset - cameraPosition, ${RAIN_BOX.toFixed(1)}) - ${(RAIN_BOX / 2).toFixed(1)} + cameraPosition;
  float range = length(p - cameraPosition);
  vAlpha = step(aDrop.y, uAmount) * step(p.y, uCeiling) * (1.0 - smoothstep(${(RAIN_BOX * 0.32).toFixed(1)}, ${(RAIN_BOX * 0.5).toFixed(1)}, range));
  p += uStreak * aDrop.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const rainFragment = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  if (vAlpha < 0.01) {
    discard;
  }
  gl_FragColor = vec4(uColor, vAlpha * 0.5);
}
`;

function createRain() {
  const positions = new Float32Array(RAIN_DROPS * 6);
  const drops = new Float32Array(RAIN_DROPS * 4);
  for (let i = 0; i < RAIN_DROPS; i += 1) {
    const x = Math.random() * RAIN_BOX;
    const y = Math.random() * RAIN_BOX;
    const z = Math.random() * RAIN_BOX;
    const seed = Math.random();
    positions.set([x, y, z, x, y, z], i * 6);
    drops.set([0, seed, 1, seed], i * 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aDrop", new THREE.BufferAttribute(drops, 2));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uOffset: { value: new THREE.Vector3() },
      uStreak: { value: new THREE.Vector3(0, -2, 0) },
      uAmount: { value: 0 },
      uCeiling: { value: CLOUD_HEIGHT },
      uColor: { value: new THREE.Color() },
    },
    vertexShader: rainVertex,
    fragmentShader: rainFragment,
    transparent: true,
    depthWrite: false,
  });
  const rain = new THREE.LineSegments(geometry, material);
  rain.frustumCulled = false;
  // Off the default layer so the AO normal pass, which ignores this shader, skips it.
  rain.layers.set(RAIN_LAYER);
  rain.visible = false;
  return rain;
}

export class Weather {
  constructor(scene) {
    this.state = { ...WEATHER_PRESETS.clear };
    this.target = WEATHER_PRESETS.clear;
    this.auto = false;
    this.fx = true;
    this.autoTimer = 0;
    this.changing = false;
    this.flash = 0;
    this.rainCharge = 0;
    this.rainbow = 0;
    this.flashQueue = [];
    this.strikeTimer = 6;
    this.heightAt = null;
    this.onThunder = null;
    this.wind = new THREE.Vector2(1, 0.4);
    this.fall = new THREE.Vector3();
    this.previousCamera = null;
    this.cameraVelocity = new THREE.Vector3();

    this.rain = createRain();
    scene.add(this.rain);

    this.bolt = new THREE.Group();
    const boltGeometry = new THREE.BoxGeometry(1, 1, 1);
    const boltMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 8, 11), fog: false });
    for (let i = 0; i < BOLT_SEGMENTS; i += 1) {
      const segment = new THREE.Mesh(boltGeometry, boltMaterial);
      segment.layers.set(RAIN_LAYER);
      this.bolt.add(segment);
    }
    this.bolt.visible = false;
    this.boltLife = 0;
    scene.add(this.bolt);
  }

  setPreset(name) {
    this.auto = name === "auto";
    if (this.auto) {
      this.autoTimer = 50;
      return;
    }
    this.target = WEATHER_PRESETS[name];
  }

  // A blocky bolt: straight drops joined by sideways jogs, like a staircase of light.
  // With `at`, the bolt is slid sideways so it passes through that point (a strike on the player).
  strike(cameraPosition, at = null) {
    const angle = Math.random() * Math.PI * 2;
    const distance = at ? 0 : 220 + Math.random() * 480;
    let x = cameraPosition.x + Math.cos(angle) * distance;
    let z = cameraPosition.z + Math.sin(angle) * distance;
    const ground = this.heightAt ? this.heightAt(x, z) : 0;
    const drops = (BOLT_SEGMENTS + 1) / 2;
    const dropHeight = (CLOUD_HEIGHT - ground) / drops;
    let y = CLOUD_HEIGHT;
    for (let i = 0; i < BOLT_SEGMENTS; i += 1) {
      const segment = this.bolt.children[i];
      if (i % 2 === 0) {
        segment.position.set(x, y - dropHeight / 2, z);
        segment.scale.set(3, dropHeight + 3, 3);
        y -= dropHeight;
      } else {
        const jog = (8 + Math.random() * 22) * (Math.random() < 0.5 ? -1 : 1);
        const alongX = Math.random() < 0.5;
        segment.position.set(x + (alongX ? jog / 2 : 0), y, z + (alongX ? 0 : jog / 2));
        segment.scale.set(alongX ? Math.abs(jog) + 3 : 3, 3, alongX ? 3 : Math.abs(jog) + 3);
        x += alongX ? jog : 0;
        z += alongX ? 0 : jog;
      }
    }
    if (at) {
      const drop = this.bolt.children.find((segment, i) => i % 2 === 0 && Math.abs(segment.position.y - at.y) <= segment.scale.y / 2);
      const anchor = drop ?? this.bolt.children[0];
      const dx = at.x - anchor.position.x;
      const dz = at.z - anchor.position.z;
      for (const segment of this.bolt.children) {
        segment.position.x += dx;
        segment.position.z += dz;
      }
    }
    this.bolt.visible = true;
    this.boltLife = BOLT_LIFE;
    this.flashQueue = [
      [0, 1],
      [0.09, 0.5],
      [0.16, 0.9],
    ];
    this.onThunder?.(distance);
  }

  update(delta, cameraPosition, lightAmount) {
    if (this.auto) {
      this.autoTimer -= delta;
      if (this.autoTimer <= 0) {
        this.autoTimer = 70 + Math.random() * 70;
        this.target = WEATHER_PRESETS[AUTO_POOL[Math.floor(Math.random() * AUTO_POOL.length)]];
      }
    }

    this.changing = false;
    for (const key of Object.keys(this.state)) {
      const difference = this.target[key] - this.state[key];
      if (Math.abs(difference) > 1e-4) {
        this.changing = true;
        const rate = TRANSITION_RATE * (key === "fog" ? 5 : 1) * delta;
        this.state[key] += THREE.MathUtils.clamp(difference, -rate, rate);
      }
    }

    const { rain, storm } = this.state;
    // A rainbow needs air still wet from a shower and a sky that has opened up again.
    this.rainCharge = rain > 0.25 ? 1 : Math.max(0, this.rainCharge - delta / 100);
    this.rainbow = THREE.MathUtils.damp(this.rainbow, rain < 0.25 ? this.rainCharge * (1 - this.state.overcast) : 0, 0.4, delta);
    this.wind.set(1, 0.4).multiplyScalar(1 + rain * 1.2 + storm * 1.8);

    if (this.previousCamera && delta > 0) {
      this.cameraVelocity.copy(cameraPosition).sub(this.previousCamera).divideScalar(delta).clampLength(0, 160);
    } else {
      this.previousCamera = new THREE.Vector3();
    }
    this.previousCamera.copy(cameraPosition);

    this.rain.visible = rain > 0.01 && this.fx;
    if (this.rain.visible) {
      const uniforms = this.rain.material.uniforms;
      const drift = 6 + storm * 10;
      this.fall.set(this.wind.x * drift, -RAIN_FALL, this.wind.y * drift);
      const offset = uniforms.uOffset.value.addScaledVector(this.fall, delta);
      offset.set(offset.x % RAIN_BOX, offset.y % RAIN_BOX, offset.z % RAIN_BOX);
      // Streaks follow the rain's motion relative to the camera, so diving into it reads as speed.
      uniforms.uStreak.value.copy(this.fall).sub(this.cameraVelocity).multiplyScalar(0.035);
      uniforms.uAmount.value = rain;
      uniforms.uColor.value.setRGB(0.6, 0.68, 0.8).multiplyScalar(0.12 + lightAmount * 0.75 + this.flash * 2);
    }

    if (storm > 0.6 && this.fx) {
      this.strikeTimer -= delta;
      if (this.strikeTimer <= 0) {
        this.strikeTimer = 4 + Math.random() * 9;
        this.strike(cameraPosition);
      }
    }
    this.flash *= Math.exp(-delta * 9);
    for (const entry of this.flashQueue) {
      entry[0] -= delta;
      if (entry[0] <= 0) {
        this.flash = Math.max(this.flash, entry[1]);
      }
    }
    this.flashQueue = this.flashQueue.filter((entry) => entry[0] > 0);
    if (this.boltLife > 0) {
      this.boltLife -= delta;
      this.bolt.visible = this.boltLife > 0 && this.flash > 0.25;
    }
  }
}
