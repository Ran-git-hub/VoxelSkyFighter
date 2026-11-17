import * as THREE from "three";
import { MISSILE_CONFIG, PROJECTILE_CONFIG } from "../game/constants.js";
import { blockBoxGeometry, voxelMaterial } from "../world/BlockTextures.js";

const FORWARD = new THREE.Vector3(0, 0, 1);
const TRACER_GEOMETRY = new THREE.BoxGeometry(0.35, 0.35, 3.2);
const HOSTILE_GEOMETRY = new THREE.BoxGeometry(0.7, 0.7, 2.6);

export class Projectile {
  constructor(origin, direction, { hostile = false, speed = PROJECTILE_CONFIG.speed, lifetime = PROJECTILE_CONFIG.lifetime } = {}) {
    this.hostile = hostile;
    this.lifetime = lifetime;
    // The geometry is shared by every shot; Game.disposeObject disposing it is
    // harmless because three re-uploads a disposed geometry on next use.
    this.mesh = new THREE.Mesh(
      hostile ? HOSTILE_GEOMETRY : TRACER_GEOMETRY,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(hostile ? 0xff4a3a : 0xffd56a).multiplyScalar(6), fog: false })
    );
    this.mesh.position.copy(origin);
    this.velocity = direction.clone().normalize().multiplyScalar(speed);
    this.mesh.quaternion.setFromUnitVectors(FORWARD, direction.clone().normalize());
    this.age = 0;
    this.alive = true;
  }

  update(delta) {
    this.age += delta;
    this.mesh.position.addScaledVector(this.velocity, delta);
    if (this.age > this.lifetime) {
      this.alive = false;
    }
  }
}

export class Missile {
  constructor(origin, direction, target) {
    this.mesh = new THREE.Group();
    for (const [size, position, color] of [
      [[0.7, 0.7, 3.4], [0, 0, 0], 0xe8e8e8],
      [[0.7, 0.7, 0.8], [0, 0, 2], 0xd94f4f],
      [[2, 0.25, 0.9], [0, 0, -1.3], 0x555555],
      [[0.25, 2, 0.9], [0, 0, -1.3], 0x555555],
      [[0.76, 0.76, 0.4], [0, 0, 0.9], 0xe3c530],
      [[1.3, 0.2, 0.5], [0, 0, 1.3], 0x555555],
      [[0.2, 1.3, 0.5], [0, 0, 1.3], 0x555555],
      [[0.45, 0.45, 0.6], [0, 0, 2.6], 0x8f2525],
    ]) {
      const cube = new THREE.Mesh(blockBoxGeometry(new THREE.Vector3(...size)), voxelMaterial(color));
      cube.position.set(...position);
      this.mesh.add(cube);
    }
    const flame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a2a).multiplyScalar(6), fog: false }));
    flame.position.set(0, 0, -1.9);
    this.mesh.add(flame);
    this.mesh.position.copy(origin);
    this.direction = direction.clone().normalize();
    this.velocity = this.direction.clone().multiplyScalar(MISSILE_CONFIG.speed * 0.6);
    this.target = target;
    this.age = 0;
    this.alive = true;
  }

  update(delta) {
    this.age += delta;
    if (this.target?.alive) {
      const desired = this.target.mesh.position.clone().sub(this.mesh.position).normalize();
      this.direction.lerp(desired, Math.min(1, MISSILE_CONFIG.turn * delta)).normalize();
    }
    const speed = Math.min(MISSILE_CONFIG.speed, this.velocity.length() + 90 * delta);
    this.velocity.copy(this.direction).multiplyScalar(speed);
    this.mesh.position.addScaledVector(this.velocity, delta);
    this.mesh.quaternion.setFromUnitVectors(FORWARD, this.direction);
    if (this.age > MISSILE_CONFIG.lifetime) {
      this.alive = false;
    }
  }

  getExhaustPosition() {
    return this.mesh.localToWorld(new THREE.Vector3(0, 0, -2));
  }
}
