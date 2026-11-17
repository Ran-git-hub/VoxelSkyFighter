import * as THREE from "three";
import { WAVE_CONFIG } from "../game/constants.js";

const SEGMENTS = 16;
const SEGMENT_GEOMETRY = new THREE.BoxGeometry(2.4, 2.4, 2.4);

export class Ring {
  constructor(position, yaw, color = 0xffd257) {
    this.mesh = new THREE.Group();
    this.mesh.position.copy(position);
    this.mesh.rotation.y = yaw;
    this.normal = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), fog: false });
    for (let i = 0; i < SEGMENTS; i += 1) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      const segment = new THREE.Mesh(SEGMENT_GEOMETRY, this.material);
      // Snap to the block grid so the hoop reads as stacked cubes rather than a smooth circle.
      segment.position.set(
        Math.round((Math.cos(angle) * WAVE_CONFIG.ringRadius) / 2) * 2,
        Math.round((Math.sin(angle) * WAVE_CONFIG.ringRadius) / 2) * 2,
        0
      );
      this.mesh.add(segment);
    }
    this.alive = true;
    this.previousSide = null;
  }

  // True on the frame the point crosses the hoop's plane inside its radius.
  passedBy(point) {
    const offset = point.clone().sub(this.mesh.position);
    const side = offset.dot(this.normal);
    const crossed = this.previousSide !== null && Math.sign(side) !== Math.sign(this.previousSide);
    this.previousSide = side;
    if (!crossed) {
      return false;
    }
    offset.addScaledVector(this.normal, -side);
    return offset.length() < WAVE_CONFIG.ringRadius - 1;
  }
}
