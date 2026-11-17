import * as THREE from "three";
import { blockBoxGeometry, voxelMaterial } from "./BlockTextures.js";
import { setupWorldMaterial } from "./WorldShading.js";

const FLOCKS = 4;
const BIRDS_PER_FLOCK = 9;
const BIRD_SPEED = 15;
const BOATS = 4;
const BOAT_SPEED = 5;
// A service road on the apron, clear of the runway and the hangar doors.
const APRON_LOOP = [
  [47, -150],
  [47, 118],
  [57, 118],
  [57, -150],
];

const BOAT_MODELS = [
  [
    [[4, 1.6, 11], [0, 0.3, 0], 0x7a4a1f],
    [[3, 1.2, 2], [0, 0.5, -6.2], 0x7a4a1f],
    [[3.4, 0.4, 9], [0, 1.2, 0], 0xd9b98a],
    [[0.5, 11, 0.5], [0, 6.6, -1], 0x5a3716],
    [[0.3, 8, 5], [0, 7.4, 1.8], 0xf4f4f4],
    [[0.3, 5, 3], [0, 6, -3], 0xf4f4f4],
    [[0.4, 0.8, 1.2], [0, 12.4, -0.6], 0xd63f2f],
  ],
  [
    [[5, 2, 13], [0, 0.4, 0], 0xc93a2f],
    [[4, 1.4, 2], [0, 0.7, -7.2], 0xc93a2f],
    [[5.2, 0.5, 13.2], [0, 1.5, 0], 0xf4f4f4],
    [[3.4, 2.6, 4], [0, 3, 2.6], 0xf4f4f4],
    [[3.6, 0.9, 4.2], [0, 3.4, 2.6], 0x8fd3ff],
    [[3.8, 0.4, 4.6], [0, 4.5, 2.6], 0x2f63d6],
    [[0.4, 4, 0.4], [0, 3.6, -2.4], 0x50555b],
    [[2, 1, 2], [0, 2.2, -4.4], 0xe3c530],
  ],
];

const VEHICLE_MODELS = [
  {
    parts: [
      [[3, 2.4, 2.6], [0, 1.7, -3.2], 0xd63f2f],
      [[2.8, 1, 1], [0, 2.3, -4.2], 0x8fd3ff],
      [[3, 2.6, 6], [0, 2, 1.4], 0xf4f4f4],
      [[3.1, 0.5, 6.1], [0, 2, 1.4], 0xd63f2f],
      [[3.2, 0.8, 9.4], [0, 0.8, -0.2], 0x2c2c2c],
    ],
  },
  {
    parts: [
      [[2.2, 1.4, 3], [0, 1.2, -4], 0xe3c530],
      [[1.8, 1, 1.2], [0, 2.2, -3.6], 0x2c2c2c],
      [[0.3, 0.3, 1.4], [0, 0.8, -1.8], 0x50555b],
      [[2.4, 0.5, 4], [0, 0.9, 0.8], 0x50555b],
      [[2, 1.4, 1.6], [0, 1.8, 0], 0x2f63d6],
      [[2, 1.2, 1.6], [0, 1.7, 1.8], 0x7a4a1f],
      [[2.4, 0.5, 4], [0, 0.9, 5.6], 0x50555b],
      [[2, 1.6, 3.4], [0, 1.9, 5.6], 0xc93a2f],
    ],
  },
  {
    parts: [
      [[2.4, 1.2, 5], [0, 1, 0], 0xe3c530],
      [[2.2, 1, 2.4], [0, 2, 0.4], 0x2c2c2c],
      [[2.5, 0.5, 1.6], [0, 1.3, 2], 0x1a1a1a],
      [[2.5, 0.5, 1.6], [0, 1.3, -2], 0x1a1a1a],
    ],
    beacon: [0, 2.8, 0.4],
  },
];

function buildModel(parts) {
  const group = new THREE.Group();
  for (const [size, position, color] of parts) {
    const cube = new THREE.Mesh(blockBoxGeometry(new THREE.Vector3(...size)), voxelMaterial(color));
    cube.position.set(...position);
    cube.castShadow = true;
    group.add(cube);
  }
  return group;
}

const matrix = new THREE.Matrix4();
const part = new THREE.Matrix4();
const flap = new THREE.Matrix4();
const birdColor = new THREE.Color();

// Ambient traffic with no gameplay role: nothing here collides or scores.
export class Life {
  constructor(scene, world) {
    this.world = world;
    this.time = 0;

    const birdMaterial = setupWorldMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }), { key: "life" });
    this.birds = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), birdMaterial, FLOCKS * BIRDS_PER_FLOCK * 3);
    this.birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.birds.frustumCulled = false;
    for (let i = 0; i < this.birds.count; i += 1) {
      this.birds.setColorAt(i, birdColor.set(i % 3 === 0 ? 0xf2f2f2 : 0x8d949b));
    }
    scene.add(this.birds);
    this.flocks = Array.from({ length: FLOCKS }, (_, index) => ({
      position: new THREE.Vector3(0, -1000, 0),
      heading: 0,
      turn: 0,
      height: 35 + index * 14,
      phase: index * 1.7,
      placed: false,
    }));

    this.boats = Array.from({ length: BOATS }, (_, index) => {
      const mesh = buildModel(BOAT_MODELS[index % BOAT_MODELS.length]);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, heading: 0, placed: false, phase: index * 2.1, wake: 0 };
    });

    const lengths = APRON_LOOP.map(([x, z], index) => {
      const [nx, nz] = APRON_LOOP[(index + 1) % APRON_LOOP.length];
      return Math.hypot(nx - x, nz - z);
    });
    this.loopLengths = lengths;
    this.loopTotal = lengths.reduce((sum, length) => sum + length, 0);
    this.vehicles = VEHICLE_MODELS.map((model, index) => {
      const mesh = buildModel(model.parts);
      let beacon = null;
      if (model.beacon) {
        beacon = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa018).multiplyScalar(6), fog: false }));
        beacon.position.set(...model.beacon);
        mesh.add(beacon);
      }
      scene.add(mesh);
      return { mesh, beacon, distance: (this.loopTotal * index) / VEHICLE_MODELS.length, speed: 7 + index * 2 };
    });
  }

  update(delta, focus, effects) {
    this.time += delta;
    this.updateBirds(delta, focus);
    this.updateBoats(delta, focus, effects);
    this.updateVehicles(delta);
  }

  surfaceAt(x, z) {
    return Math.max(this.world.heightAt(x, z), this.world.seaLevel);
  }

  updateBirds(delta, focus) {
    this.flocks.forEach((flock, flockIndex) => {
      const away = Math.hypot(flock.position.x - focus.x, flock.position.z - focus.z);
      if (!flock.placed || away > 650) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 180 + Math.random() * 260;
        flock.position.set(focus.x + Math.cos(angle) * distance, 0, focus.z + Math.sin(angle) * distance);
        flock.position.y = this.surfaceAt(flock.position.x, flock.position.z) + flock.height;
        flock.heading = Math.random() * Math.PI * 2;
        flock.placed = true;
      }
      // Lazy wandering turns, so a flock sweeps wide arcs rather than flying dead straight.
      flock.turn = Math.sin(this.time * 0.13 + flock.phase) * 0.25;
      flock.heading += flock.turn * delta;
      const dx = Math.sin(flock.heading);
      const dz = Math.cos(flock.heading);
      flock.position.x += dx * BIRD_SPEED * delta;
      flock.position.z += dz * BIRD_SPEED * delta;
      const floor = this.surfaceAt(flock.position.x + dx * 40, flock.position.z + dz * 40) + flock.height;
      flock.position.y = THREE.MathUtils.damp(flock.position.y, floor, 0.8, delta);

      for (let i = 0; i < BIRDS_PER_FLOCK; i += 1) {
        const rank = Math.ceil(i / 2);
        const side = (i % 2 === 0 ? -1 : 1) * rank * 2.4;
        const back = rank * 2.6;
        const bob = Math.sin(this.time * 1.7 + i * 1.3 + flock.phase) * 0.5;
        matrix.makeRotationY(flock.heading).setPosition(
          flock.position.x + dz * side - dx * back,
          flock.position.y + bob,
          flock.position.z - dx * side - dz * back
        );
        const base = (flockIndex * BIRDS_PER_FLOCK + i) * 3;
        this.birds.setMatrixAt(base, part.makeScale(0.45, 0.4, 1.5).premultiply(matrix));
        const angle = Math.sin(this.time * 9 + i * 0.9 + flock.phase) * 0.75;
        for (const wing of [-1, 1]) {
          part.makeScale(1.5, 0.12, 0.7).setPosition(wing * 0.75, 0, 0);
          flap.makeRotationZ(wing * angle).setPosition(wing * 0.2, 0.1, 0.1);
          this.birds.setMatrixAt(base + (wing < 0 ? 1 : 2), part.premultiply(flap).premultiply(matrix));
        }
      }
    });
    this.birds.instanceMatrix.needsUpdate = true;
  }

  // Open water with room to sail: deep here and deep a short way off in every direction.
  isOpenWater(x, z) {
    const limit = this.world.seaLevel - 5;
    return [[0, 0], [36, 0], [-36, 0], [0, 36], [0, -36]].every(([dx, dz]) => this.world.heightAt(x + dx, z + dz) < limit);
  }

  updateBoats(delta, focus, effects) {
    const sea = this.world.seaLevel;
    for (const boat of this.boats) {
      const position = boat.mesh.position;
      const away = Math.hypot(position.x - focus.x, position.z - focus.z);
      if (!boat.placed || away > 950) {
        // One try per frame: most of the map is land, and a missing boat is not worth a stall.
        const angle = Math.random() * Math.PI * 2;
        const distance = 200 + Math.random() * 550;
        const x = focus.x + Math.cos(angle) * distance;
        const z = focus.z + Math.sin(angle) * distance;
        boat.placed = this.isOpenWater(x, z);
        boat.mesh.visible = boat.placed;
        if (!boat.placed) {
          continue;
        }
        position.set(x, sea, z);
        boat.heading = Math.random() * Math.PI * 2;
      }
      const dx = -Math.sin(boat.heading);
      const dz = -Math.cos(boat.heading);
      if (this.world.heightAt(position.x + dx * 45, position.z + dz * 45) > sea - 4) {
        boat.heading += 0.9 * delta;
      }
      position.x += dx * BOAT_SPEED * delta;
      position.z += dz * BOAT_SPEED * delta;
      position.y = sea - 0.4 + Math.sin(this.time * 1.3 + boat.phase) * 0.25;
      boat.mesh.rotation.set(Math.sin(this.time * 1.1 + boat.phase) * 0.04, boat.heading, Math.sin(this.time * 0.9 + boat.phase) * 0.06);
      boat.wake -= delta;
      if (boat.wake <= 0 && away < 320) {
        boat.wake = 0.25;
        effects.wake(position.x - dx * 6, sea + 0.2, position.z - dz * 6);
      }
    }
  }

  updateVehicles(delta) {
    for (const vehicle of this.vehicles) {
      vehicle.distance = (vehicle.distance + vehicle.speed * delta) % this.loopTotal;
      let remaining = vehicle.distance;
      let segment = 0;
      while (remaining > this.loopLengths[segment]) {
        remaining -= this.loopLengths[segment];
        segment += 1;
      }
      const [x0, z0] = APRON_LOOP[segment];
      const [x1, z1] = APRON_LOOP[(segment + 1) % APRON_LOOP.length];
      const t = remaining / this.loopLengths[segment];
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      vehicle.mesh.position.set(x, this.world.heightAt(x, z), z);
      vehicle.mesh.rotation.y = Math.atan2(-(x1 - x0), -(z1 - z0));
      if (vehicle.beacon) {
        vehicle.beacon.visible = this.time % 0.8 < 0.4;
      }
    }
  }
}
