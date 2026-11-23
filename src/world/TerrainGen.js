// Pure terrain definition shared by the chunk worker and the main thread. Both
// sides must agree on every height and tree, otherwise collisions would not
// match what is drawn, so all of it is deterministic from WORLD_SEED alone.
import { createSimplex, fbm, hash2, ridged } from "./Noise.js";

export const DEFAULT_SEED = 1337;

// The seed travels in the page URL (?seed=), and the chunk workers are started with the same
// query, so every thread builds the identical world without any messages about it.
function readSeed() {
  const value = Number.parseInt(new URLSearchParams(globalThis.location?.search ?? "").get("seed") ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value % 1000000000 : DEFAULT_SEED;
}

export const WORLD_SEED = readSeed();
// Zero for the default seed, so the original world keeps its exact trees and landmarks.
const SEED_SALT = WORLD_SEED - DEFAULT_SEED;

// Noise alone keeps every world looking alike around the airport, so each seed also picks a
// climate: temperature and moisture offsets plus how much of the land rises into mountains.
const CLIMATES = [
  { name: "temperate", temperature: 0, moisture: 0, mountains: 0 },
  { name: "desert", temperature: 0.5, moisture: -0.4, mountains: -0.1 },
  { name: "snowfield", temperature: -0.55, moisture: 0, mountains: 0.05 },
  { name: "rainforest", temperature: 0.1, moisture: 0.35, mountains: -0.05 },
  { name: "taiga", temperature: -0.3, moisture: 0.15, mountains: 0 },
  { name: "highlands", temperature: -0.05, moisture: 0, mountains: 0.3 },
  { name: "savanna", temperature: 0.3, moisture: -0.12, mountains: -0.15 },
];
export const CLIMATE = SEED_SALT === 0 ? CLIMATES[0] : CLIMATES[Math.floor(hash2(WORLD_SEED, 1, 977) * CLIMATES.length)];
const CLIMATE_TEMPERATURE = CLIMATE.temperature;
const CLIMATE_MOISTURE = CLIMATE.moisture;
const MOUNTAIN_BIAS = CLIMATE.mountains;
export const BLOCK = 2;
export const SEA_LEVEL = -6;
export const RUNWAY = { length: 900, width: 28, halfLength: 450, halfWidth: 14 };

export const LAYERS = [
  "grassTop", "grassSide", "dirt", "stone", "snow", "snowSide", "sand", "sandstone",
  "gravel", "logSide", "logTop", "leaves", "spruceLeaves", "asphalt", "whiteConcrete", "concrete",
  "bricks", "oakPlanks", "window", "metal", "redWool", "cactus", "tallGrass", "flowerRed",
  "flowerYellow", "lamp", "clay", "spruceLog", "roofTiles", "cobble", "whiteWool", "darkPlanks",
  "basalt", "lava", "ice", "packedIce", "terracotta", "redSand", "paleTerracotta", "cherryLeaves",
  "palmLeaves", "palmLog",
];
export const L = Object.fromEntries(LAYERS.map((name, index) => [name, index]));

export const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4, SNOW: 5, MOUNTAIN: 6, AIRPORT: 7, TAIGA: 8,
  VOLCANO: 9, GLACIER: 10, CANYON: 11, OASIS: 12, CHERRY: 13,
};

const noiseContinent = createSimplex(WORLD_SEED);
const noiseHills = createSimplex(WORLD_SEED + 1);
const noiseMask = createSimplex(WORLD_SEED + 2);
const noiseRidge = createSimplex(WORLD_SEED + 3);
const noiseCanyon = createSimplex(WORLD_SEED + 4);
const noiseTemp = createSimplex(WORLD_SEED + 5);
const noiseMoist = createSimplex(WORLD_SEED + 6);
const noiseCherry = createSimplex(WORLD_SEED + 7);
const noiseFeature = createSimplex(WORLD_SEED + 8);

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

function airportWeight(x, z) {
  const dx = Math.max(Math.abs(x) - 140, 0);
  const dz = Math.max(Math.abs(z) - 560, 0);
  return 1 - smoothstep(0, 280, Math.hypot(dx, dz));
}

// Volcanoes, glaciers, red-rock canyons and oases are placed features: at most one per cell,
// kept wholly inside it so a column only ever has to look at its own cell.
export const FEATURE_CELL = 1600;
const FEATURE_RADIUS = { volcano: 320, glacier: 380, canyon: 420, oasis: 80 };
const featureCache = new Map();

function featureClimate(x, z) {
  const distance = Math.hypot(x, z);
  const continent = fbm(noiseContinent, x * 0.00042, z * 0.00042, 4) + 0.55 * (1 - smoothstep(600, 1800, distance));
  return {
    land: smoothstep(-0.3, 0.02, continent),
    temperature: fbm(noiseTemp, x * 0.0005, z * 0.0005, 2) + CLIMATE_TEMPERATURE,
    moisture: fbm(noiseMoist, x * 0.0006 + 100, z * 0.0006 - 50, 2) + CLIMATE_MOISTURE,
  };
}

export function featureInCell(cx, cz) {
  const key = cx * 65536 + cz;
  if (featureCache.has(key)) {
    return featureCache.get(key);
  }
  let feature = null;
  const roll = hash2(cx, cz, 401 + SEED_SALT);
  const type = roll < 0.16 ? "volcano" : roll < 0.3 ? "glacier" : roll < 0.44 ? "canyon" : roll < 0.7 ? "oasis" : null;
  if (type) {
    const radius = FEATURE_RADIUS[type];
    const margin = radius + 20;
    const x = cx * FEATURE_CELL + margin + hash2(cx, cz, 402 + SEED_SALT) * (FEATURE_CELL - margin * 2);
    const z = cz * FEATURE_CELL + margin + hash2(cx, cz, 403 + SEED_SALT) * (FEATURE_CELL - margin * 2);
    // Keep the airfield and its approach corridors clear.
    const clear = !(Math.abs(x) < 700 + radius && Math.abs(z) < 2600 + radius);
    const climate = featureClimate(x, z);
    const fits = {
      volcano: climate.land > 0.9,
      glacier:
        climate.land > 0.9 &&
        climate.temperature < -0.12 &&
        [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => featureClimate(x + dx * radius, z + dz * radius).temperature < 0),
      canyon: climate.land > 0.9 && climate.temperature > -0.05 && climate.moisture < 0.15,
      oasis: climate.land > 0.95 && climate.temperature > 0.2 && climate.moisture < 0.02,
    }[type];
    if (clear && fits) {
      feature = { type, x, z, radius, seed: hash2(cx, cz, 404 + SEED_SALT) };
    }
  }
  if (featureCache.size > 4096) {
    featureCache.clear();
  }
  featureCache.set(key, feature);
  return feature;
}

export function featureAt(x, z) {
  const feature = featureInCell(Math.floor(x / FEATURE_CELL), Math.floor(z / FEATURE_CELL));
  if (!feature) {
    return null;
  }
  const dx = x - feature.x;
  const dz = z - feature.z;
  return dx * dx + dz * dz < feature.radius * feature.radius ? feature : null;
}

export const VOLCANO_PEAK = 185;
const CRATER = 46;

// Reshapes the height inside a feature; returns the blend weight (1 at the centre).
function shapeFeature(feature, x, z, height, column) {
  const distance = Math.hypot(x - feature.x, z - feature.z);
  const weight = 1 - smoothstep(feature.radius * 0.55, feature.radius, distance);
  column.featureDistance = distance;
  if (feature.type === "volcano") {
    const slope = Math.pow(1 - distance / feature.radius, 1.25);
    let cone = 8 + VOLCANO_PEAK * slope;
    if (distance < CRATER) {
      const rim = 8 + VOLCANO_PEAK * Math.pow(1 - CRATER / feature.radius, 1.25);
      cone = rim - 26 * (1 - smoothstep(CRATER - 16, CRATER, distance));
    }
    column.height = Math.max(height, lerp(height, cone, smoothstep(0, 0.35, 1 - distance / feature.radius)));
  } else if (feature.type === "glacier") {
    const dome = 40 + 22 * (1 - distance / feature.radius) + fbm(noiseFeature, x * 0.006, z * 0.006, 2) * 5;
    const crevasse = Math.abs(fbm(noiseFeature, x * 0.004 + 50, z * 0.004, 2)) < 0.035 ? 12 : 0;
    column.height = lerp(height, dome - crevasse, weight);
  } else if (feature.type === "canyon") {
    const plateau = 54 + ridged(noiseFeature, x * 0.003, z * 0.003, 3) * 34;
    let mesa = Math.floor(plateau / 10) * 10;
    const cut = Math.abs(fbm(noiseFeature, x * 0.0026 - 80, z * 0.0026 + 40, 3));
    if (cut < 0.09) {
      mesa = lerp(8, mesa, smoothstep(0.03, 0.09, cut));
    }
    column.height = lerp(height, mesa, weight);
  } else {
    const pond = 1 - smoothstep(18, 42, distance);
    column.height = lerp(height, SEA_LEVEL - 4, pond);
  }
  return weight;
}

const featureColumn = { height: 0, featureDistance: 0 };

export function sampleColumn(x, z, out) {
  const distance = Math.hypot(x, z);
  // Bias the continent noise near the origin so the airport never ends up on an island.
  const continent = fbm(noiseContinent, x * 0.00042, z * 0.00042, 4) + 0.55 * (1 - smoothstep(600, 1800, distance));
  const land = smoothstep(-0.3, 0.02, continent);

  const hills = 7 + fbm(noiseHills, x * 0.0032, z * 0.0032, 4) * 16;
  const mask = smoothstep(-0.08, 0.32, fbm(noiseMask, x * 0.0007 + 31.7, z * 0.0007 - 12.3, 3) + MOUNTAIN_BIAS);
  let mountain = 0;
  if (mask > 0) {
    mountain = Math.pow(ridged(noiseRidge, x * 0.0019, z * 0.0019, 5), 1.7) * 200 * mask;
  }
  let height = lerp(-16 - (1 - land) * 34, hills + mountain * land, land);

  // Canyons follow the zero-crossings of a low-frequency field: deep slots in
  // mountains, rivers in the lowlands.
  const canyonField = Math.abs(fbm(noiseCanyon, x * 0.0011, z * 0.0011, 3));
  const canyon = 1 - smoothstep(0.018, 0.055, canyonField);
  if (canyon > 0) {
    if (height > 34) {
      height = lerp(height, Math.max(16, hills + 6), canyon * smoothstep(34, 70, height));
    } else if (land > 0.5) {
      height = lerp(height, SEA_LEVEL - 5, smoothstep(0.35, 0.8, canyon) * smoothstep(0.5, 0.8, land));
    }
  }

  const airport = airportWeight(x, z);
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (ax < 280 && az > 560) {
    const corridor = (1 - smoothstep(110, 280, ax)) * (1 - smoothstep(1600, 2400, az));
    const cap = (az - 560) * 0.11;
    if (height > cap) {
      height = lerp(height, cap, corridor);
    }
  }
  height = lerp(height, 0, airport);

  const feature = airport < 0.01 ? featureAt(x, z) : null;
  let featureWeight = 0;
  if (feature) {
    featureWeight = shapeFeature(feature, x, z, height, featureColumn);
    height = featureColumn.height;
  }

  const blocks = Math.round(height / BLOCK);
  const top = blocks * BLOCK;
  const temperature = fbm(noiseTemp, x * 0.0005, z * 0.0005, 2) + CLIMATE_TEMPERATURE - Math.max(0, top - 40) * 0.004;
  const moisture = fbm(noiseMoist, x * 0.0006 + 100, z * 0.0006 - 50, 2) + CLIMATE_MOISTURE;

  let biome;
  if (airport > 0.92) {
    biome = BIOME.AIRPORT;
  } else if (top < SEA_LEVEL) {
    biome = BIOME.OCEAN;
  } else if (top <= SEA_LEVEL + 4 && land < 0.97) {
    biome = BIOME.BEACH;
  } else if (top > 150 || (temperature < -0.32 && top > 20)) {
    biome = BIOME.SNOW;
  } else if (top > 96) {
    biome = BIOME.MOUNTAIN;
  } else if (temperature > 0.2 && moisture < 0.02) {
    biome = BIOME.DESERT;
  } else if (temperature < -0.18) {
    biome = BIOME.TAIGA;
  } else if (moisture > 0.1) {
    biome = BIOME.FOREST;
  } else {
    biome = BIOME.PLAINS;
  }
  if ((biome === BIOME.FOREST || biome === BIOME.PLAINS) && fbm(noiseCherry, x * 0.0011 - 300, z * 0.0011 + 70, 2) > 0.36) {
    biome = BIOME.CHERRY;
  }
  if (feature && biome !== BIOME.OCEAN) {
    const reach = feature.type === "oasis" ? featureColumn.featureDistance < 64 : featureWeight > 0.5;
    if (reach) {
      biome = { volcano: BIOME.VOLCANO, glacier: BIOME.GLACIER, canyon: BIOME.CANYON, oasis: BIOME.OASIS }[feature.type];
    }
  }

  out.blocks = blocks;
  out.biome = biome;
  out.airport = airport;
  return out;
}

const scratch = { blocks: 0, biome: 0, airport: 0 };

export function heightBlocksAt(x, z) {
  return sampleColumn(x, z, scratch).blocks;
}

// Painted markings live in the terrain itself so the runway stays flush with
// the ground and costs no extra draw calls.
export function airportSurface(x, z) {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (ax < RUNWAY.halfWidth && az < RUNWAY.halfLength) {
    if (ax >= RUNWAY.halfWidth - BLOCK) {
      return L.whiteConcrete;
    }
    if (az > RUNWAY.halfLength - 34 && az < RUNWAY.halfLength - 14 && Math.floor(x / BLOCK) % 2 === 0) {
      return L.whiteConcrete;
    }
    if (ax < BLOCK && Math.floor((z + 1000) / 12) % 2 === 0 && az < RUNWAY.halfLength - 40) {
      return L.whiteConcrete;
    }
    return L.asphalt;
  }
  if (x > 40 && x < 126 && az < 170) {
    return L.concrete;
  }
  if (x >= RUNWAY.halfWidth && x <= 40 && (az < 12 || Math.abs(az - 312) < 12)) {
    return L.concrete;
  }
  return -1;
}

// Returns [top, side, sub, deep] layers for a column.
export function columnLayers(biome, top, steep, x, z, out) {
  if (biome === BIOME.AIRPORT) {
    const paint = airportSurface(x, z);
    out[0] = paint >= 0 ? paint : L.grassTop;
    out[1] = paint >= 0 ? L.concrete : L.grassSide;
    out[2] = L.dirt;
    out[3] = L.stone;
    return out;
  }
  if (biome === BIOME.OCEAN) {
    const deep = top < SEA_LEVEL - 20;
    out[0] = deep ? (hash2(x >> 3, z >> 3, 9) > 0.5 ? L.gravel : L.clay) : L.sand;
    out[1] = out[0];
    out[2] = L.sand;
    out[3] = L.stone;
    return out;
  }
  if (biome === BIOME.VOLCANO) {
    const feature = featureAt(x, z);
    const distance = feature ? Math.hypot(x - feature.x, z - feature.z) : Infinity;
    // A lava lake fills the crater, and a few lava rivers run down the flanks.
    const angle = feature ? Math.atan2(z - feature.z, x - feature.x) : 0;
    const river = Math.abs(Math.sin(angle * 3 + (feature?.seed ?? 0) * 6.28)) < 0.06 && distance > 40 && distance < 230;
    const lava = distance < CRATER - 14 || river;
    out[0] = lava ? L.lava : hash2(x >> 1, z >> 1, 5) > 0.85 ? L.gravel : L.basalt;
    out[1] = lava ? L.lava : L.basalt;
    out[2] = L.basalt;
    out[3] = L.basalt;
    return out;
  }
  if (biome === BIOME.GLACIER) {
    out[0] = steep ? L.packedIce : hash2(x >> 2, z >> 2, 6) > 0.6 ? L.snow : L.ice;
    out[1] = L.packedIce;
    out[2] = L.packedIce;
    out[3] = L.stone;
    return out;
  }
  if (biome === BIOME.CANYON) {
    // The terraces show as stripes because each step lands in a different band.
    const band = Math.floor(top / 6) % 3;
    out[0] = steep ? (band === 0 ? L.paleTerracotta : L.terracotta) : L.redSand;
    out[1] = band === 0 ? L.paleTerracotta : band === 1 ? L.terracotta : L.redSand;
    out[2] = L.terracotta;
    out[3] = L.terracotta;
    return out;
  }
  if (biome === BIOME.OASIS) {
    out[0] = top <= SEA_LEVEL + 2 ? L.sand : L.grassTop;
    out[1] = top <= SEA_LEVEL + 2 ? L.sand : L.grassSide;
    out[2] = L.sand;
    out[3] = L.sandstone;
    return out;
  }
  if (biome === BIOME.BEACH || biome === BIOME.DESERT) {
    out[0] = L.sand;
    out[1] = L.sand;
    out[2] = biome === BIOME.DESERT ? L.sandstone : L.sand;
    out[3] = L.sandstone;
    if (steep && biome === BIOME.DESERT) {
      out[0] = L.sandstone;
      out[1] = L.sandstone;
    }
    return out;
  }
  if (biome === BIOME.SNOW) {
    out[0] = L.snow;
    out[1] = steep ? L.stone : L.snowSide;
    out[2] = steep ? L.stone : L.dirt;
    out[3] = L.stone;
    return out;
  }
  if (biome === BIOME.MOUNTAIN || steep) {
    out[0] = top > 70 || biome === BIOME.MOUNTAIN ? L.stone : steep ? L.stone : L.grassTop;
    out[1] = L.stone;
    out[2] = L.stone;
    out[3] = L.stone;
    if (biome === BIOME.MOUNTAIN && !steep && hash2(x >> 1, z >> 1, 3) > 0.7) {
      out[0] = L.gravel;
    }
    return out;
  }
  out[0] = L.grassTop;
  out[1] = L.grassSide;
  out[2] = L.dirt;
  out[3] = L.stone;
  return out;
}

// Tree shapes in block units around the trunk's base; shared by the instanced
// geometry and the collision test so the two can never disagree.
export const TREE_SHAPES = [
  {
    name: "oak",
    boxes: [
      { min: [-0.5, 0, -0.5], max: [0.5, 5, 0.5], layer: L.logSide, sway: 0 },
      { min: [-2.5, 3, -2.5], max: [2.5, 5, 2.5], layer: L.leaves, sway: 0.6 },
      { min: [-1.5, 5, -1.5], max: [1.5, 6.5, 1.5], layer: L.leaves, sway: 1 },
    ],
  },
  {
    name: "spruce",
    boxes: [
      { min: [-0.5, 0, -0.5], max: [0.5, 7, 0.5], layer: L.spruceLog, sway: 0 },
      { min: [-2.5, 2, -2.5], max: [2.5, 3.5, 2.5], layer: L.spruceLeaves, sway: 0.4 },
      { min: [-2, 3.5, -2], max: [2, 5, 2], layer: L.spruceLeaves, sway: 0.6 },
      { min: [-1.5, 5, -1.5], max: [1.5, 6.5, 1.5], layer: L.spruceLeaves, sway: 0.8 },
      { min: [-0.5, 6.5, -0.5], max: [0.5, 8, 0.5], layer: L.spruceLeaves, sway: 1 },
    ],
  },
  {
    name: "cherry",
    boxes: [
      { min: [-0.5, 0, -0.5], max: [0.5, 4, 0.5], layer: L.darkPlanks, sway: 0 },
      { min: [-3, 3.2, -3], max: [3, 5.2, 3], layer: L.cherryLeaves, sway: 0.6 },
      { min: [-2, 5.2, -2], max: [2, 6.4, 2], layer: L.cherryLeaves, sway: 1 },
      { min: [-3.4, 2.6, -1], max: [-2.6, 3.2, 1], layer: L.cherryLeaves, sway: 0.5 },
      { min: [2.6, 2.6, -1], max: [3.4, 3.2, 1], layer: L.cherryLeaves, sway: 0.5 },
    ],
  },
  {
    name: "palm",
    boxes: [
      { min: [-0.4, 0, -0.4], max: [0.4, 6.5, 0.4], layer: L.palmLog, sway: 0 },
      { min: [-3.2, 6.3, -0.5], max: [3.2, 6.8, 0.5], layer: L.palmLeaves, sway: 1 },
      { min: [-0.5, 6.3, -3.2], max: [0.5, 6.8, 3.2], layer: L.palmLeaves, sway: 1 },
      { min: [-0.8, 6.5, -0.8], max: [0.8, 7.3, 0.8], layer: L.palmLeaves, sway: 1 },
      { min: [-3.6, 5.6, -0.4], max: [-3, 6.3, 0.4], layer: L.palmLeaves, sway: 1 },
      { min: [3, 5.6, -0.4], max: [3.6, 6.3, 0.4], layer: L.palmLeaves, sway: 1 },
    ],
  },
  {
    name: "cactus",
    boxes: [
      { min: [-0.5, 0, -0.5], max: [0.5, 3.5, 0.5], layer: L.cactus, sway: 0 },
      { min: [0.5, 1.5, -0.25], max: [1.25, 2.25, 0.25], layer: L.cactus, sway: 0 },
      { min: [0.75, 2.25, -0.25], max: [1.25, 3, 0.25], layer: L.cactus, sway: 0 },
    ],
  },
];

export const TREE_CELL = 8;
const shape = (name) => TREE_SHAPES.findIndex((tree) => tree.name === name);
const TREE_DENSITY = {
  [BIOME.FOREST]: { chance: 0.62, type: shape("oak") },
  [BIOME.PLAINS]: { chance: 0.045, type: shape("oak") },
  [BIOME.TAIGA]: { chance: 0.5, type: shape("spruce") },
  [BIOME.SNOW]: { chance: 0.12, type: shape("spruce") },
  [BIOME.DESERT]: { chance: 0.05, type: shape("cactus") },
  [BIOME.CANYON]: { chance: 0.03, type: shape("cactus") },
  [BIOME.CHERRY]: { chance: 0.45, type: shape("cherry") },
  [BIOME.OASIS]: { chance: 0.55, type: shape("palm") },
};

const treeColumn = { blocks: 0, biome: 0, airport: 0 };

export function treeInCell(cx, cz, out) {
  const roll = hash2(cx, cz, 71 + SEED_SALT);
  if (roll > 0.62) {
    return null;
  }
  const bx = cx * (TREE_CELL / BLOCK) + Math.floor(hash2(cx, cz, 72 + SEED_SALT) * (TREE_CELL / BLOCK));
  const bz = cz * (TREE_CELL / BLOCK) + Math.floor(hash2(cx, cz, 73 + SEED_SALT) * (TREE_CELL / BLOCK));
  const x = (bx + 0.5) * BLOCK;
  const z = (bz + 0.5) * BLOCK;
  sampleColumn(x, z, treeColumn);
  const density = TREE_DENSITY[treeColumn.biome];
  if (!density || roll > density.chance || treeColumn.airport > 0.02) {
    return null;
  }
  const blocks = treeColumn.blocks;
  if (Math.abs(heightBlocksAt(x + BLOCK * 2, z) - blocks) > 2 || Math.abs(heightBlocksAt(x, z + BLOCK * 2) - blocks) > 2) {
    return null;
  }
  if (insideLandmark(x, z)) {
    return null;
  }
  out.type = density.type;
  out.x = x;
  out.y = blocks * BLOCK;
  out.z = z;
  out.scale = (0.85 + hash2(cx, cz, 74 + SEED_SALT) * 0.5) * BLOCK;
  out.tint = hash2(cx, cz, 75 + SEED_SALT);
  return out;
}

export function treeBoxes(tree, target) {
  target.length = 0;
  for (const box of TREE_SHAPES[tree.type].boxes) {
    target.push({
      minX: tree.x + box.min[0] * tree.scale,
      minY: tree.y + box.min[1] * tree.scale,
      minZ: tree.z + box.min[2] * tree.scale,
      maxX: tree.x + box.max[0] * tree.scale,
      maxY: tree.y + box.max[1] * tree.scale,
      maxZ: tree.z + box.max[2] * tree.scale,
    });
  }
  return target;
}

export const LANDMARK_CELL = 1100;
const landmarkCache = new Map();
const landmarkColumn = { blocks: 0, biome: 0, airport: 0 };

export function landmarkInCell(cx, cz) {
  const key = cx * 65536 + cz;
  if (landmarkCache.has(key)) {
    return landmarkCache.get(key);
  }
  let result = null;
  if (hash2(cx, cz, 91 + SEED_SALT) < 0.8) {
    const x = Math.round(((cx + 0.5) * LANDMARK_CELL + (hash2(cx, cz, 92 + SEED_SALT) - 0.5) * 520) / BLOCK) * BLOCK;
    const z = Math.round(((cz + 0.5) * LANDMARK_CELL + (hash2(cx, cz, 93 + SEED_SALT) - 0.5) * 520) / BLOCK) * BLOCK;
    if (Math.hypot(x, z) > 900) {
      sampleColumn(x, z, landmarkColumn);
      const pick = hash2(cx, cz, 94 + SEED_SALT);
      const biome = landmarkColumn.biome;
      let type = null;
      let extra = null;
      if (biome === BIOME.PLAINS || biome === BIOME.FOREST || biome === BIOME.CHERRY) {
        type = pick < 0.32 ? "village" : pick < 0.44 ? "windmill" : pick < 0.58 ? "windfarm" : pick < 0.74 ? "city" : pick < 0.88 ? "castle" : "islands";
      } else if (biome === BIOME.BEACH) {
        type = pick < 0.45 ? "lighthouse" : "harbor";
        extra = { seaward: seawardDirection(x, z) };
      } else if (biome === BIOME.OCEAN) {
        extra = bridgeSpan(x, z);
        type = extra ? "bridge" : null;
      } else if (biome === BIOME.DESERT) {
        type = pick < 0.6 ? "pyramid" : "arch";
        extra = { rock: "sandstone" };
      } else if (biome === BIOME.CANYON) {
        type = "arch";
        extra = { rock: "terracotta" };
      } else if (biome === BIOME.MOUNTAIN || biome === BIOME.SNOW || biome === BIOME.TAIGA) {
        type = pick < 0.5 ? "tower" : pick < 0.8 ? "castle" : "islands";
      }
      // Wide landmarks need gentle ground, or their foundations become cliffs of cobblestone.
      const footprint = { city: 70, castle: 40, windfarm: 64 }[type];
      if (footprint && !flatEnough(x, z, footprint, 8)) {
        type = biome === BIOME.MOUNTAIN || biome === BIOME.SNOW || biome === BIOME.TAIGA ? "tower" : "windmill";
      }
      if (type) {
        const radius = { village: 46, windmill: 12, lighthouse: 10, pyramid: 34, tower: 10, windfarm: 80, city: 90, castle: 48, islands: 12, harbor: 50, bridge: 20, arch: 40 }[type];
        result = { type, x, z, radius, seed: Math.floor(hash2(cx, cz, 95 + SEED_SALT) * 1e9), ...extra };
      }
    }
  }
  if (landmarkCache.size > 4096) {
    landmarkCache.clear();
  }
  landmarkCache.set(key, result);
  return result;
}

function flatEnough(x, z, reach, limitBlocks) {
  const centre = heightBlocksAt(x, z);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
    const h = heightBlocksAt(x + dx * reach, z + dz * reach);
    if (Math.abs(h - centre) > limitBlocks || h * BLOCK <= SEA_LEVEL) {
      return false;
    }
  }
  return true;
}

// Which way the sea lies from a beach spot, as a unit [dx, dz] along an axis.
function seawardDirection(x, z) {
  let best = [0, -1];
  let lowest = Infinity;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const h = heightBlocksAt(x + dx * 60, z + dz * 60);
    if (h < lowest) {
      lowest = h;
      best = [dx, dz];
    }
  }
  return best;
}

// A bridge needs land on both sides of the water within reach: returns where the deck starts and ends.
function bridgeSpan(x, z) {
  const shore = (dx, dz) => {
    for (let d = 20; d <= 240; d += 10) {
      if (heightBlocksAt(x + dx * d, z + dz * d) * BLOCK > SEA_LEVEL + 2) {
        return d;
      }
    }
    return null;
  };
  for (const axis of hash2(Math.round(x), Math.round(z), 96) < 0.5 ? ["x", "z"] : ["z", "x"]) {
    const [dx, dz] = axis === "x" ? [1, 0] : [0, 1];
    const forward = shore(dx, dz);
    const back = shore(-dx, -dz);
    if (forward && back && forward + back >= 120) {
      return { axis, from: -back - 10, to: forward + 10 };
    }
  }
  return null;
}

export function insideLandmark(x, z) {
  const landmark = landmarkInCell(Math.floor(x / LANDMARK_CELL), Math.floor(z / LANDMARK_CELL));
  if (!landmark) {
    return false;
  }
  return Math.abs(x - landmark.x) < landmark.radius + 6 && Math.abs(z - landmark.z) < landmark.radius + 6;
}
