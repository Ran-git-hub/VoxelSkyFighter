import * as THREE from "three";
import { blockBoxGeometry, voxelMaterial } from "../world/BlockTextures.js";

function addVoxel(group, [w, h, d], [x, y, z], color) {
  const cube = new THREE.Mesh(blockBoxGeometry(new THREE.Vector3(w, h, d)), voxelMaterial(color));
  cube.position.set(x, y, z);
  cube.castShadow = true;
  group.add(cube);
}

// Cross-sections of the envelope from nose to tail as [half width, z]; stacked boxes give a blocky cigar.
const ENVELOPE = [[3, 24], [5.5, 21], [7.5, 16], [8.5, 9], [8.5, 0], [8.5, -9], [7.5, -16], [5.5, -21], [3.5, -24.5]];

// Where the destructible parts sit on the hull, in hull space (nose along +Z).
export const BOSS_MOUNTS = [
  { kind: "bossGun", offset: [0, 9.4, 11] },
  { kind: "bossGun", offset: [0, 9.4, -9] },
  { kind: "bossGun", offset: [5, -10.4, 3] },
  { kind: "bossGun", offset: [-5, -10.4, 3] },
  { kind: "bossEngine", offset: [10.5, -2, -14] },
  { kind: "bossEngine", offset: [-10.5, -2, -14] },
];

const HALF_EXTENTS = new THREE.Vector3(9.5, 10, 26);
const CRUISE = [13, 19];

// The sky fortress: a slow airship whose guns and engines are separate enemies the game owns.
// It only moves the hull and pins the parts to it; damage, scoring and the fall's effects live in Game.
export class Boss {
  constructor(position, yaw) {
    this.mesh = new THREE.Group();
    this.mesh.rotation.order = "YXZ";
    this.mesh.position.copy(position);
    this.mesh.rotation.y = yaw;
    this.velocity = new THREE.Vector3();
    this.parts = [];
    this.phase = "guns";
    this.fallTime = 0;
    this.crashed = false;
    this.droneTimer = 4;
    this.build();
  }

  build() {
    ENVELOPE.forEach(([half, z], index) => {
      const next = ENVELOPE[index + 1];
      if (!next) {
        return;
      }
      const size = Math.min(half, next[0]) * 2;
      const length = Math.abs(z - next[1]) + 0.5;
      const middle = (z + next[1]) / 2;
      const stripe = index % 2 === 0 ? 0x6f7780 : 0x5d6670;
      addVoxel(this.mesh, [size, size, length], [0, 0, middle], stripe);
      addVoxel(this.mesh, [size + 0.4, 1.2, length + 0.2], [0, 0, middle], 0x8f2a2a);
    });
    addVoxel(this.mesh, [6, 3, 16], [0, -9.5, 3], 0x3e444a);
    addVoxel(this.mesh, [6.4, 1, 14], [0, -8, 3], 0x8f2a2a);
    addVoxel(this.mesh, [5, 1.4, 12], [0, -10.2, 3], 0x7ad7f0);
    addVoxel(this.mesh, [0.8, 9, 7], [0, 8, -21], 0x8f2a2a);
    addVoxel(this.mesh, [0.8, 9, 7], [0, -8, -21], 0x8f2a2a);
    addVoxel(this.mesh, [18, 0.8, 7], [0, 0, -21], 0x8f2a2a);
    addVoxel(this.mesh, [2.4, 2.4, 2.4], [0, 0, 25.5], 0xd8a530);
    for (const side of [-1, 1]) {
      addVoxel(this.mesh, [3, 1, 3], [side * 9, -2, -14], 0x3e444a);
    }
  }

  // Keeps each part glued to its mount; call after the hull has moved.
  placeParts() {
    this.mesh.updateMatrixWorld();
    for (const part of this.parts) {
      if (!part.alive) {
        continue;
      }
      part.mesh.position.set(...part.mount).applyMatrix4(this.mesh.matrixWorld);
      if (part.kind === "bossEngine") {
        part.mesh.rotation.copy(this.mesh.rotation);
      }
    }
  }

  update(delta, world, focus) {
    const position = this.mesh.position;
    if (this.phase === "falling") {
      this.fallTime += delta;
      this.mesh.rotation.x = THREE.MathUtils.damp(this.mesh.rotation.x, 0.45, 0.8, delta);
      this.mesh.rotation.z += delta * 0.12;
      this.velocity.y = Math.max(this.velocity.y - 9 * delta, -32);
      position.addScaledVector(this.velocity, delta);
      const ground = Math.max(world.heightAt(position.x, position.z), world.seaLevel);
      this.crashed = position.y - 6 < ground;
      this.placeParts();
      return;
    }

    // Lumber after the player at a fixed turn rate; it can never out-turn a plane, so it keeps coming round.
    const toFocus = Math.atan2(focus.x - position.x, focus.z - position.z);
    const error = Math.atan2(Math.sin(toFocus - this.mesh.rotation.y), Math.cos(toFocus - this.mesh.rotation.y));
    this.mesh.rotation.y += THREE.MathUtils.clamp(error, -1, 1) * 0.22 * delta;
    this.mesh.rotation.z = THREE.MathUtils.damp(this.mesh.rotation.z, -error * 0.12, 1.5, delta);
    const speed = CRUISE[this.phase === "guns" ? 0 : 1];
    const heading = this.mesh.rotation.y;
    let floor = 0;
    for (const ahead of [0, 40, 90]) {
      const x = position.x + Math.sin(heading) * ahead;
      const z = position.z + Math.cos(heading) * ahead;
      floor = Math.max(floor, world.heightAt(x, z), world.seaLevel);
    }
    const climb = THREE.MathUtils.clamp((floor + 85 - position.y) * 0.5, -6, 10);
    this.velocity.set(Math.sin(heading) * speed, climb, Math.cos(heading) * speed);
    position.addScaledVector(this.velocity, delta);
    this.placeParts();
  }

  // Ramming the envelope is as fatal as a mountain.
  contains(point) {
    const local = this.mesh.worldToLocal(point.clone());
    return Math.abs(local.x) < HALF_EXTENTS.x && Math.abs(local.y) < HALF_EXTENTS.y && Math.abs(local.z) < HALF_EXTENTS.z;
  }

  randomHullPoint() {
    return new THREE.Vector3(
      THREE.MathUtils.randFloatSpread(14),
      THREE.MathUtils.randFloatSpread(14),
      THREE.MathUtils.randFloatSpread(44)
    ).applyMatrix4(this.mesh.matrixWorld);
  }
}

const TRANSPORT_SPEED = 24;

// The friendly cargo plane of an escort mission: flies a straight route, hugging the terrain at a safe height.
export class Transport {
  constructor(position, destination) {
    this.mesh = new THREE.Group();
    this.mesh.position.copy(position);
    this.destination = destination.clone();
    this.velocity = new THREE.Vector3();
    this.radius = 7;
    this.maxHealth = 12;
    this.health = this.maxHealth;
    this.alive = true;
    this.start = position.clone();
    const parts = [
      [[3.4, 3.4, 16], [0, 0, 0], 0x6f8a5a],
      [[2.6, 2.6, 3], [0, -0.2, 9.4], 0x5a7048],
      [[2.2, 1, 1.8], [0, 1.1, 9.2], 0x7ad7f0],
      [[24, 0.6, 4], [0, 1.6, 1], 0x6f8a5a],
      [[2, 0.4, 4.2], [11, 1.6, 1], 0xf0f0f0],
      [[2, 0.4, 4.2], [-11, 1.6, 1], 0xf0f0f0],
      [[1.6, 1.6, 3.4], [5, 0.6, 2.4], 0x3a3a3a],
      [[1.6, 1.6, 3.4], [-5, 0.6, 2.4], 0x3a3a3a],
      [[0.6, 4.4, 3], [0, 3.6, -7], 0x6f8a5a],
      [[9, 0.5, 2.6], [0, 1.4, -7.4], 0x5a7048],
      [[3.6, 0.3, 6], [0, 1.75, 1], 0x55ff55],
    ];
    for (const [size, offset, color] of parts) {
      addVoxel(this.mesh, size, offset, color);
    }
    this.propellers = [5, -5].map((x) => {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 0.3), voxelMaterial(0x2a2a2a));
      blade.position.set(x, 0.6, 4.3);
      this.mesh.add(blade);
      return blade;
    });
  }

  get progress() {
    const total = Math.hypot(this.destination.x - this.start.x, this.destination.z - this.start.z);
    const left = Math.hypot(this.destination.x - this.mesh.position.x, this.destination.z - this.mesh.position.z);
    return THREE.MathUtils.clamp(1 - left / total, 0, 1);
  }

  get arrived() {
    return Math.hypot(this.destination.x - this.mesh.position.x, this.destination.z - this.mesh.position.z) < 60;
  }

  update(delta, world) {
    const position = this.mesh.position;
    const heading = Math.atan2(this.destination.x - position.x, this.destination.z - position.z);
    const error = Math.atan2(Math.sin(heading - this.mesh.rotation.y), Math.cos(heading - this.mesh.rotation.y));
    this.mesh.rotation.y += THREE.MathUtils.clamp(error, -1, 1) * 0.5 * delta;
    let floor = 0;
    for (const ahead of [0, 60, 130]) {
      const x = position.x + Math.sin(this.mesh.rotation.y) * ahead;
      const z = position.z + Math.cos(this.mesh.rotation.y) * ahead;
      floor = Math.max(floor, world.heightAt(x, z), world.seaLevel);
    }
    const climb = THREE.MathUtils.clamp((floor + 50 - position.y) * 0.8, -8, 14);
    this.velocity.set(Math.sin(this.mesh.rotation.y) * TRANSPORT_SPEED, climb, Math.cos(this.mesh.rotation.y) * TRANSPORT_SPEED);
    position.addScaledVector(this.velocity, delta);
    this.mesh.rotation.z = THREE.MathUtils.damp(this.mesh.rotation.z, -error * 0.4, 2, delta);
    for (const blade of this.propellers) {
      blade.rotation.z += delta * 30;
    }
  }
}
