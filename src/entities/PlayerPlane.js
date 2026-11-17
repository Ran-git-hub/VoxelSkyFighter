import * as THREE from "three";
import { GAME_STATES, PLAYER_CONFIG, STUNT_CONFIG, WORLD_CONFIG } from "../game/constants.js";
import { blockBoxGeometry, voxelMaterial } from "../world/BlockTextures.js";
import { buildBrickPlane, isBrickSkin } from "./BrickPlanes.js";

function addVoxel(group, size, position, color) {
  const cube = new THREE.Mesh(blockBoxGeometry(size), voxelMaterial(color));
  cube.position.copy(position);
  cube.castShadow = true;
  group.add(cube);
}

// Per-skin hard points: a wingtip (mirrored), the tail light and the engine exhausts, in model space.
const SKIN_LAYOUT = {
  standard: { tip: [7.35, -0.1, 2.2], tail: [0, 0.7, 5.9], exhausts: [[-0.55, 0.1, 6], [0.55, 0.1, 6]] },
  mario: { tip: [7.4, -0.3, -0.3], tail: [0, 4.05, 5.9], exhausts: [[0, 0.3, 7]] },
  f16: { tip: [7.45, 0, 2.6], tail: [0, 4.65, 5], exhausts: [[0, 0.1, 7.2]] },
  airshow: { tip: [7.9, -0.2, 2.6], tail: [0, 4.3, 4.7], exhausts: [[0, 0.1, 6.5]] },
  brickstorm: { tip: [12.5, 1.95, 2.1], tail: [0, 4.75, 7.9], exhausts: [[-5.4, -1.1, 4.8], [5.4, -1.1, 4.8], [0, 0.2, 11.1]] },
  brickbiplane: { tip: [7, 2.45, -2.45], tail: [0, 3.05, 4.2], exhausts: [[0, 0, 5]] },
  brickairliner: { tip: [10.85, 0.85, 2.8], tail: [0, 4.15, 8.75], exhausts: [[-4.2, -1.44, 0.7], [4.2, -1.44, 0.7]] },
  brickseaplane: { tip: [8.4, 2.15, -1.75], tail: [0, 3.35, 8], exhausts: [[0, 0.2, 9.3]] },
  brickjet: { tip: [7.7, -0.1, 3.2], tail: [0, 0.4, 6.8], exhausts: [[-0.42, -0.2, 6.9], [0.42, -0.2, 6.9]] },
};
const NAV_COLORS = [0xff2a1a, 0x1aff4a, 0xffffff];

function addGlow(group, size, position, color) {
  const cube = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(5), fog: false }));
  cube.position.set(...position);
  group.add(cube);
}

export class PlayerPlane {
  constructor() {
    this.mesh = new THREE.Group();
    // Heading, then pitch, then bank: with the default XYZ order pitch turns about the world X axis and dies at 90 degrees of heading.
    this.mesh.rotation.order = "YXZ";
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.forward = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.right = new THREE.Vector3(1, 0, 0);
    this.state = GAME_STATES.START;
    this.health = PLAYER_CONFIG.maxHealth;
    this.fireTimer = 0;
    this.altitude = 0;
    this.speed = 0;
    this.takeoffReady = false;
    this.justBecameReady = false;
    this.justLiftedOff = false;
    this.takeoffTimer = 0;
    this.airborneTimer = 0;
    this.landingPhase = "idle";
    this.landingTarget = null;
    this.landingTimer = 0;
    this.stunt = null;
    this.justCompletedStunt = null;
    this.justTouchedDown = false;
    this.skin = "standard";
    this.buildModel();
    this.reset();
  }

  buildModel() {
    this.mesh.traverse((child) => {
      child.geometry?.dispose();
      child.material?.dispose();
    });
    this.mesh.clear();
    this.radius = PLAYER_CONFIG.collisionRadius;
    this.spinners = [];
    this.layout = SKIN_LAYOUT[this.skin] ?? SKIN_LAYOUT.standard;
    // Red to port, green to starboard, white strobe aft, as on a real aircraft.
    const [tx, ty, tz] = this.layout.tip;
    this.navLights = [[-tx, ty, tz], [tx, ty, tz], this.layout.tail].map((position, index) => {
      addGlow(this.mesh, [0.4, 0.4, 0.4], position, NAV_COLORS[index]);
      return this.mesh.children[this.mesh.children.length - 1];
    });
    this.navTime = 0;

    if (isBrickSkin(this.skin)) {
      this.spinners = buildBrickPlane(this.mesh, this.skin);
      return;
    }

    if (this.skin === "mario") {
      this.buildMarioModel();
      return;
    }

    if (this.skin === "f16") {
      this.buildF16Model();
      return;
    }

    if (this.skin === "airshow") {
      this.buildAirShowModel();
      return;
    }

    if (this.skin === "brickstorm") {
      this.buildBrickStormModel();
      return;
    }

    this.buildStandardModel();
  }

  // Lays down centreline parts once and mirrored parts on both sides.
  assemble(parts, mirrored, glows = []) {
    for (const [size, position, color] of parts) {
      addVoxel(this.mesh, new THREE.Vector3(...size), new THREE.Vector3(...position), color);
    }
    for (const [size, [x, y, z], color] of mirrored) {
      addVoxel(this.mesh, new THREE.Vector3(...size), new THREE.Vector3(-x, y, z), color);
      addVoxel(this.mesh, new THREE.Vector3(...size), new THREE.Vector3(x, y, z), color);
    }
    for (const [size, position, color] of glows) {
      addGlow(this.mesh, size, position, color);
    }
  }

  addPropeller(position, span, color) {
    const hub = new THREE.Mesh(blockBoxGeometry(new THREE.Vector3(0.6, 0.6, 0.5)), voxelMaterial(color));
    hub.position.set(...position);
    for (const size of [
      [span, 0.4, 0.15],
      [0.4, span, 0.15],
    ]) {
      hub.add(new THREE.Mesh(blockBoxGeometry(new THREE.Vector3(...size)), voxelMaterial(color)));
    }
    this.mesh.add(hub);
    this.spinners.push(hub);
  }

  buildStandardModel() {
    const body = 0x4f9d4f;
    const dark = 0x2f5f33;
    const accent = 0x9be08f;
    const metal = 0x50555b;
    const glass = 0x8fd3ff;
    const white = 0xf2f2f2;
    const red = 0xd63f2f;
    this.assemble(
      [
        [[1.8, 1.6, 9], [0, 0.1, 0], body],
        [[1.4, 1.3, 3], [0, 0.05, -5.8], body],
        [[0.9, 0.9, 2.2], [0, 0, -8.2], accent],
        [[0.25, 0.25, 1.4], [0, 0, -9.9], metal],
        [[1.3, 0.9, 3], [0, 1.1, -3.2], glass],
        [[1.3, 0.7, 2], [0, 1, -0.8], dark],
        [[0.9, 0.6, 4], [0, 1, 2.2], dark],
        [[0.8, 0.7, 4], [0, -0.95, 0.5], metal],
      ],
      [
        [[0.9, 1.1, 3.2], [1.3, -0.2, -1.6], dark],
        [[0.9, 1.1, 0.4], [1.3, -0.2, -3.4], metal],
        [[1.2, 0.35, 2.4], [1.6, -0.1, -2.9], body],
        [[3, 0.4, 4.6], [2.3, -0.1, 0.6], body],
        [[2.2, 0.4, 3.4], [4.7, -0.1, 1.5], body],
        [[1.6, 0.35, 2.4], [6.4, -0.1, 2.3], accent],
        [[0.5, 0.44, 4.6], [3.3, -0.1, 0.6], white],
        [[0.4, 0.4, 3.2], [7.35, -0.1, 2], white],
        [[0.4, 0.4, 0.6], [7.35, -0.1, 0.1], red],
        [[2.6, 0.35, 2.2], [2.1, 0, 5.2], dark],
        [[0.4, 2.4, 2.4], [1, 1.7, 4.2], dark],
        [[0.4, 0.6, 1.6], [1, 3.2, 4.6], accent],
        [[0.8, 0.9, 1.2], [0.55, 0.1, 5], metal],
      ],
      [
        [[0.6, 0.6, 0.3], [-0.55, 0.1, 5.7], 0xff8a2a],
        [[0.6, 0.6, 0.3], [0.55, 0.1, 5.7], 0xff8a2a],
      ]
    );
  }

  buildMarioModel() {
    const red = 0xd63f2f;
    const blue = 0x2f63d6;
    const yellow = 0xffcf40;
    const white = 0xf5f5f5;
    const brown = 0x5a3716;
    const glass = 0x8fd3ff;
    this.assemble(
      [
        [[2.2, 2, 8], [0, 0.1, 0], red],
        [[2.3, 2.1, 0.8], [0, 0.1, -3.2], white],
        [[2, 1.8, 2], [0, 0.1, -5], yellow],
        [[1, 1, 1], [0, 0.1, -6.4], white],
        [[1.6, 1.5, 3], [0, 0.3, 5.3], red],
        [[1.6, 1.1, 2.6], [0, 1.5, -1.4], glass],
        [[1.6, 0.9, 1.4], [0, 1.4, 0.6], blue],
        [[1.4, 0.5, 6], [0, -1.1, 0], blue],
        [[0.5, 2.6, 2.2], [0, 2, 5.6], red],
        [[0.6, 1, 1], [0, 2.2, 5.4], white],
        [[0.5, 0.7, 1.6], [0, 3.6, 5.9], yellow],
      ],
      [
        [[0.4, 0.4, 2], [1.25, -0.3, -3.4], brown],
        [[3.6, 0.5, 3.8], [2.8, -0.4, -0.6], blue],
        [[2.6, 0.45, 3], [5.8, -0.4, -0.3], blue],
        [[0.8, 0.7, 3.4], [7.4, -0.3, -0.3], yellow],
        [[0.6, 0.54, 3.8], [3.6, -0.4, -0.6], white],
        [[0.4, 1.2, 0.4], [2.6, -1.2, -1.2], brown],
        [[0.8, 0.9, 1.8], [2.6, -2, -1.2], red],
        [[2.6, 0.4, 2], [2, 0.5, 5.6], blue],
        [[0.6, 0.5, 2.2], [3.5, 0.5, 5.6], yellow],
      ]
    );
    this.addPropeller([0, 0.1, -7.1], 5.4, brown);
  }

  buildF16Model() {
    const gray = 0x9aa3ad;
    const darkGray = 0x656d77;
    const canopy = 0x7bc3ff;
    const intake = 0x474c54;
    const black = 0x1a1a1a;
    const white = 0xf2f2f2;
    const red = 0xd63f2f;
    this.assemble(
      [
        [[1.7, 1.6, 10], [0, 0.1, 0.5], gray],
        [[1.4, 1.3, 3], [0, 0.15, -6], gray],
        [[0.9, 0.9, 2.2], [0, 0.1, -8.5], darkGray],
        [[0.4, 0.4, 1], [0, 0.1, -10], darkGray],
        [[1.2, 1, 3.4], [0, 1.15, -4], canopy],
        [[1.3, 0.5, 1], [0, 1.05, -2], darkGray],
        [[1, 0.6, 5], [0, 1.05, 1.5], gray],
        [[1.5, 0.9, 3.4], [0, -0.9, -2.4], intake],
        [[1.5, 0.9, 0.3], [0, -0.9, -4.2], black],
        [[1.3, 1.3, 1.4], [0, 0.1, 6.1], intake],
        [[0.5, 1, 3.6], [0, 1.4, 4], gray],
        [[0.4, 2.2, 2.6], [0, 2.9, 4.6], darkGray],
        [[0.4, 0.6, 1.6], [0, 4.2, 5], gray],
      ],
      [
        [[1, 0.35, 4], [1.3, 0, -2.5], gray],
        [[3, 0.4, 4.4], [2.4, 0, 1], gray],
        [[2.2, 0.4, 3.2], [5, 0, 1.7], gray],
        [[1.2, 0.35, 2.2], [6.7, 0, 2.3], darkGray],
        [[0.35, 0.35, 3.6], [7.45, 0, 1.8], white],
        [[0.35, 0.35, 0.5], [7.45, 0, -0.2], red],
        [[0.7, 0.7, 3.4], [3.6, -0.65, 0.8], darkGray],
        [[2.6, 0.3, 2.2], [2.2, 0, 5.4], darkGray],
        [[0.3, 0.8, 1.6], [0.7, -0.9, 4.6], darkGray],
      ],
      [[[0.9, 0.9, 0.3], [0, 0.1, 6.9], 0xff8a2a]]
    );
  }

  buildAirShowModel() {
    const red = 0xd92626;
    const navy = 0x1c2b5e;
    const gold = 0xc9a83e;
    const white = 0xf0f0f0;
    const teal = 0x3cd8c8;
    const black = 0x1a1a1a;
    this.assemble(
      [
        [[1.9, 1.7, 10], [0, 0.1, 0], red],
        [[2, 0.5, 6], [0, 0.3, -1], white],
        [[1.4, 1.3, 3], [0, 0.1, -6.3], white],
        [[0.8, 0.8, 1.8], [0, 0.1, -8.6], gold],
        [[1.3, 1, 4.2], [0, 1.2, -3], teal],
        [[1.35, 1.05, 0.3], [0, 1.2, -3], navy],
        [[1, 0.6, 4], [0, 1.1, 1.5], navy],
        [[1, 0.3, 11], [0, -0.85, -0.5], gold],
        [[1.2, 1.2, 1.2], [0, 0.1, 5.5], black],
        [[0.5, 3, 2.8], [0, 2, 4.2], navy],
        [[0.55, 0.6, 2.8], [0, 2.4, 4.2], gold],
        [[0.5, 0.7, 1.8], [0, 3.8, 4.7], red],
      ],
      [
        [[0.8, 1, 3], [1.3, 0, -1.6], navy],
        [[3, 0.45, 4.4], [2.4, -0.2, 0.6], red],
        [[2.4, 0.45, 3.4], [5, -0.2, 1.3], white],
        [[1.6, 0.4, 2.6], [6.9, -0.2, 1.9], navy],
        [[0.5, 0.5, 4.4], [3.6, -0.2, 0.6], gold],
        [[0.6, 0.6, 3.4], [7.9, -0.2, 1.8], gold],
        [[0.6, 0.6, 0.5], [7.9, -0.2, -0.1], red],
        [[2.8, 0.35, 2.2], [2.2, 0.1, 5], red],
        [[0.8, 0.36, 2.2], [3.9, 0.1, 5], navy],
      ],
      [[[0.8, 0.8, 0.3], [0, 0.1, 6.2], 0xff8a2a]]
    );
  }

  buildBrickStormModel() {
    const red = 0xcf2228;
    const darkRed = 0x99181d;
    const yellow = 0xe3c530;
    const blue = 0x2464c6;
    const green = 0x1f8a42;
    const lime = 0x92c83e;
    const cyan = 0x64d7ff;
    const black = 0x1a1a1a;
    const white = 0xf2f2f2;
    const lightGray = 0xb8bcc2;
    const gray = 0x7a7f86;
    const purple = 0x6d43a4;
    const orange = 0xd98a2e;

    this.radius = PLAYER_CONFIG.collisionRadius * 1.18;
    this.assemble(
      [
        [[3, 2.4, 15], [0, 0.1, 0], red],
        [[2.4, 2, 3], [0, 0, -9], darkRed],
        [[1.4, 1.2, 2], [0, -0.1, -11.5], yellow],
        [[2.3, 0.4, 5.2], [0, 1.2, -4.5], black],
        [[2.2, 1.5, 5], [0, 1.9, -4.5], cyan],
        [[1.8, 1, 6], [0, 1.6, 1.5], white],
        [[1.6, 0.6, 1.6], [0, 2.4, 2], lightGray],
        [[1, 0.6, 13], [0, -1.3, -0.5], black],
        [[2, 1.8, 3], [0, 0.2, 8.5], darkRed],
        [[1.4, 1.2, 0.8], [0, 0.2, 10.3], black],
        [[5, 0.4, 1.6], [0, 4.4, 7.9], green],
      ],
      [
        [[0.6, 0.6, 6], [1.5, -0.6, -9], black],
        [[0.8, 0.8, 0.8], [1.5, -0.6, -12.2], yellow],
        [[5, 0.7, 6], [4, -0.1, 0], yellow],
        [[4, 0.65, 4.8], [8.4, -0.1, 0.9], blue],
        [[2.2, 0.55, 3.6], [11.4, -0.1, 1.8], yellow],
        [[0.5, 2, 3], [12.5, 0.8, 2.1], red],
        [[0.8, 0.75, 6], [5.6, -0.1, 0], white],
        [[2, 1.8, 6], [5.4, -1.1, 0.4], lightGray],
        [[2.1, 1.9, 0.6], [5.4, -1.1, -2.9], black],
        [[2.1, 1.9, 0.8], [5.4, -1.1, 1], orange],
        [[1.4, 1.4, 1], [5.4, -1.1, 3.8], gray],
        [[0.9, 0.9, 3.6], [9, -0.9, 0.6], purple],
        [[0.9, 0.9, 0.5], [9, -0.9, -1.4], orange],
        [[0.7, 3.6, 3.2], [2.2, 2, 7.2], green],
        [[0.7, 0.8, 2.2], [2.2, 4.2, 7.7], lime],
        [[4.4, 0.5, 2.8], [3.6, 0.2, 7.4], white],
        [[1.2, 0.5, 2.8], [6.2, 0.2, 7.4], blue],
      ],
      [
        [[1, 1, 0.3], [-5.4, -1.1, 4.4], 0xff8a2a],
        [[1, 1, 0.3], [5.4, -1.1, 4.4], 0xff8a2a],
        [[0.9, 0.8, 0.3], [0, 0.2, 10.8], 0xff8a2a],
      ]
    );
  }

  setSkin(skin) {
    this.skin = skin;
    this.buildModel();
  }

  reset() {
    this.mesh.position.set(0, PLAYER_CONFIG.minAltitude, WORLD_CONFIG.runwayLength * 0.46);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.visible = true;
    this.velocity.set(0, 0, 0);
    this.state = GAME_STATES.START;
    this.health = PLAYER_CONFIG.maxHealth;
    this.missiles = PLAYER_CONFIG.maxMissiles;
    this.boost = 1;
    this.boosting = false;
    this.braking = false;
    this.fireTimer = 0;
    this.speed = 0;
    this.altitude = this.mesh.position.y;
    this.takeoffReady = false;
    this.justBecameReady = false;
    this.justLiftedOff = false;
    this.justLanded = false;
    this.crashed = false;
    this.takeoffTimer = 0;
    this.airborneTimer = 0;
    this.maneuverTimer = 0;
    this.landingPhase = "idle";
    this.manualLanding = false;
    this.rolloutDirection = -1;
    this.stunt = null;
    this.justCompletedStunt = null;
  }

  beginAutoLanding() {
    this.state = GAME_STATES.LANDING;
    this.landingPhase = "vector";
    this.manualLanding = false;
    this.rolloutDirection = -1;
    this.fireTimer = 0;
    this.stunt = null;
    this.boosting = false;
    this.takeoffReady = false;
  }

  cancelAutoLanding() {
    if (this.state !== GAME_STATES.LANDING || this.landingPhase === "rollout") {
      return false;
    }
    this.state = GAME_STATES.FLYING;
    this.landingPhase = "idle";
    return true;
  }

  beginRun() {
    this.state = GAME_STATES.TAXI;
  }

  beginStunt(type, direction) {
    if (this.state !== GAME_STATES.FLYING || this.stunt) {
      return false;
    }
    if (type === "loop" && this.altitude - this.groundLevel < STUNT_CONFIG.loopMinAltitude) {
      return false;
    }

    this.stunt = {
      type,
      direction,
      timer: 0,
      duration: type === "loop" ? STUNT_CONFIG.loopDuration : STUNT_CONFIG.rollDuration,
      startRoll: this.mesh.rotation.z,
      startPitch: this.mesh.rotation.x,
    };
    return true;
  }

  updateStunt(delta) {
    if (!this.stunt) {
      return;
    }

    this.stunt.timer += delta;
    if (this.stunt.timer < this.stunt.duration) {
      return;
    }

    // Snap back to the entry attitude so a full turn never accumulates into the Euler angles.
    this.mesh.rotation.z = this.stunt.startRoll;
    this.mesh.rotation.x = this.stunt.startPitch;
    this.justCompletedStunt = this.stunt.type;
    this.stunt = null;
  }

  stuntTurn(eased) {
    const t = THREE.MathUtils.clamp(this.stunt.timer / this.stunt.duration, 0, 1);
    const shaped = eased ? t * t * (3 - 2 * t) : t;
    return this.stunt.direction * Math.PI * 2 * shaped;
  }

  getWingtipPositions() {
    const [x, y, z] = this.layout.tip;
    return [this.mesh.localToWorld(new THREE.Vector3(-x, y, z + 0.6)), this.mesh.localToWorld(new THREE.Vector3(x, y, z + 0.6))];
  }

  getExhaustPositions() {
    return this.layout.exhausts.map((position) => this.mesh.localToWorld(new THREE.Vector3(...position)));
  }

  getMuzzlePosition() {
    return this.mesh.localToWorld(new THREE.Vector3(0, 0.4, -4.8));
  }

  getShotDirection() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.mesh.quaternion).normalize();
  }

  canFire() {
    return this.state === GAME_STATES.FLYING && this.fireTimer <= 0;
  }

  isOverRunway() {
    return (
      Math.abs(this.mesh.position.x) < WORLD_CONFIG.runwayHalfWidth &&
      Math.abs(this.mesh.position.z) < WORLD_CONFIG.runwayLength * 0.5
    );
  }

  heading() {
    return new THREE.Vector3(0, 0, -1).applyEuler(this.mesh.rotation).normalize();
  }

  update(delta, input, world) {
    this.fireTimer -= delta;
    this.maneuverTimer -= delta;
    this.justBecameReady = false;
    this.justLiftedOff = false;
    this.justCompletedStunt = null;
    this.justTouchedDown = false;
    this.justLanded = false;
    this.takeoffTimer += this.state === GAME_STATES.TAKEOFF ? delta : 0;
    this.airborneTimer += this.state === GAME_STATES.FLYING ? delta : 0;
    this.groundLevel = Math.max(world.heightAt(this.mesh.position.x, this.mesh.position.z), world.seaLevel);

    const target = input.getFlightTarget();
    if (this.state === GAME_STATES.TAXI) {
      this.updateTaxi(delta, input, target);
    } else if (this.state === GAME_STATES.TAKEOFF) {
      this.updateTakeoff(delta, input, target);
    } else if (this.state === GAME_STATES.LANDING) {
      this.updateLanding(delta, world);
    } else if (this.state === GAME_STATES.FLYING) {
      this.updateFlying(delta, input, target);
    }

    if (this.state !== GAME_STATES.FLYING) {
      this.boosting = false;
      this.braking = false;
      this.boost = Math.min(1, this.boost + PLAYER_CONFIG.boostRegen * delta);
    }
    this.altitude = this.mesh.position.y;
    this.speed = this.velocity.length();
    for (const spinner of this.spinners) {
      spinner.rotation.z += delta * (6 + this.speed * 0.5);
    }
    this.navTime = (this.navTime + delta) % 1.4;
    this.navLights[0].visible = this.navLights[1].visible = this.navTime > 0.12;
    this.navLights[2].visible = this.navTime < 0.07 || (this.navTime > 0.18 && this.navTime < 0.25);
  }

  updateTaxi(delta, input, target) {
    const steer = (input.rollLeft ? 1 : 0) - (input.rollRight ? 1 : 0);
    // Keep runway tracking deterministic: mouse aim should not induce ground yaw drift.
    this.mesh.rotation.y += steer * PLAYER_CONFIG.turnRateGround * delta;

    const forward = this.heading();
    forward.y = 0;
    forward.normalize();
    const currentForwardSpeed = Math.max(0, this.velocity.dot(forward));
    const nextSpeed = THREE.MathUtils.clamp(
      currentForwardSpeed +
        PLAYER_CONFIG.taxiAcceleration * input.throttle * delta -
        (PLAYER_CONFIG.drag + 24 * input.brake) * delta,
      0,
      PLAYER_CONFIG.maxTaxiSpeed
    );

    this.velocity.copy(forward.multiplyScalar(nextSpeed));
    this.mesh.position.addScaledVector(this.velocity, delta);
    this.mesh.position.y = PLAYER_CONFIG.minAltitude;
    this.mesh.rotation.z = THREE.MathUtils.damp(this.mesh.rotation.z, steer * 0.12, 6, delta);
    const noseUpIntent = target.y < -0.25 || input.pitchUp;
    const ready = nextSpeed >= PLAYER_CONFIG.takeoffCommitSpeed;
    this.mesh.rotation.x = THREE.MathUtils.damp(this.mesh.rotation.x, noseUpIntent && ready ? 0.3 : 0, 8, delta);
    // Running into the end of the strip stops the plane instead of leaving it pinned at full speed.
    if (this.keepOnRunway()) {
      this.velocity.set(0, 0, 0);
    }

    if (ready) {
      if (!this.takeoffReady) {
        this.takeoffReady = true;
        this.justBecameReady = true;
      }
    } else {
      this.takeoffReady = false;
    }

    if (this.takeoffReady && noseUpIntent) {
      this.state = GAME_STATES.TAKEOFF;
      this.takeoffTimer = 0;
      this.airborneTimer = 0;
      this.velocity.y = 0;
    }
  }

  updateTakeoff(delta, input, target) {
    const rolling = this.takeoffTimer < PLAYER_CONFIG.takeoffGroundRollTime;
    const turn = (input.rollRight ? 1 : 0) - (input.rollLeft ? 1 : 0);
    // The stick only gets a little authority here so a stray mouse cannot drag the plane off the strip.
    const yaw = rolling ? 0 : -(target.x * 0.3 + turn * 0.4) * PLAYER_CONFIG.turnRateAir;
    this.mesh.rotation.y += yaw * delta;
    this.mesh.rotation.x = THREE.MathUtils.damp(
      this.mesh.rotation.x,
      PLAYER_CONFIG.takeoffPitchAngle,
      PLAYER_CONFIG.takeoffRotateSpeed * 1.4,
      delta
    );
    this.mesh.rotation.z = THREE.MathUtils.damp(this.mesh.rotation.z, yaw * 0.3, 5, delta);

    const forward = this.heading();
    const currentSpeed = Math.max(this.velocity.length(), PLAYER_CONFIG.takeoffCommitSpeed);
    const nextSpeed = THREE.MathUtils.damp(currentSpeed, PLAYER_CONFIG.maxFlySpeed * 0.95, 2.2, delta);
    this.velocity.copy(forward.multiplyScalar(nextSpeed));

    if (rolling) {
      this.velocity.y = 0;
      this.mesh.position.addScaledVector(this.velocity, delta);
      this.mesh.position.y = PLAYER_CONFIG.minAltitude;
    } else {
      const liftPhase = THREE.MathUtils.clamp(
        (this.takeoffTimer - PLAYER_CONFIG.takeoffGroundRollTime) / PLAYER_CONFIG.takeoffLiftBlendTime,
        0,
        1
      );
      const wasOnGround = this.mesh.position.y <= PLAYER_CONFIG.minAltitude + 0.08;
      this.velocity.y *= liftPhase * liftPhase * (3 - 2 * liftPhase);
      this.mesh.position.addScaledVector(this.velocity, delta);
      this.mesh.position.y = Math.max(this.mesh.position.y, PLAYER_CONFIG.minAltitude);

      if (wasOnGround && this.mesh.position.y > PLAYER_CONFIG.minAltitude + 0.08) {
        this.justLiftedOff = true;
      }
    }

    if (
      this.takeoffTimer >= PLAYER_CONFIG.takeoffMinDuration &&
      this.mesh.position.y >= PLAYER_CONFIG.takeoffLiftOffAltitude
    ) {
      this.state = GAME_STATES.FLYING;
      this.airborneTimer = 0;
    }
  }

  updateFlying(delta, input, target) {
    this.updateStunt(delta);
    const looping = this.stunt?.type === "loop";
    const rolling = this.stunt?.type === "roll";
    const keyTurn = (input.rollRight ? 1 : 0) - (input.rollLeft ? 1 : 0);
    const rudder = (input.rudderRight ? 1 : 0) - (input.rudderLeft ? 1 : 0);
    const keyPitch = (input.pitchUp ? 1 : 0) - (input.pitchDown ? 1 : 0);
    const turn = THREE.MathUtils.clamp(target.x + keyTurn * 0.85, -1, 1);

    this.boosting = Boolean(input.throttle) && this.boost > 0 && !input.brake;
    this.braking = Boolean(input.brake);
    this.boost = THREE.MathUtils.clamp(
      this.boost + (this.boosting ? -PLAYER_CONFIG.boostDrain : PLAYER_CONFIG.boostRegen) * delta,
      0,
      1
    );

    // A slower plane turns tighter, which is what makes the air brake worth using in a fight.
    const agility = THREE.MathUtils.clamp(PLAYER_CONFIG.maxFlySpeed / Math.max(this.speed, 24), 0.7, 1.5);
    const yaw = -(turn * PLAYER_CONFIG.turnRateAir + rudder * PLAYER_CONFIG.turnRateAir * 0.45) * agility;
    const pitchTarget = THREE.MathUtils.clamp(-target.y * PLAYER_CONFIG.mousePitchStrength * 0.8 + keyPitch * 0.7, -1.1, 1.1);
    // Flare assist: slow and low over the strip, the nose will not drop past a survivable glide.
    const flaring =
      this.isOverRunway() &&
      this.mesh.position.y < 14 &&
      this.speed <= PLAYER_CONFIG.manualLandingMaxSpeed;
    const protectedPitchTarget =
      this.airborneTimer < PLAYER_CONFIG.takeoffPitchHold
        ? Math.max(pitchTarget, PLAYER_CONFIG.takeoffPitchAngle * 0.72)
        : flaring
          ? Math.max(pitchTarget, -0.25)
          : pitchTarget;
    const pitchStep = THREE.MathUtils.clamp(
      (protectedPitchTarget - this.mesh.rotation.x) * 2.6,
      -PLAYER_CONFIG.pitchRate,
      PLAYER_CONFIG.pitchRate
    );
    if (Math.abs(turn) > 0.45 || keyPitch !== 0 || Math.abs(target.y) > 0.45 || this.stunt) {
      this.maneuverTimer = 1.2;
    }

    this.mesh.rotation.y += yaw * delta;
    this.mesh.rotation.x = looping
      ? this.stunt.startPitch + this.stuntTurn(false)
      : THREE.MathUtils.clamp(this.mesh.rotation.x + pitchStep * delta, -1.1, 1.1);
    this.mesh.rotation.z = rolling
      ? this.stunt.startRoll + this.stuntTurn(true)
      : THREE.MathUtils.damp(this.mesh.rotation.z, -turn * 0.95 - rudder * 0.2, 5, delta);

    const forward = this.heading();
    const base = this.boosting
      ? PLAYER_CONFIG.boostSpeed
      : this.braking
        ? PLAYER_CONFIG.brakeSpeed
        : PLAYER_CONFIG.maxFlySpeed * 0.86;
    // Trade height for speed: climbing bleeds it off, diving builds it up.
    const targetSpeed = base - forward.y * 16;
    const nextSpeed = THREE.MathUtils.damp(this.velocity.length(), targetSpeed, this.braking ? 1.8 : 1.3, delta);

    this.velocity.copy(forward.multiplyScalar(nextSpeed));
    this.mesh.position.addScaledVector(this.velocity, delta);

    // A loop is a closed curve that ends just below where it began, so let it
    // overshoot the ceiling rather than flattening its top half.
    if (!looping) {
      this.mesh.position.y = Math.min(this.mesh.position.y, PLAYER_CONFIG.maxAltitude);
    }

    if (this.isOverRunway() && this.mesh.position.y <= PLAYER_CONFIG.minAltitude + 0.3) {
      this.touchRunway(nextSpeed);
    }
  }

  touchRunway(speed) {
    const forward = this.heading();
    const gentle =
      !this.stunt &&
      speed <= PLAYER_CONFIG.manualLandingMaxSpeed &&
      -this.velocity.y <= PLAYER_CONFIG.manualLandingMaxSink &&
      Math.abs(forward.z) > 0.8 &&
      Math.abs(this.mesh.rotation.z) < 0.6;
    if (!gentle) {
      this.crashed = true;
      return;
    }

    this.rolloutDirection = Math.sign(forward.z);
    this.mesh.position.y = PLAYER_CONFIG.minAltitude;
    this.velocity.set(0, 0, this.rolloutDirection * Math.min(speed, PLAYER_CONFIG.manualLandingMaxSpeed));
    this.state = GAME_STATES.LANDING;
    this.landingPhase = "rollout";
    this.manualLanding = true;
    this.justTouchedDown = true;
  }

  steerToward(delta, world, target, speedTarget, terrainFollow) {
    const position = this.mesh.position;
    const desiredYaw = Math.atan2(-(target.x - position.x), -(target.z - position.z));
    const error = Math.atan2(Math.sin(desiredYaw - this.mesh.rotation.y), Math.cos(desiredYaw - this.mesh.rotation.y));
    const yawStep = THREE.MathUtils.clamp(error * 2, -1.1, 1.1);
    this.mesh.rotation.y += yawStep * delta;

    const flat = new THREE.Vector3(-Math.sin(this.mesh.rotation.y), 0, -Math.cos(this.mesh.rotation.y));
    let desiredY = target.y;
    if (terrainFollow) {
      // Look down the flight path so the autopilot climbs over ridges before it reaches them.
      for (const ahead of [0, 50, 110, 190]) {
        const x = position.x + flat.x * ahead;
        const z = position.z + flat.z * ahead;
        desiredY = Math.max(desiredY, Math.max(world.heightAt(x, z), world.seaLevel) + 30);
      }
    }

    const speed = THREE.MathUtils.damp(Math.hypot(this.velocity.x, this.velocity.z), speedTarget, 1.4, delta);
    const climb = THREE.MathUtils.clamp((desiredY - position.y) * 1.2, -16, 22);
    this.velocity.set(flat.x * speed, THREE.MathUtils.damp(this.velocity.y, climb, 3, delta), flat.z * speed);
    position.addScaledVector(this.velocity, delta);
    this.mesh.rotation.x = THREE.MathUtils.damp(this.mesh.rotation.x, Math.atan2(this.velocity.y, speed), 3, delta);
    this.mesh.rotation.z = THREE.MathUtils.damp(this.mesh.rotation.z, yawStep * 0.6, 4, delta);
  }

  updateLanding(delta, world) {
    const position = this.mesh.position;
    const threshold = WORLD_CONFIG.runwayLength * 0.5;

    if (this.landingPhase === "vector") {
      const fix = new THREE.Vector3(0, 85, threshold + 560);
      this.steerToward(delta, world, fix, PLAYER_CONFIG.maxFlySpeed, true);
      if (Math.hypot(position.x - fix.x, position.z - fix.z) < 90) {
        this.landingPhase = "approach";
      }
      return;
    }

    if (this.landingPhase === "approach") {
      const glide = PLAYER_CONFIG.minAltitude + Math.max(0, position.z - (threshold - 60)) * 0.14;
      const aim = new THREE.Vector3(0, glide, position.z - 140);
      const speedTarget = position.z < threshold + 200 ? PLAYER_CONFIG.landingApproachSpeed : PLAYER_CONFIG.maxFlySpeed * 0.8;
      // The corridor in front of the strip is flattened, so terrain following only applies until the plane is lined up.
      this.steerToward(delta, world, aim, speedTarget, Math.abs(position.x) > 40);
      if (position.y <= PLAYER_CONFIG.minAltitude + 0.15 && position.z < threshold) {
        position.y = PLAYER_CONFIG.minAltitude;
        this.velocity.set(0, 0, -Math.min(Math.hypot(this.velocity.x, this.velocity.z), PLAYER_CONFIG.landingApproachSpeed));
        this.landingPhase = "rollout";
        this.justTouchedDown = true;
      }
      return;
    }

    const runwayYaw = this.rolloutDirection < 0 ? 0 : Math.PI;
    const yawError = Math.atan2(Math.sin(runwayYaw - this.mesh.rotation.y), Math.cos(runwayYaw - this.mesh.rotation.y));
    this.mesh.rotation.y += yawError * Math.min(1, 5 * delta);
    this.mesh.rotation.z = THREE.MathUtils.damp(this.mesh.rotation.z, 0, 5, delta);
    this.mesh.rotation.x = THREE.MathUtils.damp(this.mesh.rotation.x, 0, 7, delta);
    position.x = THREE.MathUtils.damp(position.x, 0, 1.5, delta);
    position.y = PLAYER_CONFIG.minAltitude;

    const rolloutSpeed = Math.max(0, Math.abs(this.velocity.z) - PLAYER_CONFIG.landingRollBrake * delta);
    this.velocity.set(0, 0, this.rolloutDirection * rolloutSpeed);
    position.addScaledVector(this.velocity, delta);
    const stopped = this.keepOnRunway() || rolloutSpeed <= 0.5;

    if (stopped) {
      this.velocity.set(0, 0, 0);
      this.state = GAME_STATES.TAXI;
      this.landingPhase = "idle";
      this.justLanded = true;
    }
  }

  keepOnRunway() {
    const position = this.mesh.position;
    const limitX = WORLD_CONFIG.runwayHalfWidth - 2;
    const limitZ = WORLD_CONFIG.runwayLength * 0.48;
    const blocked = Math.abs(position.z) > limitZ;
    position.x = THREE.MathUtils.clamp(position.x, -limitX, limitX);
    position.z = THREE.MathUtils.clamp(position.z, -limitZ, limitZ);
    return blocked;
  }
}
