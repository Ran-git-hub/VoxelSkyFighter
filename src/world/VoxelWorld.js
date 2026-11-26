import * as THREE from "three";
import {
  BLOCK,
  LANDMARK_CELL,
  RUNWAY,
  SEA_LEVEL,
  TREE_CELL,
  WORLD_SEED,
  heightBlocksAt,
  landmarkInCell,
  treeBoxes,
  treeInCell,
  treeVisibleAtDensity,
} from "./TerrainGen.js";
import { getTerrainMaterial, getWaterMaterial } from "./WorldMaterials.js";
import { Vegetation } from "./Vegetation.js";
import { buildAirport, buildLandmark } from "./Structures.js";

export const FAR_LAYER = 1;
// Mid-range chunks still cast shadows but are skipped by the AO normal pass.
export const MID_LAYER = 2;
// Water sits on its own layer so the reflection camera can leave it out.
export const WATER_LAYER = 3;
const LEAF_SIZE = 128;
const ROOT_SIZE = 2048;
const LEAF_COLUMNS = LEAF_SIZE / BLOCK;
const REPLAN_DISTANCE = 24;
const VEGETATION_REPLAN_DISTANCE = 40;
const MESH_BUDGET_MS = 4;
const LANDMARK_LOAD_RADIUS = 1500;
const LANDMARK_DROP_RADIUS = 1800;
const MAX_CACHE = 200000;
const SHADOW_CAST_DISTANCE = 260;

const columnKey = (i, j) => i * 2097152 + j;

function overlaps(a, b) {
  return a.x0 < b.x0 + b.size && a.x0 + a.size > b.x0 && a.z0 < b.z0 + b.size && a.z0 + a.size > b.z0;
}

function ellipsoidHitsBox(position, radius, verticalRadius, box) {
  const dx = Math.max(box.minX - position.x, 0, position.x - box.maxX);
  const dy = Math.max(box.minY - position.y, 0, position.y - box.maxY);
  const dz = Math.max(box.minZ - position.z, 0, position.z - box.maxZ);
  return (dx * dx + dz * dz) / (radius * radius) + (dy * dy) / (verticalRadius * verticalRadius) <= 1;
}

// Infinite voxel terrain: a quadtree of chunks around the focus, meshed in
// workers, with collision answered analytically from the same height function.
export class VoxelWorld {
  constructor(scene) {
    this.scene = scene;
    this.seaLevel = SEA_LEVEL;
    this.runway = {
      position: new THREE.Vector3(0, 0, 0),
      direction: new THREE.Vector3(0, 0, -1),
      length: RUNWAY.length,
      width: RUNWAY.width,
    };
    this.viewDistance = 1200;
    this.lodFactor = 1.2;
    this.chunks = new Map();
    this.desired = [];
    this.queue = [];
    this.results = [];
    this.planFocus = new THREE.Vector3(Infinity, 0, Infinity);
    this.vegetationFocus = new THREE.Vector3(Infinity, 0, Infinity);
    this.visibilityDirty = false;
    this.vegetationDirty = false;
    this.heightCache = new Map();
    this.treeCache = new Map();
    this.heightGrids = new Map();
    this.landmarks = new Map();
    this.treeScratch = { type: 0, x: 0, y: 0, z: 0, scale: 1, tint: 0 };
    this.boxScratch = [];

    this.terrainMaterial = getTerrainMaterial();
    this.waterMaterial = getWaterMaterial();
    this.vegetation = new Vegetation(scene);

    const airport = buildAirport();
    scene.add(airport.mesh);
    this.structures = [{ key: "airport", mesh: airport.mesh, colliders: airport.colliders, bounds: this.boundsOf(airport.colliders) }];

    const workerCount = THREE.MathUtils.clamp((navigator.hardwareConcurrency || 4) - 1, 1, 3);
    this.workers = Array.from({ length: workerCount }, () => {
      const url = new URL("./chunkWorker.js", import.meta.url);
      url.searchParams.set("seed", WORLD_SEED);
      const worker = new Worker(url, { type: "module" });
      worker.busy = false;
      worker.onmessage = (event) => {
        worker.busy = false;
        this.results.push(event.data);
        this.dispatch();
      };
      worker.onerror = (event) => {
        worker.busy = false;
        console.error("Chunk worker failed", event.message);
      };
      return worker;
    });
  }

  setViewDistance(distance, lodFactor) {
    this.viewDistance = distance;
    this.lodFactor = lodFactor;
    this.planFocus.set(Infinity, 0, Infinity);
  }

  setVegetationDensity(density, plantRadius, treeRadius) {
    this.vegetation.setDensity(density, plantRadius, treeRadius);
    this.vegetationDirty = true;
  }

  boundsOf(boxes) {
    const bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    for (const box of boxes) {
      bounds.minX = Math.min(bounds.minX, box.minX);
      bounds.minY = Math.min(bounds.minY, box.minY);
      bounds.minZ = Math.min(bounds.minZ, box.minZ);
      bounds.maxX = Math.max(bounds.maxX, box.maxX);
      bounds.maxY = Math.max(bounds.maxY, box.maxY);
      bounds.maxZ = Math.max(bounds.maxZ, box.maxZ);
    }
    return bounds;
  }

  update(focus) {
    const dx = focus.x - this.planFocus.x;
    const dz = focus.z - this.planFocus.z;
    if (!Number.isFinite(dx) || dx * dx + dz * dz > REPLAN_DISTANCE * REPLAN_DISTANCE) {
      this.planFocus.copy(focus);
      this.plan(focus);
      this.updateLandmarks(focus);
    }

    const start = performance.now();
    while (this.results.length > 0 && performance.now() - start < MESH_BUDGET_MS) {
      this.receive(this.results.shift());
    }
    if (this.visibilityDirty) {
      this.visibilityDirty = false;
      this.reconcile();
    }

    const vx = focus.x - this.vegetationFocus.x;
    const vz = focus.z - this.vegetationFocus.z;
    if (this.vegetationDirty || !Number.isFinite(vx) || vx * vx + vz * vz > VEGETATION_REPLAN_DISTANCE * VEGETATION_REPLAN_DISTANCE) {
      this.vegetationDirty = false;
      this.vegetationFocus.copy(focus);
      const sources = [];
      for (const chunk of this.chunks.values()) {
        if (chunk.visible && (chunk.trees || chunk.plants)) {
          sources.push(chunk);
        }
      }
      this.vegetation.rebuild(sources, focus);
    }
  }

  plan(focus) {
    const leaves = [];
    const radius = this.viewDistance;
    const collect = (x0, z0, size) => {
      const dx = Math.max(x0 - focus.x, 0, focus.x - (x0 + size));
      const dz = Math.max(z0 - focus.z, 0, focus.z - (z0 + size));
      const distance = Math.hypot(dx, dz);
      if (distance > radius) {
        return;
      }
      if (size > LEAF_SIZE && distance < size * this.lodFactor) {
        const half = size / 2;
        collect(x0, z0, half);
        collect(x0 + half, z0, half);
        collect(x0, z0 + half, half);
        collect(x0 + half, z0 + half, half);
        return;
      }
      leaves.push({ key: `${size}:${x0}:${z0}`, x0, z0, size, distance });
    };
    const minI = Math.floor((focus.x - radius) / ROOT_SIZE);
    const maxI = Math.floor((focus.x + radius) / ROOT_SIZE);
    const minJ = Math.floor((focus.z - radius) / ROOT_SIZE);
    const maxJ = Math.floor((focus.z + radius) / ROOT_SIZE);
    for (let j = minJ; j <= maxJ; j += 1) {
      for (let i = minI; i <= maxI; i += 1) {
        collect(i * ROOT_SIZE, j * ROOT_SIZE, ROOT_SIZE);
      }
    }

    this.desired = leaves;
    for (const chunk of this.chunks.values()) {
      this.updateShadowCasting(chunk);
    }
    const wanted = new Set(leaves.map((leaf) => leaf.key));
    this.queue = this.queue.filter((leaf) => wanted.has(leaf.key));
    for (const leaf of leaves) {
      if (!this.chunks.has(leaf.key)) {
        this.chunks.set(leaf.key, { ...leaf, state: "queued", visible: false });
        this.queue.push(leaf);
      }
    }
    for (const [key, chunk] of this.chunks) {
      if (!wanted.has(key) && chunk.state === "queued") {
        this.chunks.delete(key);
      }
    }
    for (const leaf of this.queue) {
      const dx = Math.max(leaf.x0 - focus.x, 0, focus.x - (leaf.x0 + leaf.size));
      const dz = Math.max(leaf.z0 - focus.z, 0, focus.z - (leaf.z0 + leaf.size));
      leaf.distance = Math.hypot(dx, dz);
    }
    // Nearest first so the ground under the player is never the last to load.
    this.queue.sort((a, b) => a.distance - b.distance);
    this.visibilityDirty = true;
    this.dispatch();
  }

  dispatch() {
    for (const worker of this.workers) {
      if (worker.busy || this.queue.length === 0) {
        continue;
      }
      const leaf = this.queue.shift();
      const chunk = this.chunks.get(leaf.key);
      if (!chunk) {
        continue;
      }
      chunk.state = "building";
      worker.busy = true;
      worker.postMessage({
        key: leaf.key,
        x0: leaf.x0,
        z0: leaf.z0,
        size: leaf.size,
        cols: leaf.size >= 512 ? 32 : LEAF_COLUMNS,
        vegetation: leaf.size <= LEAF_SIZE * 2,
        grass: leaf.size === LEAF_SIZE,
      });
    }
  }

  receive({ key, result }) {
    const chunk = this.chunks.get(key);
    if (!chunk || chunk.state !== "building") {
      return;
    }
    const far = chunk.size >= LEAF_SIZE * 4;
    chunk.mesh = this.createTerrainMesh(result.terrain, chunk, far);
    chunk.water = result.water ? this.createWaterMesh(result.water, chunk) : null;
    chunk.trees = result.trees || null;
    chunk.plants = result.plants || null;
    if (result.heights) {
      this.heightGrids.set(`${chunk.x0}:${chunk.z0}`, result.heights);
      chunk.heightKey = `${chunk.x0}:${chunk.z0}`;
    }
    chunk.state = "ready";
    this.updateShadowCasting(chunk);
    this.visibilityDirty = true;
  }

  // Only nearby full-resolution chunks cast: every caster is drawn again per
  // cascade, and coarser chunks turned out to cost more triangles, not fewer.
  updateShadowCasting(chunk) {
    if (!chunk.mesh) {
      return;
    }
    const dx = Math.max(chunk.x0 - this.planFocus.x, 0, this.planFocus.x - (chunk.x0 + chunk.size));
    const dz = Math.max(chunk.z0 - this.planFocus.z, 0, this.planFocus.z - (chunk.z0 + chunk.size));
    const distance = Math.hypot(dx, dz);
    chunk.mesh.castShadow = chunk.size === LEAF_SIZE && distance < SHADOW_CAST_DISTANCE;
  }

  createTerrainMesh(data, chunk, far) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3, true));
    geometry.setAttribute("aBlockUv", new THREE.BufferAttribute(data.uvs, 2));
    geometry.setAttribute("aLayer", new THREE.BufferAttribute(data.layers, 1));
    geometry.setAttribute("aAo", new THREE.BufferAttribute(data.ao, 1, true));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
    mesh.position.set(chunk.x0, 0, chunk.z0);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    if (far) {
      mesh.layers.set(FAR_LAYER);
    } else if (chunk.size > LEAF_SIZE) {
      mesh.layers.set(MID_LAYER);
    }
    return mesh;
  }

  createWaterMesh(data, chunk) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute("aDepth", new THREE.BufferAttribute(data.layers, 1));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.waterMaterial);
    mesh.position.set(chunk.x0, 0, chunk.z0);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.layers.set(WATER_LAYER);
    return mesh;
  }

  // A replaced chunk stays on screen until every chunk covering its area is
  // ready, so LOD changes and fast flight never open holes in the ground.
  reconcile() {
    const wanted = new Set(this.desired.map((leaf) => leaf.key));
    const kept = [];
    for (const [key, chunk] of this.chunks) {
      if (wanted.has(key) || chunk.state !== "ready") {
        continue;
      }
      if (!chunk.visible) {
        this.disposeChunk(chunk);
        continue;
      }
      const covered = this.desired.every((leaf) => !overlaps(leaf, chunk) || this.chunks.get(leaf.key)?.state === "ready");
      if (covered) {
        this.disposeChunk(chunk);
      } else {
        kept.push(chunk);
      }
    }
    for (const leaf of this.desired) {
      const chunk = this.chunks.get(leaf.key);
      if (!chunk || chunk.state !== "ready") {
        continue;
      }
      this.setChunkVisible(chunk, !kept.some((old) => overlaps(old, chunk)));
    }
    this.vegetationDirty = true;
  }

  setChunkVisible(chunk, visible) {
    if (chunk.visible === visible) {
      return;
    }
    chunk.visible = visible;
    for (const mesh of [chunk.mesh, chunk.water]) {
      if (!mesh) {
        continue;
      }
      if (visible) {
        this.scene.add(mesh);
      } else {
        this.scene.remove(mesh);
      }
    }
  }

  disposeChunk(chunk) {
    this.setChunkVisible(chunk, false);
    chunk.mesh?.geometry.dispose();
    chunk.water?.geometry.dispose();
    if (chunk.heightKey) {
      this.heightGrids.delete(chunk.heightKey);
    }
    this.chunks.delete(chunk.key);
  }

  updateLandmarks(focus) {
    const reach = Math.ceil(LANDMARK_LOAD_RADIUS / LANDMARK_CELL);
    const ci = Math.floor(focus.x / LANDMARK_CELL);
    const cj = Math.floor(focus.z / LANDMARK_CELL);
    for (let j = cj - reach; j <= cj + reach; j += 1) {
      for (let i = ci - reach; i <= ci + reach; i += 1) {
        const key = `${i}:${j}`;
        if (this.landmarks.has(key)) {
          continue;
        }
        const landmark = landmarkInCell(i, j);
        if (!landmark || Math.hypot(landmark.x - focus.x, landmark.z - focus.z) > LANDMARK_LOAD_RADIUS) {
          continue;
        }
        const built = buildLandmark(landmark, (x, z) => this.heightAt(x, z));
        this.scene.add(built.mesh);
        const structure = { key, landmark, mesh: built.mesh, colliders: built.colliders, chimneys: built.chimneys, bounds: this.boundsOf(built.colliders) };
        this.landmarks.set(key, structure);
        this.structures.push(structure);
        // One landmark per replan keeps the main-thread cost to a couple of milliseconds.
        return;
      }
    }
    for (const [key, structure] of this.landmarks) {
      if (Math.hypot(structure.landmark.x - focus.x, structure.landmark.z - focus.z) > LANDMARK_DROP_RADIUS) {
        this.scene.remove(structure.mesh);
        structure.mesh.geometry.dispose();
        this.landmarks.delete(key);
        this.structures.splice(this.structures.indexOf(structure), 1);
      }
    }
  }

  heightAt(x, z) {
    const i = Math.floor(x / BLOCK);
    const j = Math.floor(z / BLOCK);
    const leafX = Math.floor(x / LEAF_SIZE) * LEAF_SIZE;
    const leafZ = Math.floor(z / LEAF_SIZE) * LEAF_SIZE;
    const grid = this.heightGrids.get(`${leafX}:${leafZ}`);
    if (grid) {
      return grid[(j - leafZ / BLOCK) * LEAF_COLUMNS + (i - leafX / BLOCK)] * BLOCK;
    }
    const key = columnKey(i, j);
    let blocks = this.heightCache.get(key);
    if (blocks === undefined) {
      if (this.heightCache.size > MAX_CACHE) {
        this.heightCache.clear();
      }
      blocks = heightBlocksAt((i + 0.5) * BLOCK, (j + 0.5) * BLOCK);
      this.heightCache.set(key, blocks);
    }
    return blocks * BLOCK;
  }

  treeAt(cx, cz) {
    const key = columnKey(cx, cz);
    let tree = this.treeCache.get(key);
    if (tree === undefined) {
      if (this.treeCache.size > MAX_CACHE) {
        this.treeCache.clear();
      }
      tree = treeInCell(cx, cz, this.treeScratch) ? { ...this.treeScratch } : null;
      this.treeCache.set(key, tree);
    }
    return tree;
  }

  // Sea, terrain columns, trees and buildings. The vertical radius lets flat
  // shapes like aircraft sit on the runway without counting as a crash.
  collide(position, radius, verticalRadius = radius) {
    if (position.y - verticalRadius < SEA_LEVEL) {
      return { kind: "water" };
    }

    const minI = Math.floor((position.x - radius) / BLOCK);
    const maxI = Math.floor((position.x + radius) / BLOCK);
    const minJ = Math.floor((position.z - radius) / BLOCK);
    const maxJ = Math.floor((position.z + radius) / BLOCK);
    const column = { minX: 0, minY: -Infinity, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
    for (let j = minJ; j <= maxJ; j += 1) {
      for (let i = minI; i <= maxI; i += 1) {
        column.maxY = this.heightAt((i + 0.5) * BLOCK, (j + 0.5) * BLOCK);
        if (position.y - verticalRadius > column.maxY) {
          continue;
        }
        column.minX = i * BLOCK;
        column.maxX = column.minX + BLOCK;
        column.minZ = j * BLOCK;
        column.maxZ = column.minZ + BLOCK;
        if (ellipsoidHitsBox(position, radius, verticalRadius, column)) {
          return { kind: "terrain" };
        }
      }
    }

    const reach = radius + TREE_CELL;
    const minCx = Math.floor((position.x - reach) / TREE_CELL);
    const maxCx = Math.floor((position.x + reach) / TREE_CELL);
    const minCz = Math.floor((position.z - reach) / TREE_CELL);
    const maxCz = Math.floor((position.z + reach) / TREE_CELL);
    for (let cz = minCz; cz <= maxCz; cz += 1) {
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        if (!treeVisibleAtDensity(cx, cz, this.vegetation.density)) {
          continue;
        }
        const tree = this.treeAt(cx, cz);
        if (!tree || position.y - verticalRadius > tree.y + tree.scale * 8) {
          continue;
        }
        for (const box of treeBoxes(tree, this.boxScratch)) {
          if (ellipsoidHitsBox(position, radius, verticalRadius, box)) {
            return { kind: "tree" };
          }
        }
      }
    }

    for (const structure of this.structures) {
      if (!ellipsoidHitsBox(position, radius, verticalRadius, structure.bounds)) {
        continue;
      }
      for (const box of structure.colliders) {
        if (ellipsoidHitsBox(position, radius, verticalRadius, box)) {
          return { kind: "structure" };
        }
      }
    }
    return null;
  }

  // Hides full-resolution chunks outside the AO range for the duration of the
  // AO normal pass; AO is only applied inside that box anyway.
  cullForAo(active, box) {
    for (const chunk of this.chunks.values()) {
      if (!chunk.visible || chunk.size !== LEAF_SIZE) {
        continue;
      }
      chunk.mesh.visible =
        !active ||
        (chunk.x0 < box.max.x && chunk.x0 + chunk.size > box.min.x && chunk.z0 < box.max.z && chunk.z0 + chunk.size > box.min.z);
    }
  }

  // Chimney tops of the villages currently loaded.
  chimneys() {
    const tops = [];
    for (const structure of this.landmarks.values()) {
      tops.push(...structure.chimneys);
    }
    return tops;
  }

  waterInView(frustum) {
    for (const chunk of this.chunks.values()) {
      if (chunk.visible && chunk.water && frustum.intersectsObject(chunk.water)) {
        return true;
      }
    }
    return false;
  }

  stats() {
    let visible = 0;
    let pending = 0;
    for (const chunk of this.chunks.values()) {
      visible += chunk.visible ? 1 : 0;
      pending += chunk.state !== "ready" ? 1 : 0;
    }
    return { visible, pending, landmarks: this.landmarks.size };
  }
}
