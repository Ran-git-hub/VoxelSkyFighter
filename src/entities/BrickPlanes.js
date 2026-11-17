import * as THREE from "three";
import { setupWorldMaterial } from "../world/WorldShading.js";

// Toy-brick proportions: a stud pitch, and a plate one third of a brick tall.
const STUD = 0.7;
const PLATE = 0.28;
const BASE_Y = -1.3;
const STUD_GEOMETRY = new THREE.CylinderGeometry(STUD * 0.3, STUD * 0.3, PLATE * 0.55, 10);

const C = {
  red: 0xc91a09,
  darkRed: 0x7a0f0a,
  yellow: 0xf2cd37,
  blue: 0x0055bf,
  lightBlue: 0x5a93db,
  white: 0xf4f4f4,
  black: 0x1b1b1b,
  grey: 0x9ba19d,
  darkGrey: 0x545955,
  glass: 0x9fd8f5,
  orange: 0xfe8a18,
  green: 0x237841,
};

function plastic(color) {
  return setupWorldMaterial(new THREE.MeshStandardMaterial({ color, roughness: color === C.glass ? 0.08 : 0.28, metalness: 0 }), { key: "brick" });
}

class BrickBuilder {
  constructor(group) {
    this.group = group;
    this.studs = [];
    this.spinners = [];
  }

  // w and l are in studs, h and y in plates; x and z are the centre in studs, y the underside.
  brick(w, h, l, x, y, z, color, studs = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * STUD, h * PLATE, l * STUD), plastic(color));
    mesh.position.set(x * STUD, BASE_Y + (y + h / 2) * PLATE, z * STUD);
    mesh.castShadow = true;
    this.group.add(mesh);
    if (studs) {
      const top = BASE_Y + (y + h) * PLATE + PLATE * 0.27;
      for (let i = 0; i < w; i += 1) {
        for (let j = 0; j < l; j += 1) {
          this.studs.push([(x - (w - 1) / 2 + i) * STUD, top, (z - (l - 1) / 2 + j) * STUD, color]);
        }
      }
    }
    return mesh;
  }

  // The same brick on both sides of the centreline.
  pair(w, h, l, x, y, z, color, studs = true) {
    this.brick(w, h, l, -x, y, z, color, studs);
    this.brick(w, h, l, x, y, z, color, studs);
  }

  propeller(x, y, z, span, color) {
    const hub = this.brick(1, 2.5, 1, x, y, z, C.darkGrey, false);
    for (const size of [
      [span * STUD, 0.28, 0.12],
      [0.28, span * STUD, 0.12],
    ]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(...size), plastic(color));
      blade.position.z = -STUD * 0.55;
      hub.add(blade);
    }
    this.spinners.push(hub);
  }

  finish() {
    const mesh = new THREE.InstancedMesh(STUD_GEOMETRY.clone(), plastic(0xffffff), this.studs.length);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    this.studs.forEach(([x, y, z, hex], index) => {
      mesh.setMatrixAt(index, matrix.makeTranslation(x, y, z));
      mesh.setColorAt(index, color.set(hex));
    });
    mesh.castShadow = true;
    this.group.add(mesh);
    return this.spinners;
  }
}

function biplane(b) {
  b.brick(2, 3, 13, 0, 2, 0, C.red, false);
  b.brick(2, 3, 4, 0, 5, -4.5, C.red);
  b.brick(2, 2, 1, 0, 5, -2, C.glass, false);
  b.brick(2, 1, 2, 0, 5, -0.5, C.black, false);
  b.brick(2, 3, 2, 0, 5, 1.5, C.yellow);
  b.brick(2, 2, 4, 0, 5, 4.5, C.red);
  b.brick(3, 5, 1, 0, 1.5, -7, C.darkGrey, false);
  b.propeller(0, 3, -7.9, 7, C.yellow);

  b.brick(14, 1, 4, 0, 1, -2.5, C.red);
  b.pair(2, 1, 4, 8, 1, -2.5, C.yellow);
  b.brick(16, 1, 4, 0, 12, -3.5, C.red);
  b.pair(2, 1, 4, 9, 12, -3.5, C.yellow);
  b.brick(4, 1, 4, 0, 13, -3.5, C.yellow);
  for (const z of [-4.5, -2]) {
    b.pair(1, 10, 1, 6, 2, z, C.black, false);
    b.pair(1, 4, 1, 1, 8, z, C.black, false);
  }

  b.brick(8, 1, 3, 0, 5, 5.5, C.yellow);
  b.brick(1, 6, 3, 0, 7, 5.5, C.red, false);
  b.brick(1, 2, 2, 0, 13, 6, C.yellow, false);

  b.pair(1, 4, 1, 2, -2, -3.5, C.black, false);
  b.brick(6, 1, 1, 0, -3, -3.5, C.darkGrey, false);
  b.pair(1, 4, 3, 3.5, -4.5, -3.5, C.black, false);
  b.brick(1, 2, 1, 0, 0, 6, C.black, false);
}

function airliner(b) {
  b.brick(3, 1, 22, 0, 1, 0, C.blue, false);
  b.brick(3, 2, 22, 0, 2, 0, C.white, false);
  b.brick(3, 1, 18, 0, 4, 0.5, C.black, false);
  b.brick(3, 2, 22, 0, 5, 0, C.white);
  b.brick(3, 4, 2, 0, 1, -12, C.white, false);
  b.brick(3, 1, 2, 0, 5, -12, C.black, false);
  b.brick(3, 1, 1, 0, 6, -11.5, C.white, false);
  b.brick(2, 3, 2, 0, 1.5, -14, C.white, false);
  b.brick(1, 2, 1, 0, 2, -15.5, C.blue, false);
  b.brick(2, 4, 3, 0, 3, 12.5, C.white, false);

  for (const [w, l, x, z] of [
    [5, 6, 4, -1],
    [4, 5, 8.5, 0.5],
    [3, 4, 12, 2],
    [2, 3, 14.5, 3.5],
  ]) {
    b.pair(w, 1, l, x, 2, z, C.white);
  }
  b.pair(1, 4, 2, 15.5, 3, 4, C.blue, false);
  b.pair(2, 3, 5, 6, -2, -2, C.grey, false);
  b.pair(2, 3, 1, 6, -2, -5, C.black, false);
  b.pair(1, 1, 2, 6, 1, -1.5, C.grey, false);

  b.pair(3, 1, 4, 3, 5, 11, C.white);
  b.pair(2, 1, 3, 5.5, 5, 12, C.white);
  b.brick(1, 5, 5, 0, 7, 10.5, C.blue, false);
  b.brick(1, 4, 4, 0, 12, 11.5, C.blue, false);
  b.brick(1, 3, 3, 0, 16, 12.5, C.lightBlue, false);
  b.brick(1, 2, 1, 0, -1, -9, C.black, false);
  b.pair(1, 2, 2, 2, -1, 1, C.black, false);
}

function seaplane(b) {
  b.brick(3, 5, 12, 0, 3, 0, C.yellow, false);
  b.brick(3, 1, 12, 0, 2, 0, C.white, false);
  b.brick(3, 4, 2, 0, 3, -7, C.white, false);
  b.brick(3, 5, 1, 0, 2.5, -8.5, C.darkGrey, false);
  b.propeller(0, 4, -9.4, 7, C.black);
  b.brick(3, 3, 5, 0, 8, -2.5, C.glass, false);
  b.brick(3, 2, 4, 0, 8, 2, C.yellow);
  b.brick(2, 4, 4, 0, 4, 8, C.yellow, false);
  b.brick(2, 3, 3, 0, 5, 11.5, C.yellow, false);

  b.brick(20, 1, 5, 0, 11, -2.5, C.yellow);
  b.pair(2, 1, 5, 11, 11, -2.5, C.red);
  b.brick(4, 1, 5, 0, 12, -2.5, C.white);
  b.pair(1, 8, 1, 4, 3, -2.5, C.black, false);

  b.brick(8, 1, 3, 0, 8, 11.5, C.yellow);
  b.brick(1, 6, 3, 0, 8, 11, C.red, false);
  b.brick(1, 2, 2, 0, 14, 11.5, C.white, false);

  b.pair(2, 3, 13, 4, -5, -1, C.white, false);
  b.pair(2, 1, 11, 4, -2, -0.5, C.red);
  b.pair(2, 2, 2, 4, -4, -8.5, C.white, false);
  b.pair(1, 4, 1, 4, -1, -3.5, C.black, false);
  b.pair(1, 4, 1, 4, -1, 2.5, C.black, false);
}

function jet(b) {
  b.brick(2, 4, 17, 0, 2, 0, C.blue, false);
  b.brick(2, 3, 3, 0, 2, -10, C.white, false);
  b.brick(1, 2, 3, 0, 2.5, -13, C.red, false);
  b.brick(2, 3, 5, 0, 6, -5.5, C.glass, false);
  b.brick(2, 2, 2, 0, 6, -2, C.white);
  b.brick(2, 2, 8, 0, 6, 3, C.blue);
  b.pair(1, 3, 6, 1.5, 2, -3, C.white, false);
  b.pair(1, 3, 1, 1.5, 2, -6.5, C.black, false);

  for (const [w, l, x, z] of [
    [4, 10, 3, 2],
    [3, 7, 6.5, 3.5],
    [2, 5, 9, 4.5],
  ]) {
    b.pair(w, 1, l, x, 3, z, C.white);
  }
  b.pair(1, 1, 6, 10.5, 3, 4.5, C.red);
  b.pair(1, 2, 5, 6, 1, 2, C.grey, false);
  b.pair(1, 1, 2, 6, 1.5, -1.5, C.red, false);

  b.pair(1, 7, 4, 1.5, 6, 6.5, C.white, false);
  b.pair(1, 2, 3, 1.5, 13, 7, C.red, false);
  b.pair(3, 1, 3, 3.5, 4, 8, C.blue);
  b.pair(1, 3, 1, 0.6, 2.5, 9, C.orange, false);
  b.brick(2, 4, 1, 0, 2, 9, C.darkGrey, false);
  b.brick(1, 2, 1, 0, 0, -6, C.black, false);
  b.pair(1, 2, 2, 2, 0, 2, C.black, false);
}

const BUILDERS = { brickbiplane: biplane, brickairliner: airliner, brickseaplane: seaplane, brickjet: jet };

export function isBrickSkin(skin) {
  return skin in BUILDERS;
}

// Fills the group with the model and returns the parts that should spin as propellers.
export function buildBrickPlane(group, skin) {
  const builder = new BrickBuilder(group);
  BUILDERS[skin](builder);
  return builder.finish();
}
