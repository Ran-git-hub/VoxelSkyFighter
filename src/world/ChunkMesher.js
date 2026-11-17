// Pure chunk mesher (runs in the worker). Columns are boxes on a heightmap, so
// a face is only ever emitted where a neighbouring column is lower.
import {
  BIOME,
  BLOCK,
  L,
  SEA_LEVEL,
  TREE_CELL,
  columnLayers,
  sampleColumn,
  treeInCell,
} from "./TerrainGen.js";
import { hash2 } from "./Noise.js";

const AO_CURVE = [0.42, 0.62, 0.8, 1];
const AO_BYTES = AO_CURVE.map((value) => Math.round(value * 255));

class Builder {
  constructor(capacity = 4096) {
    this.count = 0;
    this.indexCount = 0;
    this.positions = new Float32Array(capacity * 3);
    this.normals = new Int8Array(capacity * 3);
    this.uvs = new Float32Array(capacity * 2);
    this.layers = new Uint8Array(capacity);
    this.ao = new Uint8Array(capacity);
    this.indices = new Uint32Array(capacity * 1.5);
  }

  reserve(vertices) {
    if (this.count + vertices <= this.layers.length) {
      return;
    }
    const capacity = Math.max(this.layers.length * 2, this.count + vertices);
    const grow = (array, size) => {
      const next = new array.constructor(capacity * size);
      next.set(array);
      return next;
    };
    this.positions = grow(this.positions, 3);
    this.normals = grow(this.normals, 3);
    this.uvs = grow(this.uvs, 2);
    this.layers = grow(this.layers, 1);
    this.ao = grow(this.ao, 1);
    const indices = new Uint32Array(capacity * 1.5);
    indices.set(this.indices);
    this.indices = indices;
  }

  // corners: 4 × [x, y, z, u, v] in counter-clockwise order seen from outside.
  quad(corners, nx, ny, nz, layer, a0, a1, a2, a3) {
    this.reserve(4);
    const base = this.count;
    const aos = [a0, a1, a2, a3];
    for (let k = 0; k < 4; k += 1) {
      const c = corners[k];
      const v = base + k;
      this.positions[v * 3] = c[0];
      this.positions[v * 3 + 1] = c[1];
      this.positions[v * 3 + 2] = c[2];
      this.normals[v * 3] = nx * 127;
      this.normals[v * 3 + 1] = ny * 127;
      this.normals[v * 3 + 2] = nz * 127;
      this.uvs[v * 2] = c[3];
      this.uvs[v * 2 + 1] = c[4];
      this.layers[v] = layer;
      this.ao[v] = AO_BYTES[aos[k]];
    }
    // Flip the diagonal toward the brighter pair so AO gradients stay symmetric.
    const i = this.indexCount;
    if (a0 + a2 >= a1 + a3) {
      this.indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i);
    } else {
      this.indices.set([base + 1, base + 2, base + 3, base + 1, base + 3, base], i);
    }
    this.indexCount += 6;
    this.count += 4;
  }

  finish() {
    return {
      positions: this.positions.slice(0, this.count * 3),
      normals: this.normals.slice(0, this.count * 3),
      uvs: this.uvs.slice(0, this.count * 2),
      layers: this.layers.slice(0, this.count),
      ao: this.ao.slice(0, this.count),
      indices: this.indices.slice(0, this.indexCount),
    };
  }
}

function aoValue(side1, side2, corner) {
  if (side1 && side2) {
    return 0;
  }
  return 3 - (side1 + side2 + corner);
}

const SIDES = [
  { nx: 1, nz: 0 },
  { nx: -1, nz: 0 },
  { nx: 0, nz: 1 },
  { nx: 0, nz: -1 },
];

export function buildChunk({ x0, z0, size, cols, vegetation, grass }) {
  const step = size / cols;
  const stride = cols + 2;
  const heights = new Int16Array(stride * stride);
  const biomes = new Uint8Array(stride * stride);
  const column = { blocks: 0, biome: 0, airport: 0 };

  for (let j = 0; j < stride; j += 1) {
    for (let i = 0; i < stride; i += 1) {
      sampleColumn(x0 + (i - 0.5) * step, z0 + (j - 0.5) * step, column);
      heights[j * stride + i] = column.blocks;
      biomes[j * stride + i] = column.biome;
    }
  }

  const h = (i, j) => heights[j * stride + i];
  const solid = (i, j, level) => (level < heights[j * stride + i] ? 1 : 0);
  const terrain = new Builder(16384);
  const water = new Builder(1024);
  const layers = [0, 0, 0, 0];
  const steepLimit = Math.max(2, Math.round((step * 1.2) / BLOCK));
  const skirt = Math.ceil(step / BLOCK) * 2 + 3;
  const uvScale = 1 / BLOCK;
  const detailed = step <= BLOCK;

  for (let j = 1; j <= cols; j += 1) {
    let waterStart = -1;
    let waterDepth = 0;
    const flushWater = (endI) => {
      if (waterStart < 0) {
        return;
      }
      const xa = (waterStart - 1) * step;
      const xb = (endI - 1) * step;
      const za = (j - 1) * step;
      const zb = j * step;
      water.quad(
        [
          [xa, SEA_LEVEL, za, 0, 0],
          [xa, SEA_LEVEL, zb, 0, 0],
          [xb, SEA_LEVEL, zb, 0, 0],
          [xb, SEA_LEVEL, za, 0, 0],
        ],
        0, 1, 0, waterDepth, 3, 3, 3, 3
      );
      waterStart = -1;
    };
    let runStart = -1;
    let runKey = 0;
    let runTop = 0;
    let runLayer = 0;

    const flushRun = (endI) => {
      if (runStart < 0) {
        return;
      }
      const xa = (runStart - 1) * step;
      const xb = (endI - 1) * step;
      const za = (j - 1) * step;
      const zb = j * step;
      terrain.quad(
        [
          [xa, runTop, za, xa * uvScale, za * uvScale],
          [xa, runTop, zb, xa * uvScale, zb * uvScale],
          [xb, runTop, zb, xb * uvScale, zb * uvScale],
          [xb, runTop, za, xb * uvScale, za * uvScale],
        ],
        0, 1, 0, runLayer, 3, 3, 3, 3
      );
      runStart = -1;
    };

    for (let i = 1; i <= cols; i += 1) {
      const H = h(i, j);
      const top = H * BLOCK;
      const biome = biomes[j * stride + i];
      const steep =
        Math.max(Math.abs(H - h(i + 1, j)), Math.abs(H - h(i - 1, j)), Math.abs(H - h(i, j + 1)), Math.abs(H - h(i, j - 1))) >=
        steepLimit;
      const worldX = x0 + (i - 0.5) * step;
      const worldZ = z0 + (j - 0.5) * step;
      columnLayers(biome, top, steep, worldX, worldZ, layers);

      const a00 = aoValue(solid(i - 1, j, H), solid(i, j - 1, H), solid(i - 1, j - 1, H));
      const a01 = aoValue(solid(i - 1, j, H), solid(i, j + 1, H), solid(i - 1, j + 1, H));
      const a11 = aoValue(solid(i + 1, j, H), solid(i, j + 1, H), solid(i + 1, j + 1, H));
      const a10 = aoValue(solid(i + 1, j, H), solid(i, j - 1, H), solid(i + 1, j - 1, H));

      // Fully lit, equal-height columns merge into one quad along the row; that
      // is most of every plain and keeps triangle counts in budget.
      const mergeable = a00 === 3 && a01 === 3 && a11 === 3 && a10 === 3;
      const key = H * 64 + layers[0];
      if (mergeable && runStart >= 0 && key === runKey) {
        // extend
      } else {
        flushRun(i);
        if (mergeable) {
          runStart = i;
          runKey = key;
          runTop = top;
          runLayer = layers[0];
        } else {
          const xa = (i - 1) * step;
          const xb = i * step;
          const za = (j - 1) * step;
          const zb = j * step;
          terrain.quad(
            [
              [xa, top, za, xa * uvScale, za * uvScale],
              [xa, top, zb, xa * uvScale, zb * uvScale],
              [xb, top, zb, xb * uvScale, zb * uvScale],
              [xb, top, za, xb * uvScale, za * uvScale],
            ],
            0, 1, 0, layers[0], a00, a01, a11, a10
          );
        }
      }

      if (top < SEA_LEVEL) {
        // Beyond a dozen blocks the absorption colour has saturated, so deeper
        // columns share a depth and merge into long quads.
        const depth = Math.min(12, Math.round((SEA_LEVEL - top) / BLOCK));
        if (waterStart >= 0 && depth === waterDepth) {
          // extend
        } else {
          flushWater(i);
          waterStart = i;
          waterDepth = depth;
        }
      } else {
        flushWater(i);
      }

      for (const side of SIDES) {
        const fi = i + side.nx;
        const fj = j + side.nz;
        const Hn = h(fi, fj);
        const border = fi === 0 || fi === cols + 1 || fj === 0 || fj === cols + 1;
        if (Hn >= H && !border) {
          continue;
        }
        const lo = border ? Math.min(Hn, H) - skirt : Hn;
        const hi = H;
        if (lo >= hi) {
          continue;
        }
        const ux = Math.abs(side.nz);
        const uz = Math.abs(side.nx);
        const leftH = h(fi - ux, fj - uz);
        const rightH = h(fi + ux, fj + uz);
        // Distant columns are wide enough that per-block AO splits are invisible
        // but would double their triangle count.
        const breaks = detailed ? [lo, hi, hi - 1, hi - 4, lo + 1, leftH, rightH] : [lo, hi, hi - 1];
        const levels = [...new Set(breaks.filter((value) => value >= lo && value <= hi))].sort((a, b) => a - b);

        // Face plane and its in-plane horizontal extent.
        let fx0;
        let fx1;
        let fz0;
        let fz1;
        if (side.nx !== 0) {
          const px = side.nx > 0 ? i * step : (i - 1) * step;
          fx0 = px;
          fx1 = px;
          fz0 = (j - 1) * step;
          fz1 = j * step;
        } else {
          const pz = side.nz > 0 ? j * step : (j - 1) * step;
          fz0 = pz;
          fz1 = pz;
          fx0 = (i - 1) * step;
          fx1 = i * step;
        }

        for (let s = 0; s < levels.length - 1; s += 1) {
          const a = levels[s];
          const b = levels[s + 1];
          const layer = a >= hi - 1 ? layers[1] : a >= hi - 4 ? layers[2] : layers[3];
          const ya = a * BLOCK;
          const yb = b * BLOCK;
          // "low" lateral is the -u side, "high" the +u side.
          const lowTop = aoValue(solid(fi - ux, fj - uz, b - 1), solid(fi, fj, b), solid(fi - ux, fj - uz, b));
          const highTop = aoValue(solid(fi + ux, fj + uz, b - 1), solid(fi, fj, b), solid(fi + ux, fj + uz, b));
          const lowBottom = aoValue(solid(fi - ux, fj - uz, a), solid(fi, fj, a - 1), solid(fi - ux, fj - uz, a - 1));
          const highBottom = aoValue(solid(fi + ux, fj + uz, a), solid(fi, fj, a - 1), solid(fi + ux, fj + uz, a - 1));
          const va = -ya * uvScale;
          const vb = -yb * uvScale;

          if (side.nx !== 0) {
            const ua = fz0 * uvScale;
            const ub = fz1 * uvScale;
            if (side.nx > 0) {
              terrain.quad(
                [
                  [fx0, ya, fz1, ub, va],
                  [fx0, ya, fz0, ua, va],
                  [fx0, yb, fz0, ua, vb],
                  [fx0, yb, fz1, ub, vb],
                ],
                1, 0, 0, layer, highBottom, lowBottom, lowTop, highTop
              );
            } else {
              terrain.quad(
                [
                  [fx0, ya, fz0, ua, va],
                  [fx0, ya, fz1, ub, va],
                  [fx0, yb, fz1, ub, vb],
                  [fx0, yb, fz0, ua, vb],
                ],
                -1, 0, 0, layer, lowBottom, highBottom, highTop, lowTop
              );
            }
          } else {
            const ua = fx0 * uvScale;
            const ub = fx1 * uvScale;
            if (side.nz > 0) {
              terrain.quad(
                [
                  [fx0, ya, fz0, ua, va],
                  [fx1, ya, fz0, ub, va],
                  [fx1, yb, fz0, ub, vb],
                  [fx0, yb, fz0, ua, vb],
                ],
                0, 0, 1, layer, lowBottom, highBottom, highTop, lowTop
              );
            } else {
              terrain.quad(
                [
                  [fx1, ya, fz0, ub, va],
                  [fx0, ya, fz0, ua, va],
                  [fx0, yb, fz0, ua, vb],
                  [fx1, yb, fz0, ub, vb],
                ],
                0, 0, -1, layer, highBottom, lowBottom, lowTop, highTop
              );
            }
          }
        }
      }
    }
    flushRun(cols + 1);
    flushWater(cols + 1);
  }

  const result = { terrain: terrain.finish(), water: water.count > 0 ? water.finish() : null };

  if (vegetation) {
    const trees = [];
    const tree = { type: 0, x: 0, y: 0, z: 0, scale: 1, tint: 0 };
    const cx0 = Math.floor(x0 / TREE_CELL);
    const cz0 = Math.floor(z0 / TREE_CELL);
    const cells = Math.round(size / TREE_CELL);
    for (let cz = cz0; cz < cz0 + cells; cz += 1) {
      for (let cx = cx0; cx < cx0 + cells; cx += 1) {
        if (treeInCell(cx, cz, tree)) {
          trees.push(tree.type, tree.x, tree.y, tree.z, tree.scale, tree.tint);
        }
      }
    }
    result.trees = new Float32Array(trees);
  }

  if (grass) {
    const plants = [];
    for (let j = 1; j <= cols; j += 1) {
      for (let i = 1; i <= cols; i += 1) {
        const biome = biomes[j * stride + i];
        if (biome !== BIOME.PLAINS && biome !== BIOME.FOREST && biome !== BIOME.TAIGA && biome !== BIOME.AIRPORT) {
          continue;
        }
        const worldX = x0 + (i - 0.5) * step;
        const worldZ = z0 + (j - 0.5) * step;
        const H = h(i, j);
        if (biome === BIOME.AIRPORT) {
          columnLayers(biome, H * BLOCK, false, worldX, worldZ, layers);
          if (layers[0] !== L.grassTop || Math.abs(worldX) < 40) {
            continue;
          }
        }
        if (Math.max(Math.abs(H - h(i + 1, j)), Math.abs(H - h(i - 1, j))) > 1) {
          continue;
        }
        const roll = hash2(Math.floor(worldX), Math.floor(worldZ), 31);
        const grassChance = biome === BIOME.PLAINS ? 0.16 : biome === BIOME.AIRPORT ? 0.06 : 0.08;
        let kind = -1;
        if (roll < 0.012 && biome === BIOME.PLAINS) {
          kind = roll < 0.006 ? 1 : 2;
        } else if (roll < grassChance) {
          kind = 0;
        }
        if (kind < 0) {
          continue;
        }
        const jx = (hash2(Math.floor(worldX), Math.floor(worldZ), 32) - 0.5) * 1.2;
        const jz = (hash2(Math.floor(worldX), Math.floor(worldZ), 33) - 0.5) * 1.2;
        plants.push(kind, worldX + jx, H * BLOCK, worldZ + jz, hash2(Math.floor(worldX), Math.floor(worldZ), 34));
      }
    }
    result.plants = new Float32Array(plants);
  }

  if (step === BLOCK) {
    const grid = new Int16Array(cols * cols);
    for (let j = 0; j < cols; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        grid[j * cols + i] = h(i + 1, j + 1);
      }
    }
    result.heights = grid;
  }

  return result;
}
