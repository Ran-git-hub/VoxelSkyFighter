import * as THREE from "three";
import { LAYERS } from "./TerrainGen.js";
import { setupWorldMaterial } from "./WorldShading.js";

export const BLOCK_SIZE = 2;
const ENTITY_TILE = 1;
const TEXTURE_SIZE = 16;

const GRASS = ["#6fb04f", "#78b957", "#65a646", "#7fc15e", "#5f9e42"];
const DIRT = ["#8a5a33", "#7b4f2c", "#946439", "#6f4627", "#85563a"];

function fill(ctx, palette) {
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      ctx.pixel(x, y, ctx.pick(palette));
    }
  }
}

function speckle(ctx, colors, chance) {
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      if (ctx.random() < chance) {
        ctx.pixel(x, y, ctx.pick(colors));
      }
    }
  }
}

const PAINTERS = {
  grassTop(ctx) {
    fill(ctx, GRASS);
    speckle(ctx, ["#58913b", "#8ccb68"], 0.08);
  },
  dirt(ctx) {
    fill(ctx, DIRT);
    speckle(ctx, ["#5e3b20", "#a2754a"], 0.1);
  },
  grassSide(ctx) {
    PAINTERS.dirt(ctx);
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const depth = 2 + Math.floor(ctx.random() * 3);
      for (let y = 0; y < depth; y += 1) {
        ctx.pixel(x, y, ctx.pick(GRASS));
      }
    }
  },
  stone(ctx) {
    fill(ctx, ["#8b8b8b", "#7f7f7f", "#959595", "#858585", "#7a7a7a"]);
    for (let i = 0; i < 10; i += 1) {
      const x = Math.floor(ctx.random() * TEXTURE_SIZE);
      const y = Math.floor(ctx.random() * TEXTURE_SIZE);
      const length = 2 + Math.floor(ctx.random() * 3);
      for (let k = 0; k < length; k += 1) {
        ctx.pixel((x + k) % TEXTURE_SIZE, y, "#6c6c6c");
      }
    }
  },
  snow(ctx) {
    fill(ctx, ["#f3f7fa", "#ffffff", "#e9eff4", "#eef3f7"]);
  },
  logSide(ctx) {
    const bands = ["#6b4a26", "#5b3d1f", "#76532c"];
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const band = bands[Math.floor(x / 2) % bands.length];
      for (let y = 0; y < TEXTURE_SIZE; y += 1) {
        ctx.pixel(x, y, ctx.random() < 0.2 ? "#4c331a" : band);
      }
    }
  },
  logTop(ctx) {
    for (let y = 0; y < TEXTURE_SIZE; y += 1) {
      for (let x = 0; x < TEXTURE_SIZE; x += 1) {
        const ring = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        const color = ring > 6.5 ? "#5b3d1f" : Math.floor(ring) % 2 ? "#b8925a" : "#a17c47";
        ctx.pixel(x, y, color);
      }
    }
  },
  leaves(ctx) {
    fill(ctx, ["#3c8c3a", "#337d31", "#46983f", "#2c6f2c"]);
    speckle(ctx, ["#1f4f20"], 0.12);
  },
  water(ctx) {
    fill(ctx, ["#3f7fd6", "#3a76cc", "#4588de", "#3570c4"]);
    for (let i = 0; i < 7; i += 1) {
      const x = Math.floor(ctx.random() * TEXTURE_SIZE);
      const y = Math.floor(ctx.random() * TEXTURE_SIZE);
      for (let k = 0; k < 3; k += 1) {
        ctx.pixel((x + k) % TEXTURE_SIZE, y, "#6aa6ec");
      }
    }
  },
  asphalt(ctx) {
    fill(ctx, ["#55555d", "#4e4e56", "#5b5b63", "#494950"]);
  },
  whiteConcrete(ctx) {
    fill(ctx, ["#eeeeee", "#e6e6e6", "#f4f4f4", "#e0e0e0"]);
  },
  wool(ctx) {
    fill(ctx, ["#f2f2f2", "#e8e8e8", "#fafafa", "#e2e2e2"]);
    for (let y = 0; y < TEXTURE_SIZE; y += 1) {
      for (let x = 0; x < TEXTURE_SIZE; x += 1) {
        if ((x + y) % 4 === 0) {
          ctx.pixel(x, y, "#d4d4d4");
        }
      }
    }
  },
  iron(ctx) {
    fill(ctx, ["#f0f0f0", "#eaeaea", "#f6f6f6"]);
    for (let i = 0; i < TEXTURE_SIZE; i += 1) {
      ctx.pixel(i, 0, "#bdbdbd");
      ctx.pixel(i, TEXTURE_SIZE - 1, "#bdbdbd");
      ctx.pixel(0, i, "#bdbdbd");
      ctx.pixel(TEXTURE_SIZE - 1, i, "#bdbdbd");
    }
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) {
      ctx.pixel(x, y, "#a8a8a8");
    }
  },
  glass(ctx) {
    fill(ctx, ["#f6fbff"]);
    for (let i = 0; i < TEXTURE_SIZE; i += 1) {
      ctx.pixel(i, 0, "#c8d6e0");
      ctx.pixel(i, TEXTURE_SIZE - 1, "#c8d6e0");
      ctx.pixel(0, i, "#c8d6e0");
      ctx.pixel(TEXTURE_SIZE - 1, i, "#c8d6e0");
    }
    for (const [x, y] of [[3, 12], [4, 11], [5, 10], [9, 6], [10, 5], [11, 4], [12, 3]]) {
      ctx.pixel(x, y, "#ffffff");
    }
  },
  planks(ctx) {
    fill(ctx, ["#f0f0f0", "#e6e6e6", "#f8f8f8"]);
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      ctx.pixel(x, 3, "#b4b4b4");
      ctx.pixel(x, 7, "#b4b4b4");
      ctx.pixel(x, 11, "#b4b4b4");
      ctx.pixel(x, 15, "#b4b4b4");
    }
    for (const [x, y] of [[5, 0], [5, 1], [5, 2], [12, 4], [12, 5], [12, 6], [2, 8], [2, 9], [2, 10], [9, 12], [9, 13], [9, 14]]) {
      ctx.pixel(x, y, "#c4c4c4");
    }
  },
  snowSide(ctx) {
    PAINTERS.dirt(ctx);
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const depth = 3 + Math.floor(ctx.random() * 3);
      for (let y = 0; y < depth; y += 1) {
        ctx.pixel(x, y, ctx.pick(["#f3f7fa", "#ffffff", "#e6edf2"]));
      }
    }
  },
  sand(ctx) {
    fill(ctx, ["#dbcf9a", "#d6c992", "#e1d6a3", "#d0c38b", "#e6dcab"]);
    speckle(ctx, ["#c4b67d", "#ebe2b6"], 0.08);
  },
  sandstone(ctx) {
    fill(ctx, ["#d8c58c", "#d1bd83", "#dccb94"]);
    for (const y of [3, 4, 10, 11]) {
      for (let x = 0; x < TEXTURE_SIZE; x += 1) {
        ctx.pixel(x, y, ctx.random() < 0.7 ? "#c2ad72" : "#cbb77c");
      }
    }
  },
  gravel(ctx) {
    fill(ctx, ["#8a817c", "#7a726e", "#9a918b", "#6c6561", "#a39b95"]);
    speckle(ctx, ["#5b5552", "#b2aaa3"], 0.15);
  },
  clay(ctx) {
    fill(ctx, ["#9fa4b0", "#979ca8", "#a6abb7"]);
  },
  spruceLeaves(ctx) {
    fill(ctx, ["#2f5a35", "#294f2e", "#33613a", "#244629"]);
    speckle(ctx, ["#1b361f"], 0.14);
  },
  spruceLog(ctx) {
    const bands = ["#4a3220", "#3d2a1b", "#523825"];
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const band = bands[Math.floor(x / 3) % bands.length];
      for (let y = 0; y < TEXTURE_SIZE; y += 1) {
        ctx.pixel(x, y, ctx.random() < 0.18 ? "#2e1f14" : band);
      }
    }
  },
  concrete(ctx) {
    fill(ctx, ["#a3a3a3", "#9c9c9c", "#a9a9a9", "#979797"]);
    speckle(ctx, ["#8c8c8c", "#b4b4b4"], 0.06);
  },
  bricks(ctx) {
    fill(ctx, ["#9a4a3a", "#8f4334", "#a35242"]);
    for (let y = 0; y < TEXTURE_SIZE; y += 4) {
      for (let x = 0; x < TEXTURE_SIZE; x += 1) {
        ctx.pixel(x, y, "#b8aea3");
      }
      const offset = (y / 4) % 2 === 0 ? 0 : 4;
      for (let x = offset; x < TEXTURE_SIZE; x += 8) {
        for (let k = 1; k < 4; k += 1) {
          ctx.pixel(x, (y + k) % TEXTURE_SIZE, "#b8aea3");
        }
      }
    }
  },
  oakPlanks(ctx) {
    fill(ctx, ["#a8834f", "#9f7b49", "#b08a55"]);
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      for (const y of [3, 7, 11, 15]) {
        ctx.pixel(x, y, "#7d5f37");
      }
    }
    for (const [x, y] of [[5, 0], [5, 1], [5, 2], [12, 4], [12, 5], [12, 6], [2, 8], [2, 9], [2, 10], [9, 12], [9, 13], [9, 14]]) {
      ctx.pixel(x, y, "#86663c");
    }
  },
  darkPlanks(ctx) {
    fill(ctx, ["#5c4129", "#553c26", "#634630"]);
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      for (const y of [3, 7, 11, 15]) {
        ctx.pixel(x, y, "#3e2b1a");
      }
    }
  },
  window(ctx) {
    fill(ctx, ["#d9d2c2"]);
    for (let y = 2; y < 14; y += 1) {
      for (let x = 2; x < 14; x += 1) {
        ctx.pixel(x, y, x === 7 || x === 8 || y === 7 || y === 8 ? "#d9d2c2" : ctx.pick(["#ffd98a", "#ffcf70", "#ffe2a0"]));
      }
    }
  },
  metal(ctx) {
    fill(ctx, ["#b9bec4", "#b2b7bd", "#c0c5cb"]);
    for (let x = 0; x < TEXTURE_SIZE; x += 4) {
      for (let y = 0; y < TEXTURE_SIZE; y += 1) {
        ctx.pixel(x, y, "#8e959c");
      }
    }
  },
  redWool(ctx) {
    fill(ctx, ["#b8302c", "#ad2b27", "#c23631"]);
    speckle(ctx, ["#9b2420"], 0.1);
  },
  whiteWool(ctx) {
    fill(ctx, ["#ecebe7", "#e4e3df", "#f2f1ed"]);
    speckle(ctx, ["#d6d5d0"], 0.1);
  },
  cactus(ctx) {
    fill(ctx, ["#4f8a32", "#478029", "#56933a"]);
    for (let y = 0; y < TEXTURE_SIZE; y += 1) {
      for (const x of [0, 5, 10, 15]) {
        ctx.pixel(x, y, "#2f5a1d");
      }
      if (y % 4 === 1) {
        ctx.pixel(3, y, "#e8e2c0");
        ctx.pixel(12, y, "#e8e2c0");
      }
    }
  },
  tallGrass(ctx) {
    fill(ctx, ["#5f9e42", "#6aaa4a", "#57923c", "#74b553"]);
    speckle(ctx, ["#4a8433", "#86c463"], 0.2);
  },
  flowerRed(ctx) {
    fill(ctx, ["#d8312c", "#c92a25", "#e33b35"]);
    speckle(ctx, ["#f6d33c"], 0.08);
  },
  flowerYellow(ctx) {
    fill(ctx, ["#f2cf2f", "#e8c427", "#f7da48"]);
    speckle(ctx, ["#b0782a"], 0.08);
  },
  lamp(ctx) {
    fill(ctx, ["#fff2c8", "#ffeab0", "#fff8de"]);
  },
  roofTiles(ctx) {
    fill(ctx, ["#5a3a34", "#52342f", "#62403a"]);
    for (let y = 1; y < TEXTURE_SIZE; y += 4) {
      for (let x = 0; x < TEXTURE_SIZE; x += 1) {
        ctx.pixel(x, y, "#3f2824");
      }
    }
  },
  cobble(ctx) {
    fill(ctx, ["#7d7d7d", "#737373", "#868686"]);
    for (let i = 0; i < 26; i += 1) {
      const x = Math.floor(ctx.random() * TEXTURE_SIZE);
      const y = Math.floor(ctx.random() * TEXTURE_SIZE);
      ctx.pixel(x, y, "#5a5a5a");
      ctx.pixel((x + 1) % TEXTURE_SIZE, y, "#5a5a5a");
    }
    speckle(ctx, ["#9a9a9a"], 0.08);
  },
  basalt(ctx) {
    fill(ctx, ["#3a3638", "#332f31", "#423d3f", "#2c292b"]);
    speckle(ctx, ["#1f1c1e", "#4f494b"], 0.14);
  },
  lava(ctx) {
    fill(ctx, ["#ff6a10", "#ff7f1f", "#f2560a", "#ff9530"]);
    for (let i = 0; i < 9; i += 1) {
      const x = Math.floor(ctx.random() * TEXTURE_SIZE);
      const y = Math.floor(ctx.random() * TEXTURE_SIZE);
      for (let k = 0; k < 3; k += 1) {
        ctx.pixel((x + k) % TEXTURE_SIZE, y, "#ffd24a");
      }
    }
    speckle(ctx, ["#b8300a"], 0.06);
  },
  ice(ctx) {
    fill(ctx, ["#a9d4f5", "#b4dbf8", "#9fcbee", "#bfe2fa"]);
    for (const [x, y] of [[2, 3], [3, 4], [4, 5], [9, 9], [10, 10], [11, 11], [12, 12]]) {
      ctx.pixel(x, y, "#e6f5ff");
    }
  },
  packedIce(ctx) {
    fill(ctx, ["#8dbbe6", "#84b2de", "#96c3ec", "#7ea9d6"]);
    speckle(ctx, ["#a9d0f2", "#6f9bc8"], 0.1);
  },
  terracotta(ctx) {
    fill(ctx, ["#b35a33", "#a8522e", "#bb6239"]);
    speckle(ctx, ["#934428"], 0.08);
  },
  redSand(ctx) {
    fill(ctx, ["#c8743c", "#be6c36", "#d17d44", "#b96631"]);
    speckle(ctx, ["#a85c2b", "#dc8b52"], 0.1);
  },
  paleTerracotta(ctx) {
    fill(ctx, ["#d6b08c", "#cfa883", "#dcb894"]);
    speckle(ctx, ["#bf9a76"], 0.08);
  },
  cherryLeaves(ctx) {
    fill(ctx, ["#f2a7c6", "#ee9cbf", "#f6b6d0", "#e88fb6"]);
    speckle(ctx, ["#ffd6e6", "#d97aa3"], 0.14);
  },
  palmLeaves(ctx) {
    fill(ctx, ["#4f9a2e", "#468c28", "#58a535"]);
    for (let y = 0; y < TEXTURE_SIZE; y += 1) {
      ctx.pixel(7, y, "#3a7020");
      ctx.pixel(8, y, "#3a7020");
    }
  },
  palmLog(ctx) {
    fill(ctx, ["#9c7a4f", "#8f6f47", "#a5845a"]);
    for (let y = 0; y < TEXTURE_SIZE; y += 3) {
      for (let x = 0; x < TEXTURE_SIZE; x += 1) {
        ctx.pixel(x, y, "#6e5534");
      }
    }
  },
};

function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paint(name) {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const random = seededRandom(Object.keys(PAINTERS).indexOf(name) * 7919 + 17);
  PAINTERS[name]({
    random,
    pick: (palette) => palette[Math.floor(random() * palette.length)],
    pixel: (x, y, color) => {
      context.fillStyle = color;
      context.fillRect(x, y, 1, 1);
    },
  });
  return canvas;
}

const cache = new Map();

export function blockTexture(name) {
  if (cache.has(name)) {
    return cache.get(name);
  }

  const texture = new THREE.CanvasTexture(paint(name));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  cache.set(name, texture);
  return texture;
}

// All world blocks live in one array texture so terrain, trees and buildings
// can share a single material and stay within the draw-call budget.
let blockArray = null;

export function blockArrayTexture() {
  if (blockArray) {
    return blockArray;
  }
  const layerBytes = TEXTURE_SIZE * TEXTURE_SIZE * 4;
  const data = new Uint8Array(layerBytes * LAYERS.length);
  LAYERS.forEach((name, layer) => {
    const pixels = paint(name).getContext("2d").getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE).data;
    data.set(pixels, layer * layerBytes);
  });
  blockArray = new THREE.DataArrayTexture(data, TEXTURE_SIZE, TEXTURE_SIZE, LAYERS.length);
  blockArray.colorSpace = THREE.SRGBColorSpace;
  blockArray.magFilter = THREE.NearestFilter;
  blockArray.minFilter = THREE.NearestMipmapLinearFilter;
  blockArray.wrapS = THREE.RepeatWrapping;
  blockArray.wrapT = THREE.RepeatWrapping;
  blockArray.generateMipmaps = true;
  blockArray.anisotropy = 8;
  blockArray.needsUpdate = true;
  return blockArray;
}

export function blockBoxGeometry(size) {
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const uv = geometry.attributes.uv;
  const normal = geometry.attributes.normal;
  for (let i = 0; i < uv.count; i += 1) {
    const facesX = Math.abs(normal.getX(i)) > 0.5;
    const facesY = Math.abs(normal.getY(i)) > 0.5;
    const spanU = facesX ? size.z : size.x;
    const spanV = facesY ? size.z : size.y;
    uv.setXY(i, (uv.getX(i) * spanU) / ENTITY_TILE, (uv.getY(i) * spanV) / ENTITY_TILE);
  }
  return geometry;
}

const ENTITY_SURFACES = {
  wool: { roughness: 0.92, metalness: 0 },
  iron: { roughness: 0.42, metalness: 0.35 },
  glass: { roughness: 0.08, metalness: 0 },
  planks: { roughness: 0.8, metalness: 0 },
};

export function voxelMaterial(color) {
  const hsl = new THREE.Color(color).getHSL({}, THREE.SRGBColorSpace);
  const hue = hsl.h * 360;
  let texture = "wool";
  if (hsl.s < 0.15 && hsl.l < 0.85) {
    texture = "iron";
  } else if (hue >= 170 && hue <= 215 && hsl.l > 0.5 && hsl.s > 0.4) {
    texture = "glass";
  } else if (hue >= 18 && hue <= 40 && hsl.s > 0.3 && hsl.l < 0.45) {
    texture = "planks";
  }
  const material = new THREE.MeshStandardMaterial({ color, map: blockTexture(texture), ...ENTITY_SURFACES[texture] });
  return setupWorldMaterial(material, { key: "voxel" });
}
