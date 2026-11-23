import * as THREE from "three";
import { blockBoxGeometry, voxelMaterial } from "../world/BlockTextures.js";

const LIFETIME = 60;
const RADIUS = 9;

// A floating repair kit: a white crate with a red cross, hung under a small balloon so it reads from afar.
export class Pickup {
  constructor(position) {
    this.mesh = new THREE.Group();
    this.mesh.position.copy(position);
    this.base = position.clone();
    this.alive = true;
    this.age = 0;
    this.radius = RADIUS;
    const add = ([w, h, d], [x, y, z], color) => {
      const cube = new THREE.Mesh(blockBoxGeometry(new THREE.Vector3(w, h, d)), voxelMaterial(color));
      cube.position.set(x, y, z);
      cube.castShadow = true;
      this.mesh.add(cube);
    };
    add([3, 3, 3], [0, 0, 0], 0xf2f2f2);
    for (const [w, h, d] of [[3.1, 0.7, 2], [3.1, 2, 0.7], [2, 0.7, 3.1], [0.7, 2, 3.1]]) {
      add([w, h, d], [0, 0, 0], 0xd8312c);
    }
    add([0.2, 2.2, 0.2], [0, 2.6, 0], 0x5c3a12);
    add([3, 2.6, 3], [0, 5, 0], 0x55ff55);
    add([2, 0.8, 2], [0, 6.6, 0], 0x55ff55);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a5a).multiplyScalar(4), fog: false }));
    glow.position.set(0, -2, 0);
    this.mesh.add(glow);
  }

  update(delta) {
    this.age += delta;
    this.mesh.rotation.y += delta * 1.2;
    this.mesh.position.y = this.base.y + Math.sin(this.age * 1.8) * 1.2;
    if (this.age > LIFETIME) {
      this.alive = false;
    }
  }
}
