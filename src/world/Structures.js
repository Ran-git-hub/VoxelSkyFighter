import * as THREE from "three";
import { BLOCK, L, RUNWAY } from "./TerrainGen.js";
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

const LANDMARK_BUILDERS = {
  village: buildVillage,
  windmill: buildWindmill,
  lighthouse: buildLighthouse,
  pyramid: buildPyramid,
  tower: buildTower,
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
