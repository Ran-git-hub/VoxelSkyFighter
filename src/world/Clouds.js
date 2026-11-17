import * as THREE from "three";
import { setupWorldMaterial, worldUniforms } from "./WorldShading.js";
import { DEFAULT_SEED, WORLD_SEED } from "./TerrainGen.js";

const CLOUD_CELL = 12;
const CLOUD_GRID = 32;
export const CLOUD_TILE = CLOUD_CELL * CLOUD_GRID;
const CLOUD_TILES_AROUND = 2;
export const CLOUD_HEIGHT = 210;
const CLOUD_LAYER = 6;
const CLOUD_SPEED = 3;
const CLOUD_COVERAGE = 0.32;
// Albedo, not lighting: it stands in for self-shadowing inside the cloud so
// bellies read darker than the sunlit tops.
const CLOUD_SHADE = { top: 1, bottom: 0.55, side: 0.82 };

function cloudPattern() {
  let seed = 20240917 + (WORLD_SEED - DEFAULT_SEED);
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const at = (grid, i, j) => grid[((j + CLOUD_GRID) % CLOUD_GRID) * CLOUD_GRID + ((i + CLOUD_GRID) % CLOUD_GRID)];
  let values = Array.from({ length: CLOUD_GRID * CLOUD_GRID }, random);
  for (let pass = 0; pass < 2; pass += 1) {
    values = values.map((_, index) => {
      const i = index % CLOUD_GRID;
      const j = Math.floor(index / CLOUD_GRID);
      let sum = 0;
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          sum += at(values, i + di, j + dj);
        }
      }
      return sum / 9;
    });
  }
  const sorted = [...values].sort((a, b) => b - a);
  const threshold = sorted[Math.floor(values.length * CLOUD_COVERAGE)];
  const peak = sorted[0];
  const layers = values.map((value) => (value > threshold ? 1 + Math.min(2, Math.floor(((value - threshold) / (peak - threshold)) * 3.2)) : 0));
  return { layers, at: (i, j) => at(layers, i, j) };
}

function buildCloudGeometry(pattern) {
  const positions = [];
  const normals = [];
  const colors = [];
  const quad = (corners, normal, shade) => {
    for (const index of [0, 1, 2, 0, 2, 3]) {
      positions.push(...corners[index]);
      normals.push(...normal);
      colors.push(shade, shade, shade);
    }
  };

  const span = CLOUD_GRID * (CLOUD_TILES_AROUND * 2 + 1);
  const offset = CLOUD_GRID * CLOUD_TILES_AROUND;
  for (let j = 0; j < span; j += 1) {
    for (let i = 0; i < span; i += 1) {
      const layers = pattern.at(i, j);
      if (!layers) {
        continue;
      }
      const x0 = (i - offset) * CLOUD_CELL;
      const z0 = (j - offset) * CLOUD_CELL;
      const x1 = x0 + CLOUD_CELL;
      const z1 = z0 + CLOUD_CELL;
      const y1 = layers * CLOUD_LAYER;
      quad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0], CLOUD_SHADE.top);
      quad([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], [0, -1, 0], CLOUD_SHADE.bottom);
      const sides = [
        [pattern.at(i + 1, j), (ya, yb) => [[x1, ya, z0], [x1, yb, z0], [x1, yb, z1], [x1, ya, z1]], [1, 0, 0]],
        [pattern.at(i - 1, j), (ya, yb) => [[x0, ya, z1], [x0, yb, z1], [x0, yb, z0], [x0, ya, z0]], [-1, 0, 0]],
        [pattern.at(i, j + 1), (ya, yb) => [[x1, ya, z1], [x1, yb, z1], [x0, yb, z1], [x0, ya, z1]], [0, 0, 1]],
        [pattern.at(i, j - 1), (ya, yb) => [[x0, ya, z0], [x0, yb, z0], [x1, yb, z0], [x1, ya, z0]], [0, 0, -1]],
      ];
      for (const [neighbour, corners, normal] of sides) {
        if (neighbour < layers) {
          quad(corners(neighbour * CLOUD_LAYER, y1), normal, CLOUD_SHADE.side);
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function buildShadowTexture(pattern) {
  const data = new Uint8Array(CLOUD_GRID * CLOUD_GRID * 4);
  pattern.layers.forEach((layers, index) => {
    const value = layers ? 150 + layers * 35 : 0;
    data.set([value, value, value, 255], index * 4);
  });
  const texture = new THREE.DataTexture(data, CLOUD_GRID, CLOUD_GRID);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class Clouds {
  constructor(scene) {
    const pattern = cloudPattern();
    this.fadeUniforms = {
      uCloudFade: { value: new THREE.Vector2(560, 860) },
    };
    const material = setupWorldMaterial(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, alphaHash: true, side: THREE.DoubleSide }),
      {
        key: "clouds",
        defines: { NO_CLOUD_SHADOW: 1 },
        uniforms: this.fadeUniforms,
        patch: (shader) => {
          shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nuniform vec2 uCloudFade;")
            // Dithered fade keeps clouds opaque (no sorting) while hiding the tile edge.
            .replace(
              "#include <alphahash_fragment>",
              "diffuseColor.a *= 1.0 - smoothstep(uCloudFade.x, uCloudFade.y, length(vWorldPos.xz - cameraPosition.xz));\n#include <alphahash_fragment>"
            );
        },
      }
    );
    this.pattern = pattern;
    this.material = material;
    this.mesh = new THREE.Mesh(buildCloudGeometry(pattern), material);
    this.mesh.frustumCulled = false;
    this.drift = 0;
    scene.add(this.mesh);
    // A second copy of the deck, shifted so it fills the gaps of the first; it grows out of nothing as the weather closes in.
    this.deck = new THREE.Mesh(this.mesh.geometry, material);
    this.deck.frustumCulled = false;
    this.deck.visible = false;
    scene.add(this.deck);
    this.thickness = 1;

    worldUniforms.uCloudMap.value = buildShadowTexture(pattern);
    worldUniforms.uCloudParams.value.set(0, 0, 1 / CLOUD_TILE, CLOUD_HEIGHT);
  }

  setFade(start, end) {
    this.fadeUniforms.uCloudFade.value.set(start, end);
  }

  // overcast thickens the layer and brings in the second deck; storm turns it slate grey.
  setWeather(overcast, storm) {
    this.thickness = 1 + overcast * 1.6;
    this.mesh.scale.y = this.thickness;
    this.deck.visible = overcast > 0.05;
    this.deck.scale.y = Math.max(0.02, overcast * 2.2);
    this.material.color.setScalar(1 - 0.35 * overcast - 0.3 * storm);
  }

  // How many layers of cloud sit over this point, 0 in clear air.
  layersAt(x, z) {
    return this.pattern.at(Math.floor((x - this.drift) / CLOUD_CELL) % CLOUD_GRID, Math.floor(z / CLOUD_CELL) % CLOUD_GRID);
  }

  inside(position) {
    const layers = this.layersAt(position.x, position.z);
    const height = position.y - CLOUD_HEIGHT;
    return layers > 0 && height > -2 && height < layers * CLOUD_LAYER * this.thickness + 2;
  }

  update(focus, delta) {
    this.drift = (this.drift + delta * CLOUD_SPEED) % CLOUD_TILE;
    this.mesh.position.set(
      Math.floor((focus.x - this.drift) / CLOUD_TILE) * CLOUD_TILE + this.drift,
      CLOUD_HEIGHT,
      Math.floor(focus.z / CLOUD_TILE) * CLOUD_TILE
    );
    this.deck.position.set(this.mesh.position.x + CLOUD_TILE * 0.5, CLOUD_HEIGHT + 4, this.mesh.position.z + CLOUD_TILE * 0.5);
    worldUniforms.uCloudParams.value.x = this.drift;
    worldUniforms.uCloudParams.value.y = 0;
  }
}
