import * as THREE from "three";
import { ENEMY_CONFIG, ENEMY_KINDS } from "../game/constants.js";
import { blockBoxGeometry, voxelMaterial } from "../world/BlockTextures.js";

function addVoxel(group, size, position, color) {
  const cube = new THREE.Mesh(blockBoxGeometry(new THREE.Vector3(...size)), voxelMaterial(color));
  cube.position.set(...position);
  cube.castShadow = true;
  group.add(cube);
}

// Each part is [size, position, colour]; a trailing true mirrors it across the centreline.
// Flying models point their nose along +Z, the turret aims along -Z.
const MODELS = {
  rammer: {
    parts: [
      [[1.4, 1.3, 6], [0, 0, 0], 0xd94f4f],
      [[1, 1, 2], [0, 0, 3.8], 0x8f2525],
      [[0.4, 0.4, 1.6], [0, 0, 5.4], 0xf0f0f0],
      [[0.9, 0.6, 1.6], [0, 0.85, 0.8], 0x2a2a2a],
      [[0.3, 1.6, 1.8], [0, 1.2, -2.2], 0x8f2525],
      [[0.9, 0.9, 0.6], [0, 0, -3.2], 0x3a3a3a],
      [[2.4, 0.3, 2.6], [1.8, 0, -0.8], 0xd94f4f, true],
      [[1.6, 0.3, 1.8], [3.6, 0, -1.6], 0x8f2525, true],
      [[0.3, 0.3, 2.2], [4.5, 0, -1.2], 0xf0f0f0, true],
      [[0.5, 0.32, 2.6], [2.2, 0, -0.8], 0xf0f0f0, true],
      [[1.4, 0.25, 1.2], [1.2, 0.1, -2.6], 0x8f2525, true],
    ],
    glows: [[[0.6, 0.6, 0.3], [0, 0, -3.6], 0xff7a2a]],
    lights: [4.5, 0, -2.2],
    exhaust: -3.8,
  },
  gunner: {
    parts: [
      [[1.8, 1.6, 5.6], [0, 0, 0.4], 0xe08a2e],
      [[1.4, 1.2, 1.6], [0, -0.1, 3.8], 0x8c5a1e],
      [[1.2, 0.8, 2], [0, 1, 1.2], 0x7ad7f0],
      [[0.4, 0.4, 2.4], [0, -0.9, 3.6], 0x2c2c2c],
      [[1.2, 1.2, 1], [0, 0, -2.8], 0x3a3a3a],
      [[3.8, 0.25, 1.2], [0, 1.7, -5.3], 0x8c5a1e],
      [[3.4, 0.4, 2.6], [2.4, 0, 0.2], 0x8c5a1e, true],
      [[2, 0.35, 2], [5, 0, -0.1], 0xe08a2e, true],
      [[0.5, 0.42, 2.6], [3.4, 0, 0.2], 0xf0f0f0, true],
      [[0.6, 0.6, 3], [2.6, -0.5, 1], 0x3a3a3a, true],
      [[0.25, 0.25, 1.4], [2.6, -0.5, 3], 0x1a1a1a, true],
      [[0.6, 0.6, 5], [1.6, 0.1, -3.4], 0x8c5a1e, true],
      [[0.3, 1.6, 1.4], [1.6, 1, -5.2], 0x5c3a12, true],
    ],
    glows: [[[0.8, 0.8, 0.3], [0, 0, -3.4], 0xff7a2a]],
    lights: [6, 0, -0.1],
    exhaust: -3.6,
  },
  ace: {
    parts: [
      [[1.6, 1.5, 8], [0, 0, 0], 0x5b2a86],
      [[1.1, 1, 2.4], [0, 0, 5], 0x7d3fb5],
      [[0.5, 0.5, 1.4], [0, 0, 6.8], 0xf0f0f0],
      [[1.1, 0.8, 2.6], [0, 1, 2], 0xffd257],
      [[0.8, 0.5, 3.6], [0, 1, -1.4], 0x2a1540],
      [[1.6, 0.25, 1.2], [1.5, 0.1, 3.4], 0x7d3fb5, true],
      [[3, 0.4, 3.4], [2.2, 0, -1], 0x2a1540, true],
      [[2.4, 0.35, 2.6], [4.8, 0, -0.2], 0x5b2a86, true],
      [[1.4, 0.3, 1.8], [6.6, 0, 0.6], 0x7d3fb5, true],
      [[0.3, 0.3, 2.6], [7.4, 0, 0.8], 0xf0f0f0, true],
      [[0.35, 2, 2], [1, 1.4, -3.2], 0x7d3fb5, true],
      [[0.35, 0.5, 1.4], [1, 2.6, -3.5], 0xffd257, true],
      [[0.7, 0.9, 2.4], [1.1, -0.3, 1], 0x2a1540, true],
      [[0.8, 0.9, 1], [0.5, 0, -4.4], 0x3a3a3a, true],
    ],
    glows: [
      [[0.6, 0.6, 0.3], [-0.5, 0, -5], 0xb06aff],
      [[0.6, 0.6, 0.3], [0.5, 0, -5], 0xb06aff],
    ],
    lights: [7.4, 0, -0.6],
    exhaust: -5.2,
  },
  turret: {
    parts: [
      [[7, 1.4, 7], [0, 0.7, 0], 0x7a7f86],
      [[5.4, 1.2, 5.4], [0, 2, 0], 0x555555],
      [[4, 1.8, 4], [0, 3.5, 0], 0x6a7a4a],
      [[1.6, 0.5, 1.6], [0, 4.65, 0.6], 0x4a5634],
      [[0.25, 1.2, 0.25], [1.2, 4.9, 1.4], 0x3a3a3a],
      [[1.6, 1.2, 0.3], [1.2, 5.6, 1.2], 0x9aa3ad],
      [[0.6, 0.6, 5], [1, 4, -3.6], 0x1a1a1a, true],
      [[0.9, 0.9, 0.8], [1, 4, -6.2], 0x7a7f86, true],
      [[0.9, 0.9, 1.6], [1, 4, -1.6], 0x4a5634, true],
      [[1, 1.4, 2], [2.5, 3.3, 0.4], 0x4a5634, true],
      [[1, 1, 1], [3, 1.9, 3], 0xe3c530, true],
      [[1, 1, 1], [3, 1.9, -3], 0xe3c530, true],
    ],
    glows: [[[0.5, 0.5, 0.5], [-1.2, 5.1, 1.2], 0xff2a1a]],
  },
  balloon: {
    parts: [
      [[4, 1.2, 4], [0, 3.6, 0], 0xe84a5f],
      [[6, 2.4, 6], [0, 1.8, 0], 0xf0f0f0],
      [[7, 3, 7], [0, -0.9, 0], 0xe84a5f],
      [[6, 1.6, 6], [0, -3.2, 0], 0xffd257],
      [[4, 1.4, 4], [0, -4.7, 0], 0xe84a5f],
      [[2, 1, 2], [0, -5.9, 0], 0xf0f0f0],
      [[0.2, 3, 0.2], [0.8, -7.7, 0.8], 0x8c5a1e, true],
      [[0.2, 3, 0.2], [0.8, -7.7, -0.8], 0x8c5a1e, true],
      [[2.2, 1.6, 2.2], [0, -9.8, 0], 0x8c5a1e],
      [[2.4, 0.3, 2.4], [0, -9, 0], 0x5c3a12],
    ],
    glows: [[[0.6, 0.6, 0.6], [0, -6.8, 0], 0xff8a2a]],
  },
};

function addGlow(group, size, position, color) {
  const cube = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(5), fog: false }));
  cube.position.set(...position);
  group.add(cube);
}

const scratch = new THREE.Vector3();

export class EnemyPlane {
  constructor(kind, spawnPosition) {
    this.kind = kind;
    this.config = ENEMY_KINDS[kind];
    this.mesh = new THREE.Group();
    this.mesh.position.copy(spawnPosition);
    this.mesh.scale.setScalar(this.config.scale);
    this.velocity = new THREE.Vector3();
    this.health = this.config.health;
    this.alive = true;
    this.nearMissed = false;
    this.previousDistance = null;
    this.radius = ENEMY_CONFIG.collisionRadius * this.config.scale * (kind === "balloon" || kind === "turret" ? 1.5 : 1);
    this.fireTimer = this.config.fireInterval * (0.3 + Math.random() * 0.5);
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.breakTimer = 0;
    this.weave = Math.random() * Math.PI * 2;
    this.isStatic = this.config.speed === 0;
    this.countsForWave = kind !== "balloon";
    const model = MODELS[kind];
    for (const [size, [x, y, z], color, mirrored] of model.parts) {
      addVoxel(this.mesh, size, [x, y, z], color);
      if (mirrored) {
        addVoxel(this.mesh, size, [-x, y, z], color);
      }
    }
    for (const [size, position, color] of model.glows) {
      addGlow(this.mesh, size, position, color);
    }
    // Hostile aircraft carry red lamps on both wingtips, so they read as threats at dusk.
    if (model.lights) {
      const [x, y, z] = model.lights;
      addGlow(this.mesh, [0.35, 0.35, 0.35], [x, y, z], 0xff2a1a);
      addGlow(this.mesh, [0.35, 0.35, 0.35], [-x, y, z], 0xff2a1a);
    }
    this.exhaust = model.exhaust ?? null;
  }

  // Returns a shot direction when the enemy fires this frame, otherwise null.
  update(delta, player, world) {
    const toPlayer = scratch.copy(player.mesh.position).sub(this.mesh.position);
    const distance = toPlayer.length();
    this.weave += delta;

    if (this.kind === "balloon") {
      this.mesh.rotation.y += delta * 0.3;
      this.mesh.position.y += Math.sin(this.weave) * delta * 0.6;
      return null;
    }

    if (this.kind === "turret") {
      this.mesh.rotation.y = Math.atan2(-toPlayer.x, -toPlayer.z);
    } else {
      this.fly(delta, toPlayer, distance, player, world);
    }
    return this.shoot(delta, distance, player);
  }

  fly(delta, toPlayer, distance, player, world) {
    const desired = toPlayer.clone();
    if (this.config.fireInterval > 0) {
      // Gunships lead the target, then peel away instead of ramming once they get close.
      desired.addScaledVector(player.velocity, distance / ENEMY_CONFIG.bulletSpeed);
      if (distance < 95) {
        this.breakTimer = 1.4;
      }
      if (this.breakTimer > 0) {
        this.breakTimer -= delta;
        desired.negate();
        desired.y = Math.abs(desired.y) + 20;
      }
      desired.x += Math.sin(this.weave * 1.3) * 18;
      desired.y += Math.cos(this.weave * 0.9) * 10;
    }
    desired.normalize();

    const current = this.velocity.lengthSq() > 0.001 ? this.velocity.clone().normalize() : desired.clone();
    const ahead = this.mesh.position.clone().addScaledVector(current, 60);
    const floor = Math.max(world.heightAt(ahead.x, ahead.z), world.seaLevel) + 18;
    if (this.mesh.position.y < floor) {
      desired.y = Math.max(desired.y, 0.7);
      desired.normalize();
    }

    // Turn at a fixed angular rate. A plain lerp stalls when the target is dead astern,
    // because the two directions cancel instead of sweeping round.
    const angle = current.angleTo(desired);
    if (angle > 3) {
      desired.x += 0.3;
      desired.y += 0.2;
      desired.normalize();
    }
    if (angle > 1e-3) {
      current.lerp(desired, Math.min(1, (this.config.turn * delta) / angle)).normalize();
    }
    this.velocity.copy(current).multiplyScalar(this.config.speed);
    this.mesh.position.addScaledVector(this.velocity, delta);
    this.mesh.lookAt(ahead.copy(this.mesh.position).add(this.velocity));
  }

  shoot(delta, distance, player) {
    if (this.config.fireInterval === 0) {
      return null;
    }

    if (this.burstLeft > 0) {
      this.burstTimer -= delta;
      if (this.burstTimer > 0) {
        return null;
      }
      this.burstLeft -= 1;
      this.burstTimer = 0.14;
      return this.aimAt(player, distance);
    }

    this.fireTimer -= delta;
    if (this.fireTimer > 0 || distance > this.config.range || this.breakTimer > 0) {
      return null;
    }
    const aim = this.aimAt(player, distance);
    if (!this.isStatic) {
      const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
      if (facing.dot(aim) < 0.9) {
        return null;
      }
    }
    this.fireTimer = this.config.fireInterval;
    this.burstLeft = this.config.burst - 1;
    this.burstTimer = 0.14;
    return aim;
  }

  aimAt(player, distance) {
    const lead = distance / ENEMY_CONFIG.bulletSpeed;
    return player.mesh.position
      .clone()
      .addScaledVector(player.velocity, lead * 0.85)
      .sub(this.getMuzzlePosition())
      .normalize();
  }

  getExhaustPosition() {
    return this.mesh.localToWorld(new THREE.Vector3(0, 0, this.exhaust));
  }

  getMuzzlePosition() {
    const local = this.kind === "turret" ? new THREE.Vector3(0, 4.4, -5) : new THREE.Vector3(0, 0, 4.5);
    return this.mesh.localToWorld(local);
  }
}
