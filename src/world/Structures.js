import * as THREE from "three";
import { BLOCK, L, RUNWAY, SEA_LEVEL } from "./TerrainGen.js";
import { hash2 } from "./Noise.js";
import { getTerrainMaterial } from "./WorldMaterials.js";

const FACES = [
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], u: 2, v: 1 },
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], u: 2, v: 1 },
  { n: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], u: 0, v: 2 },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], u: 0, v: 2 },
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], u: 0, v: 1 },
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], u: 0, v: 1 },
];

// Collects axis-aligned boxes into one geometry in the terrain vertex format,
// so a whole building is a single draw with the shared block material.
export class VoxelBuilder {
  constructor(origin = new THREE.Vector3()) {
    this.origin = origin;
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.layers = [];
    this.ao = [];
    this.sway = [];
    this.indices = [];
    this.colliders = [];
  }

  box(minX, minY, minZ, maxX, maxY, maxZ, layer, { solid = true, sway = 0, groundAo = true, bottom = true } = {}) {
    const min = [minX, minY, minZ];
    const size = [maxX - minX, maxY - minY, maxZ - minZ];
    for (const face of FACES) {
      if (!bottom && face.n[1] < 0) {
        continue;
      }
      const base = this.positions.length / 3;
      for (const corner of face.corners) {
        const p = [min[0] + corner[0] * size[0], min[1] + corner[1] * size[1], min[2] + corner[2] * size[2]];
        this.positions.push(p[0] - this.origin.x, p[1] - this.origin.y, p[2] - this.origin.z);
        this.normals.push(face.n[0] * 127, face.n[1] * 127, face.n[2] * 127);
        const v = face.v === 1 ? -p[1] / BLOCK : p[face.v] / BLOCK;
        this.uvs.push(p[face.u] / BLOCK, v);
        this.layers.push(layer);
        this.ao.push(groundAo && corner[1] === 0 && face.n[1] === 0 ? 170 : 255);
        this.sway.push(corner[1] * sway);
      }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    if (solid) {
      this.colliders.push({ minX, minY, minZ, maxX, maxY, maxZ });
    }
  }

  geometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Int8Array(this.normals), 3, true));
    geometry.setAttribute("aBlockUv", new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute("aLayer", new THREE.BufferAttribute(new Uint8Array(this.layers), 1));
    geometry.setAttribute("aAo", new THREE.BufferAttribute(new Uint8Array(this.ao), 1, true));
    geometry.setAttribute("aSway", new THREE.Float32BufferAttribute(this.sway, 1));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  mesh() {
    const mesh = new THREE.Mesh(this.geometry(), getTerrainMaterial());
    mesh.position.copy(this.origin);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }
}

function hangar(b, cx, cz) {
  const w = 40;
  const d = 44;
  const x0 = cx - w / 2;
  const z0 = cz - d / 2;
  b.box(x0, 0, z0, x0 + w, 18, z0 + d, L.metal);
  b.box(x0 - 0.6, 0, z0 + 6, x0, 14, z0 + d - 6, L.darkPlanks, { solid: false });
  b.box(x0, 18, z0, x0 + w, 20, z0 + d, L.metal);
  b.box(x0 + 5, 20, z0, x0 + w - 5, 22, z0 + d, L.metal);
  b.box(x0 + 11, 22, z0, x0 + w - 11, 24, z0 + d, L.metal);
  b.box(x0 + 2, 24, z0 + d / 2 - 1, x0 + 4, 25, z0 + d / 2 + 1, L.lamp, { solid: false });
}

export function buildAirport() {
  const b = new VoxelBuilder();

  hangar(b, 92, -58);
  hangar(b, 92, 38);

  b.box(64, 0, 222, 76, 24, 234, L.concrete);
  for (let y = 4; y < 24; y += 6) {
    b.box(63.6, y, 226, 64, y + 2, 230, L.window, { solid: false });
  }
  b.box(61, 24, 219, 79, 32, 237, L.window);
  b.box(59, 32, 217, 81, 34, 239, L.metal);
  b.box(68, 34, 226, 72, 36, 230, L.metal);
  b.box(69, 36, 227, 71, 38, 229, L.lamp, { solid: false });

  b.box(66, 0, 132, 118, 12, 162, L.bricks);
  for (let x = 70; x < 116; x += 6) {
    b.box(x, 4, 131.6, x + 4, 8, 132, L.window, { solid: false });
  }
  b.box(64, 12, 130, 120, 14, 164, L.concrete);

  for (const [x, z] of [[108, -134], [118, -134]]) {
    b.box(x - 4, 0, z - 4, x + 4, 10, z + 4, L.whiteWool);
    b.box(x - 3, 10, z - 3, x + 3, 12, z + 3, L.whiteWool);
  }

  b.box(30, 0, 380, 31, 10, 381, L.metal);
  b.box(31, 8.5, 379.75, 33, 10, 381.25, L.redWool, { solid: false, sway: 0 });
  b.box(33, 8.6, 379.85, 35, 9.9, 381.15, L.whiteWool, { solid: false });

  const lamp = { solid: false, groundAo: false };
  for (let z = -RUNWAY.halfLength; z <= RUNWAY.halfLength; z += 30) {
    for (const x of [-RUNWAY.halfWidth - 1.6, RUNWAY.halfWidth + 0.8]) {
      b.box(x, 0, z - 0.4, x + 0.8, 0.5, z + 0.4, L.lamp, lamp);
    }
  }
  for (const z of [-RUNWAY.halfLength - 2, RUNWAY.halfLength + 1.2]) {
    for (let x = -RUNWAY.halfWidth; x < RUNWAY.halfWidth; x += 3.5) {
      b.box(x + 1.3, 0, z, x + 2.1, 0.5, z + 0.8, L.lamp, lamp);
    }
  }
  for (let z = RUNWAY.halfLength + 20; z <= RUNWAY.halfLength + 180; z += 20) {
    for (const x of [-6, 0, 6]) {
      b.box(x - 0.3, 0, z - 0.3, x + 0.3, 2, z + 0.3, L.metal, { solid: false });
      b.box(x - 0.5, 2, z - 0.5, x + 0.5, 2.6, z + 0.5, L.lamp, lamp);
    }
  }

  return { mesh: b.mesh(), colliders: b.colliders };
}

function foundation(b, heightAt, minX, minZ, maxX, maxZ) {
  let low = Infinity;
  let high = -Infinity;
  for (let x = minX; x <= maxX; x += BLOCK * 2) {
    for (let z = minZ; z <= maxZ; z += BLOCK * 2) {
      const h = heightAt(x, z);
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
  }
  if (high - low > 0) {
    b.box(minX, low - BLOCK, minZ, maxX, high, maxZ, L.cobble);
  }
  return high;
}

function house(b, heightAt, x, z, w, d, random) {
  const base = foundation(b, heightAt, x - 1, z - 1, x + w + 1, z + d + 1);
  const wallHeight = 6 + (random() > 0.6 ? 4 : 0);
  b.box(x, base, z, x + w, base + wallHeight, z + d, L.oakPlanks);
  for (const [cx, cz] of [[x, z], [x + w - 2, z], [x, z + d - 2], [x + w - 2, z + d - 2]]) {
    b.box(cx - 0.1, base, cz - 0.1, cx + 2.1, base + wallHeight, cz + 2.1, L.logSide, { solid: false });
  }
  b.box(x + w / 2 - 1, base, z - 0.2, x + w / 2 + 1, base + 4, z, L.darkPlanks, { solid: false });
  for (let wx = x + 3; wx < x + w - 3; wx += 5) {
    b.box(wx, base + 2.5, z + d, wx + 2, base + 4.5, z + d + 0.2, L.window, { solid: false });
    b.box(wx, base + 2.5, z - 0.2, wx + 2, base + 4.5, z, L.window, { solid: false });
  }
  const roofBase = base + wallHeight;
  b.box(x - 1, roofBase, z - 1, x + w + 1, roofBase + 2, z + d + 1, L.roofTiles);
  b.box(x + 1, roofBase + 2, z - 1, x + w - 1, roofBase + 4, z + d + 1, L.roofTiles);
  b.box(x + 3, roofBase + 4, z - 1, x + w - 3, roofBase + 5, z + d + 1, L.roofTiles);
  if (random() > 0.5) {
    b.box(x + w - 4, roofBase + 2, z + 2, x + w - 2, roofBase + 8, z + 4, L.bricks);
    b.chimneys.push(new THREE.Vector3(x + w - 3, roofBase + 8.5, z + 3));
  }
}

function buildVillage(b, heightAt, lm, random) {
  const count = 4 + Math.floor(random() * 4);
  const placed = [];
  for (let i = 0; i < count * 4 && placed.length < count; i += 1) {
    const w = (5 + Math.floor(random() * 3)) * BLOCK;
    const d = (4 + Math.floor(random() * 2)) * BLOCK;
    const x = Math.round((lm.x + (random() - 0.5) * lm.radius * 1.7) / BLOCK) * BLOCK;
    const z = Math.round((lm.z + (random() - 0.5) * lm.radius * 1.7) / BLOCK) * BLOCK;
    if (placed.some((p) => x < p.x + p.w + 6 && x + w + 6 > p.x && z < p.z + p.d + 6 && z + d + 6 > p.z)) {
      continue;
    }
    placed.push({ x, z, w, d });
    house(b, heightAt, x, z, w, d, random);
  }
  const base = foundation(b, heightAt, lm.x - 4, lm.z - 4, lm.x + 4, lm.z + 4);
  b.box(lm.x - 3, base, lm.z - 3, lm.x + 3, base + 2, lm.z + 3, L.cobble);
  for (const [px, pz] of [[-3, -3], [2, -3], [-3, 2], [2, 2]]) {
    b.box(lm.x + px, base + 2, lm.z + pz, lm.x + px + 1, base + 5, lm.z + pz + 1, L.darkPlanks, { solid: false });
  }
  b.box(lm.x - 3.5, base + 5, lm.z - 3.5, lm.x + 3.5, base + 6, lm.z + 3.5, L.darkPlanks);
}

function buildWindmill(b, heightAt, lm) {
  const base = foundation(b, heightAt, lm.x - 6, lm.z - 6, lm.x + 6, lm.z + 6);
  b.box(lm.x - 5, base, lm.z - 5, lm.x + 5, base + 12, lm.z + 5, L.cobble);
  b.box(lm.x - 4, base + 12, lm.z - 4, lm.x + 4, base + 24, lm.z + 4, L.whiteWool);
  b.box(lm.x - 5, base + 24, lm.z - 5, lm.x + 5, base + 26, lm.z + 5, L.roofTiles);
  b.box(lm.x - 3, base + 26, lm.z - 3, lm.x + 3, base + 28, lm.z + 3, L.roofTiles);
  b.box(lm.x - 1, base + 4, lm.z - 4.6, lm.x + 1, base + 7, lm.z - 4, L.darkPlanks, { solid: false });
  const hubY = base + 20;
  const hubZ = lm.z - 5.5;
  b.box(lm.x - 1, hubY - 1, hubZ - 0.5, lm.x + 1, hubY + 1, lm.z - 4, L.darkPlanks);
  b.box(lm.x - 0.6, hubY - 16, hubZ - 1, lm.x + 0.6, hubY + 16, hubZ, L.darkPlanks);
  b.box(lm.x - 16, hubY - 0.6, hubZ - 1, lm.x + 16, hubY + 0.6, hubZ, L.darkPlanks);
  b.box(lm.x + 0.6, hubY + 4, hubZ - 0.9, lm.x + 3.6, hubY + 15, hubZ - 0.1, L.whiteWool, { solid: false });
  b.box(lm.x - 3.6, hubY - 15, hubZ - 0.9, lm.x - 0.6, hubY - 4, hubZ - 0.1, L.whiteWool, { solid: false });
  b.box(lm.x - 15, hubY + 0.6, hubZ - 0.9, lm.x - 4, hubY + 3.6, hubZ - 0.1, L.whiteWool, { solid: false });
  b.box(lm.x + 4, hubY - 3.6, hubZ - 0.9, lm.x + 15, hubY - 0.6, hubZ - 0.1, L.whiteWool, { solid: false });
}

function buildLighthouse(b, heightAt, lm) {
  const base = Math.max(foundation(b, heightAt, lm.x - 6, lm.z - 6, lm.x + 6, lm.z + 6), 0);
  b.box(lm.x - 6, base - 8, lm.z - 6, lm.x + 6, base + 2, lm.z + 6, L.cobble);
  for (let i = 0; i < 6; i += 1) {
    const y = base + 2 + i * 5;
    const inset = i * 0.2;
    b.box(lm.x - 3 + inset, y, lm.z - 3 + inset, lm.x + 3 - inset, y + 5, lm.z + 3 - inset, i % 2 ? L.redWool : L.whiteWool);
  }
  const top = base + 32;
  b.box(lm.x - 4.5, top, lm.z - 4.5, lm.x + 4.5, top + 1, lm.z + 4.5, L.metal);
  b.box(lm.x - 2, top + 1, lm.z - 2, lm.x + 2, top + 4.5, lm.z + 2, L.lamp);
  b.box(lm.x - 2.6, top + 4.5, lm.z - 2.6, lm.x + 2.6, top + 6, lm.z + 2.6, L.redWool);
  b.box(lm.x - 1, top + 6, lm.z - 1, lm.x + 1, top + 7, lm.z + 1, L.redWool);
}

function buildPyramid(b, heightAt, lm) {
  const half = lm.radius;
  const base = foundation(b, heightAt, lm.x - half, lm.z - half, lm.x + half, lm.z + half);
  for (let step = 0; step * 2 < half; step += 1) {
    const inset = step * 2;
    b.box(lm.x - half + inset, base + step * 2, lm.z - half + inset, lm.x + half - inset, base + step * 2 + 2, lm.z + half - inset, L.sandstone);
  }
  b.box(lm.x - 2, base, lm.z - half - 0.2, lm.x + 2, base + 5, lm.z - half, L.darkPlanks, { solid: false });
}

function buildTower(b, heightAt, lm) {
  const base = foundation(b, heightAt, lm.x - 6, lm.z - 6, lm.x + 6, lm.z + 6);
  b.box(lm.x - 5, base, lm.z - 5, lm.x + 5, base + 26, lm.z + 5, L.cobble);
  b.box(lm.x - 6, base + 26, lm.z - 6, lm.x + 6, base + 28, lm.z + 6, L.cobble);
  for (const [cx, cz] of [[-6, -6], [4, -6], [-6, 4], [4, 4], [-1, -6], [-1, 4], [-6, -1], [4, -1]]) {
    b.box(lm.x + cx, base + 28, lm.z + cz, lm.x + cx + 2, base + 30, lm.z + cz + 2, L.cobble);
  }
  for (let y = base + 6; y < base + 24; y += 7) {
    b.box(lm.x - 1, y, lm.z - 5.2, lm.x + 1, y + 2.5, lm.z - 5, L.window, { solid: false });
  }
  b.box(lm.x - 0.3, base + 28, lm.z - 0.3, lm.x + 0.3, base + 36, lm.z + 0.3, L.darkPlanks, { solid: false });
  b.box(lm.x + 0.3, base + 33, lm.z - 0.2, lm.x + 4.3, base + 35.5, lm.z + 0.2, L.redWool, { solid: false });
}

// A grid of office towers with lit window bands, streets between them and beacons on the roofs.
function buildCity(b, heightAt, lm, random) {
  const lot = 30;
  for (let gx = -2; gx <= 2; gx += 1) {
    for (let gz = -2; gz <= 2; gz += 1) {
      const centre = Math.hypot(gx, gz);
      if (centre > 2.6 || random() < 0.12) {
        continue;
      }
      const w = (6 + Math.floor(random() * 3)) * BLOCK;
      const d = (6 + Math.floor(random() * 3)) * BLOCK;
      const x = lm.x + gx * lot - w / 2;
      const z = lm.z + gz * lot - d / 2;
      const base = foundation(b, heightAt, x - 2, z - 2, x + w + 2, z + d + 2);
      b.box(x - 4, base, z - 4, x + w + 4, base + 0.3, z + d + 4, L.asphalt, { solid: false, groundAo: false });
      // Taller towers in the middle give the skyline a peak.
      const floors = Math.round((3 - centre) * 5 + random() * 8) + 3;
      const height = floors * 4;
      const wall = random() < 0.5 ? L.whiteConcrete : L.concrete;
      b.box(x, base, z, x + w, base + height, z + d, wall);
      for (let y = base + 3; y < base + height - 1; y += 4) {
        b.box(x - 0.2, y, z + 1, x, y + 2, z + d - 1, L.window, { solid: false });
        b.box(x + w, y, z + 1, x + w + 0.2, y + 2, z + d - 1, L.window, { solid: false });
        b.box(x + 1, y, z - 0.2, x + w - 1, y + 2, z, L.window, { solid: false });
        b.box(x + 1, y, z + d, x + w - 1, y + 2, z + d + 0.2, L.window, { solid: false });
      }
      b.box(x + 2, base + height, z + 2, x + w - 2, base + height + 2, z + d - 2, L.metal);
      if (floors > 12) {
        b.box(x + w / 2 - 0.3, base + height + 2, z + d / 2 - 0.3, x + w / 2 + 0.3, base + height + 12, z + d / 2 + 0.3, L.metal, { solid: false });
        b.box(x + w / 2 - 0.6, base + height + 12, z + d / 2 - 0.6, x + w / 2 + 0.6, base + height + 13.2, z + d / 2 + 0.6, L.lamp, { solid: false });
      }
    }
  }
}

// A long road bridge over a strait: piers in the water, two suspension towers, high enough to fly under.
function buildBridge(b, heightAt, lm) {
  const deck = SEA_LEVEL + 36;
  const along = lm.axis === "x";
  // Boxes are described along the span (s) and across it (t), then turned onto the world axes.
  const span = (s0, y0, t0, s1, y1, t1, layer, options) => {
    if (along) {
      b.box(lm.x + s0, y0, lm.z + t0, lm.x + s1, y1, lm.z + t1, layer, options);
    } else {
      b.box(lm.x + t0, y0, lm.z + s0, lm.x + t1, y1, lm.z + s1, layer, options);
    }
  };
  const ground = (s) => (along ? heightAt(lm.x + s, lm.z) : heightAt(lm.x, lm.z + s));
  span(lm.from, deck, -7, lm.to, deck + 2, 7, L.concrete);
  span(lm.from, deck + 2, -7, lm.to, deck + 2.2, -1, L.asphalt, { solid: false });
  span(lm.from, deck + 2, 1, lm.to, deck + 2.2, 7, L.asphalt, { solid: false });
  span(lm.from, deck + 2, -0.5, lm.to, deck + 2.25, 0.5, L.whiteConcrete, { solid: false });
  span(lm.from, deck + 2, -7.5, lm.to, deck + 3.5, -7, L.metal, { solid: false });
  span(lm.from, deck + 2, 7, lm.to, deck + 3.5, 7.5, L.metal, { solid: false });
  // Piers at each end and every 60 blocks, in pairs so the middle stays open to fly through.
  for (let s = lm.from + 6; s < lm.to - 4; s += 60) {
    const floor = Math.min(ground(s), SEA_LEVEL) - 4;
    for (const t of [-7, 4]) {
      span(s - 2, floor, t, s + 2, deck, t + 3, L.cobble);
    }
  }
  const length = lm.to - lm.from;
  for (const s of [lm.from + length / 3, lm.from + (length * 2) / 3]) {
    for (const t of [-8, 6]) {
      span(s - 2, Math.min(ground(s), SEA_LEVEL) - 4, t, s + 2, deck + 40, t + 2, L.redWool);
    }
    span(s - 2, deck + 36, -8, s + 2, deck + 39, 8, L.redWool);
    span(s - 0.5, deck + 40, -7.5, s + 0.5, deck + 41.2, -6.5, L.lamp, { solid: false });
    span(s - 0.5, deck + 40, 6.5, s + 0.5, deck + 41.2, 7.5, L.lamp, { solid: false });
  }
  // Cables sag from tower to tower and down to the anchorages, drawn as stepped runs.
  const towers = [lm.from + length / 3, lm.from + (length * 2) / 3];
  const anchors = [lm.from, towers[0], towers[1], lm.to];
  for (let k = 0; k < 3; k += 1) {
    const a = anchors[k];
    const c = anchors[k + 1];
    const steps = Math.max(4, Math.round((c - a) / 8));
    for (let i = 0; i < steps; i += 1) {
      const u = (i + 0.5) / steps;
      const ends = [k === 0 ? deck + 3 : deck + 39, k === 2 ? deck + 3 : deck + 39];
      const y = ends[0] + (ends[1] - ends[0]) * u - (k === 1 ? Math.sin(u * Math.PI) * 30 : 0);
      for (const t of [-7.3, 7.3]) {
        span(a + ((c - a) * i) / steps, y, t - 0.3, a + ((c - a) * (i + 1)) / steps, y + 0.6, t + 0.3, L.metal, { solid: false });
      }
    }
  }
}

// A natural rock arch big enough to fly through.
function buildArch(b, heightAt, lm, random) {
  const layer = L[lm.rock] ?? L.sandstone;
  const along = random() < 0.5;
  const gap = 26;
  const top = foundation(b, heightAt, lm.x - 8, lm.z - 8, lm.x + 8, lm.z + 8) + 46;
  const box = (s0, y0, t0, s1, y1, t1) =>
    along ? b.box(lm.x + s0, y0, lm.z + t0, lm.x + s1, y1, lm.z + t1, layer) : b.box(lm.x + t0, y0, lm.z + s0, lm.x + t1, y1, lm.z + s1, layer);
  for (const side of [-1, 1]) {
    const s = side * (gap + 7);
    const floor = (along ? heightAt(lm.x + s, lm.z) : heightAt(lm.x, lm.z + s)) - BLOCK * 2;
    box(s - 9, floor, -8, s + 9, top - 8, 8);
    box(s - 7, top - 8, -7, s + 7, top, 7);
  }
  box(-gap - 14, top - 10, -6, gap + 14, top, 6);
  box(-gap + 6, top - 13, -5, gap - 6, top - 10, 5);
  box(-gap - 10, top, -5, gap + 10, top + 3, 5);
}

// Earth islands hanging in the sky, each with grass on top and an oak tree.
function buildIslands(b, heightAt, lm, random) {
  const ground = heightAt(lm.x, lm.z);
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + random();
    const x = Math.round((lm.x + Math.cos(angle) * (i === 0 ? 0 : 40)) / BLOCK) * BLOCK;
    const z = Math.round((lm.z + Math.sin(angle) * (i === 0 ? 0 : 40)) / BLOCK) * BLOCK;
    const top = Math.min(ground + 95 + i * 18 + random() * 10, 250);
    const size = i === 0 ? 14 : 9;
    b.box(x - size, top - 2, z - size, x + size, top, z + size, L.grassTop);
    for (let layer = 1; layer <= 5; layer += 1) {
      const inset = layer * (size / 6);
      b.box(x - size + inset, top - 2 - layer * 3, z - size + inset, x + size - inset, top - 2 - (layer - 1) * 3, z + size - inset, layer < 2 ? L.dirt : L.stone);
    }
    b.box(x - 1, top, z - 1, x + 1, top + 10, z + 1, L.logSide);
    b.box(x - 5, top + 6, z - 5, x + 5, top + 10, z + 5, L.leaves);
    b.box(x - 3, top + 10, z - 3, x + 3, top + 13, z + 3, L.leaves);
  }
}

// A curtain wall with corner towers, a gatehouse and a central keep flying a banner.
function buildCastle(b, heightAt, lm) {
  const half = 32;
  const base = foundation(b, heightAt, lm.x - half - 6, lm.z - half - 6, lm.x + half + 6, lm.z + half + 6);
  const wall = 16;
  const x0 = lm.x - half;
  const x1 = lm.x + half;
  const z0 = lm.z - half;
  const z1 = lm.z + half;
  b.box(x0, base, z0, x1, base + wall, z0 + 3, L.cobble);
  b.box(x0, base, z1 - 3, x1, base + wall, z1, L.cobble);
  b.box(x0, base, z0, x0 + 3, base + wall, z1, L.cobble);
  b.box(x1 - 3, base, z0, x1, base + wall, z1, L.cobble);
  for (let t = -half; t < half; t += 4) {
    b.box(lm.x + t, base + wall, z0, lm.x + t + 2, base + wall + 2, z0 + 3, L.cobble);
    b.box(lm.x + t, base + wall, z1 - 3, lm.x + t + 2, base + wall + 2, z1, L.cobble);
    b.box(x0, base + wall, lm.z + t, x0 + 3, base + wall + 2, lm.z + t + 2, L.cobble);
    b.box(x1 - 3, base + wall, lm.z + t, x1, base + wall + 2, lm.z + t + 2, L.cobble);
  }
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    b.box(cx - 6, base, cz - 6, cx + 6, base + 28, cz + 6, L.cobble);
    b.box(cx - 7, base + 28, cz - 7, cx + 7, base + 30, cz + 7, L.cobble);
    b.box(cx - 5, base + 30, cz - 5, cx + 5, base + 33, cz + 5, L.roofTiles);
    b.box(cx - 3, base + 33, cz - 3, cx + 3, base + 36, cz + 3, L.roofTiles);
  }
  b.box(lm.x - 8, base, z0 - 3, lm.x + 8, base + wall + 6, z0 + 5, L.cobble);
  b.box(lm.x - 3, base, z0 - 3.2, lm.x + 3, base + 9, z0 - 3, L.darkPlanks, { solid: false });
  b.box(lm.x - 10, base, lm.z - 10, lm.x + 10, base + 32, lm.z + 10, L.cobble);
  for (let y = base + 8; y < base + 30; y += 8) {
    b.box(lm.x - 1, y, lm.z - 10.2, lm.x + 1, y + 3, lm.z - 10, L.window, { solid: false });
  }
  b.box(lm.x - 11, base + 32, lm.z - 11, lm.x + 11, base + 34, lm.z + 11, L.cobble);
  b.box(lm.x - 0.3, base + 34, lm.z - 0.3, lm.x + 0.3, base + 46, lm.z + 0.3, L.darkPlanks, { solid: false });
  b.box(lm.x + 0.3, base + 41, lm.z - 0.2, lm.x + 6.3, base + 45, lm.z + 0.2, L.redWool, { solid: false });
}

// Several windmills standing in striped wheat fields.
function buildWindfarm(b, heightAt, lm, random) {
  // Small patches laid on the ground where they are, so the field follows the terrain.
  const centre = heightAt(lm.x, lm.z);
  for (let row = -3; row <= 3; row += 1) {
    for (let col = -5; col < 5; col += 1) {
      const x = lm.x + col * 12;
      const z = lm.z + row * 16 - 6;
      const ground = heightAt(x + 6, z + 6);
      if (Math.abs(ground - centre) > 12 || ground <= SEA_LEVEL) {
        continue;
      }
      b.box(x, ground, z, x + 12, ground + 0.6, z + 12, row % 2 ? L.flowerYellow : L.dirt, { solid: false, groundAo: false });
    }
  }
  const spots = [[-38, -30], [6, -42], [40, -10], [-20, 18], [28, 40]];
  for (const [dx, dz] of spots.slice(0, 3 + Math.floor(random() * 3))) {
    buildWindmill(b, heightAt, { x: lm.x + dx, z: lm.z + dz });
  }
}

// A lighthouse on the point, a wooden pier running out to sea and warehouses on the quay.
function buildHarbor(b, heightAt, lm, random) {
  const [sx, sz] = lm.seaward;
  const across = [-sz, sx];
  const at = (s, t) => [lm.x + sx * s + across[0] * t, lm.z + sz * s + across[1] * t];
  const light = at(-6, -34);
  buildLighthouse(b, heightAt, { x: light[0], z: light[1] });
  const deck = SEA_LEVEL + 2.5;
  const [p0x, p0z] = at(-10, -4);
  const [p1x, p1z] = at(110, 4);
  b.box(Math.min(p0x, p1x), deck, Math.min(p0z, p1z), Math.max(p0x, p1x), deck + 1, Math.max(p0z, p1z), L.oakPlanks);
  for (let s = 0; s <= 110; s += 12) {
    for (const t of [-4, 3]) {
      const [px, pz] = at(s, t);
      b.box(px, SEA_LEVEL - 8, pz, px + 1, deck, pz + 1, L.logSide);
    }
  }
  const [h0x, h0z] = at(96, -18);
  const [h1x, h1z] = at(110, 18);
  b.box(Math.min(h0x, h1x), deck, Math.min(h0z, h1z), Math.max(h0x, h1x), deck + 1, Math.max(h0z, h1z), L.oakPlanks);
  for (const t of [14, 30]) {
    const [hx, hz] = at(-30, t);
    house(b, heightAt, Math.round(hx / BLOCK) * BLOCK, Math.round(hz / BLOCK) * BLOCK, 12, 10, random);
  }
}

const LANDMARK_BUILDERS = {
  village: buildVillage,
  windmill: buildWindmill,
  lighthouse: buildLighthouse,
  pyramid: buildPyramid,
  tower: buildTower,
  city: buildCity,
  bridge: buildBridge,
  arch: buildArch,
  islands: buildIslands,
  castle: buildCastle,
  windfarm: buildWindfarm,
  harbor: buildHarbor,
};

export function buildLandmark(lm, heightAt) {
  let seed = lm.seed;
  const random = () => {
    seed += 1;
    return hash2(seed, lm.x, lm.z);
  };
  const b = new VoxelBuilder(new THREE.Vector3(lm.x, 0, lm.z));
  b.chimneys = [];
  LANDMARK_BUILDERS[lm.type](b, heightAt, lm, random);
  return { mesh: b.mesh(), colliders: b.colliders, chimneys: b.chimneys };
}
