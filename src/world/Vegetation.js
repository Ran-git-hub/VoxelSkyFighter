import * as THREE from "three";
import { L, TREE_SHAPES } from "./TerrainGen.js";
import { VoxelBuilder } from "./Structures.js";
import { getVegetationMaterial } from "./WorldMaterials.js";

const FAR_LAYER = 1;
const NEAR_TREE_DISTANCE = 230;
const TREE_CAPACITY = { near: 2500, far: 9000 };
const PLANT_CAPACITY = 12000;
const TINTS = [new THREE.Color(0.85, 0.95, 0.8), new THREE.Color(1.08, 1.02, 0.92)];

// Distant trees drop their small detail boxes; at that range only the
// silhouette survives the fog anyway.
const FAR_BOX_COUNT = { oak: 2, spruce: 3, cherry: 2, palm: 3, cactus: 1 };

function treeGeometry(shape, far) {
  const b = new VoxelBuilder();
  const boxes = far ? shape.boxes.slice(0, FAR_BOX_COUNT[shape.name]) : shape.boxes;
  for (const box of boxes) {
    b.box(box.min[0], box.min[1], box.min[2], box.max[0], box.max[1], box.max[2], box.layer, { solid: false, sway: box.sway, bottom: box.min[1] > 0 });
  }
  return b.geometry();
}

function plantGeometry(kind) {
  const b = new VoxelBuilder();
  if (kind === 0) {
    b.box(-0.12, 0, -0.45, 0.12, 1.1, 0.45, L.tallGrass, { solid: false, sway: 1, groundAo: false, bottom: false });
    b.box(-0.45, 0, -0.12, 0.45, 0.8, 0.12, L.tallGrass, { solid: false, sway: 1, groundAo: false, bottom: false });
  } else {
    b.box(-0.09, 0, -0.09, 0.09, 0.9, 0.09, L.tallGrass, { solid: false, sway: 1, groundAo: false, bottom: false });
    b.box(-0.25, 0.9, -0.25, 0.25, 1.3, 0.25, kind === 1 ? L.flowerRed : L.flowerYellow, { solid: false, sway: 1, groundAo: false, bottom: false });
  }
  return b.geometry();
}

function instanced(geometry, capacity, { shadow = false, far = false } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, getVegetationMaterial(), capacity);
  mesh.count = 0;
  mesh.visible = false;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color());
  if (far) {
    mesh.layers.set(FAR_LAYER);
  }
  return mesh;
}

// Instances from every loaded chunk are pooled into a handful of shared
// InstancedMeshes, so foliage costs a fixed number of draw calls.
export class Vegetation {
  constructor(scene) {
    this.trees = TREE_SHAPES.map((shape) => ({
      near: instanced(treeGeometry(shape, false), TREE_CAPACITY.near, { shadow: true }),
      far: instanced(treeGeometry(shape, true), TREE_CAPACITY.far, { far: true }),
    }));
    this.plants = [0, 1, 2].map((kind) => instanced(plantGeometry(kind), PLANT_CAPACITY));
    for (const set of this.trees) {
      scene.add(set.near, set.far);
    }
    scene.add(...this.plants);
    this.density = 1;
    this.plantRadius = 180;
    this.treeRadius = 460;
    this.matrix = new THREE.Matrix4();
    this.color = new THREE.Color();
  }

  setDensity(density, plantRadius, treeRadius) {
    this.density = density;
    this.plantRadius = plantRadius;
    this.treeRadius = treeRadius;
  }

  rebuild(chunks, focus) {
    for (const set of this.trees) {
      set.near.count = 0;
      set.far.count = 0;
    }
    for (const mesh of this.plants) {
      mesh.count = 0;
    }
    const nearSq = NEAR_TREE_DISTANCE * NEAR_TREE_DISTANCE;
    const plantSq = this.plantRadius * this.plantRadius;
    const treeSq = this.treeRadius * this.treeRadius;
    const keepEvery = this.density >= 1 ? 1 : Math.round(1 / this.density);

    for (const chunk of chunks) {
      const trees = chunk.trees;
      if (trees) {
        for (let i = 0; i < trees.length; i += 6) {
          if (keepEvery > 1 && (i / 6) % keepEvery !== 0) {
            continue;
          }
          const dx = trees[i + 1] - focus.x;
          const dz = trees[i + 3] - focus.z;
          const distanceSq = dx * dx + dz * dz;
          if (distanceSq > treeSq) {
            continue;
          }
          const set = this.trees[trees[i]];
          const target = distanceSq < nearSq ? set.near : set.far;
          if (target.count >= target.instanceMatrix.count) {
            continue;
          }
          const scale = trees[i + 4];
          this.matrix.makeScale(scale, scale, scale).setPosition(trees[i + 1], trees[i + 2], trees[i + 3]);
          target.setMatrixAt(target.count, this.matrix);
          target.setColorAt(target.count, this.color.copy(TINTS[0]).lerp(TINTS[1], trees[i + 5]));
          target.count += 1;
        }
      }
      const plants = chunk.plants;
      if (plants) {
        for (let i = 0; i < plants.length; i += 5) {
          const dx = plants[i + 1] - focus.x;
          const dz = plants[i + 3] - focus.z;
          if (dx * dx + dz * dz > plantSq) {
            continue;
          }
          const target = this.plants[plants[i]];
          if (target.count >= target.instanceMatrix.count) {
            continue;
          }
          const scale = 0.8 + plants[i + 4] * 0.6;
          this.matrix.makeScale(scale, scale, scale).setPosition(plants[i + 1], plants[i + 2], plants[i + 3]);
          target.setMatrixAt(target.count, this.matrix);
          target.setColorAt(target.count, this.color.copy(TINTS[0]).lerp(TINTS[1], plants[i + 4]));
          target.count += 1;
        }
      }
    }

    for (const mesh of [...this.trees.flatMap((set) => [set.near, set.far]), ...this.plants]) {
      mesh.visible = mesh.count > 0;
      // Upload only the live range; the full buffers are several megabytes.
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, mesh.count * 3);
      mesh.instanceColor.needsUpdate = true;
    }
  }
}
