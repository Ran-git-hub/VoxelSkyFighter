import { buildChunk } from "./ChunkMesher.js";

self.onmessage = (event) => {
  const request = event.data;
  const result = buildChunk(request);
  const transfer = [];
  for (const part of [result.terrain, result.water]) {
    if (part) {
      transfer.push(part.positions.buffer, part.normals.buffer, part.uvs.buffer, part.layers.buffer, part.ao.buffer, part.indices.buffer);
    }
  }
  for (const key of ["trees", "plants", "heights"]) {
    if (result[key]) {
      transfer.push(result[key].buffer);
    }
  }
  self.postMessage({ key: request.key, result }, transfer);
};
