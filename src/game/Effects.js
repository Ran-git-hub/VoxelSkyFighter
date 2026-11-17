import * as THREE from "three";
import { setupWorldMaterial } from "../world/WorldShading.js";

const CAPACITY = 3000;
const LIGHT_POOL = 3;

class ParticlePool {
  constructor(scene, material, capacity) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.capacity = capacity;
    this.count = 0;
    this.position = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity * 2);
    this.colorA = new Float32Array(capacity * 3);
    this.colorB = new Float32Array(capacity * 3);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.ground = new Uint8Array(capacity);
    this.matrix = new THREE.Matrix4();
    this.color = new THREE.Color();
  }

  spawn(p, v, life, sizeStart, sizeEnd, colorA, colorB, gravity = 0, drag = 0, ground = false) {
    if (this.count >= this.capacity) {
      return;
    }
    const i = this.count;
    this.count += 1;
    this.position.set([p.x, p.y, p.z], i * 3);
    this.velocity.set([v.x, v.y, v.z], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i * 2] = sizeStart;
    this.size[i * 2 + 1] = sizeEnd;
    this.colorA.set([colorA.r, colorA.g, colorA.b], i * 3);
    this.colorB.set([colorB.r, colorB.g, colorB.b], i * 3);
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.ground[i] = ground ? 1 : 0;
  }

  // Swap-remove keeps the live particles packed at the front of the buffers.
  remove(i) {
    const last = this.count - 1;
    if (i !== last) {
      this.position.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.velocity.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.colorA.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.colorB.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.size.copyWithin(i * 2, last * 2, last * 2 + 2);
      this.life[i] = this.life[last];
      this.maxLife[i] = this.maxLife[last];
      this.gravity[i] = this.gravity[last];
      this.drag[i] = this.drag[last];
      this.ground[i] = this.ground[last];
    }
    this.count = last;
  }

  update(delta, heightAt) {
    for (let i = this.count - 1; i >= 0; i -= 1) {
      this.life[i] -= delta;
      if (this.life[i] <= 0) {
        this.remove(i);
        continue;
      }
      const o = i * 3;
      const damping = Math.exp(-this.drag[i] * delta);
      this.velocity[o] *= damping;
      this.velocity[o + 1] = this.velocity[o + 1] * damping - this.gravity[i] * delta;
      this.velocity[o + 2] *= damping;
      this.position[o] += this.velocity[o] * delta;
      this.position[o + 1] += this.velocity[o + 1] * delta;
      this.position[o + 2] += this.velocity[o + 2] * delta;
      if (this.ground[i] && heightAt) {
        const floor = heightAt(this.position[o], this.position[o + 2]) + this.size[i * 2] * 0.5;
        if (this.position[o + 1] < floor) {
          this.position[o + 1] = floor;
          this.velocity[o] *= 0.4;
          this.velocity[o + 1] = Math.abs(this.velocity[o + 1]) * 0.25;
          this.velocity[o + 2] *= 0.4;
        }
      }
    }

    for (let i = 0; i < this.count; i += 1) {
      const t = 1 - this.life[i] / this.maxLife[i];
      const size = THREE.MathUtils.lerp(this.size[i * 2], this.size[i * 2 + 1], t);
      this.matrix.makeScale(size, size, size).setPosition(this.position[i * 3], this.position[i * 3 + 1], this.position[i * 3 + 2]);
      this.mesh.setMatrixAt(i, this.matrix);
      this.color.setRGB(
        THREE.MathUtils.lerp(this.colorA[i * 3], this.colorB[i * 3], t),
        THREE.MathUtils.lerp(this.colorA[i * 3 + 1], this.colorB[i * 3 + 1], t),
        THREE.MathUtils.lerp(this.colorA[i * 3 + 2], this.colorB[i * 3 + 2], t)
      );
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, this.count * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.clearUpdateRanges();
      this.mesh.instanceColor.addUpdateRange(0, this.count * 3);
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    this.count = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
}

const v = new THREE.Vector3();
const p = new THREE.Vector3();
const c1 = new THREE.Color();
const c2 = new THREE.Color();

// All particles are axis-aligned cubes in two instanced pools (glowing and
// lit), so a big explosion costs the same two draw calls as a single spark.
export class Effects {
  constructor(scene, heightAt) {
    this.heightAt = heightAt;
    this.glow = new ParticlePool(scene, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), CAPACITY);
    this.solid = new ParticlePool(
      scene,
      setupWorldMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 }), { key: "particles" }),
      CAPACITY
    );
    // A fixed pool of point lights: adding or removing lights would force every
    // material to recompile.
    this.lights = Array.from({ length: LIGHT_POOL }, () => {
      const light = new THREE.PointLight(0xffaa55, 0, 60, 2);
      light.userData.life = 0;
      light.userData.maxLife = 1;
      light.userData.peak = 0;
      scene.add(light);
      return light;
    });
    this.nextLight = 0;
  }

  flash(position, color, peak, life) {
    const light = this.lights[this.nextLight];
    this.nextLight = (this.nextLight + 1) % this.lights.length;
    light.position.copy(position);
    light.color.set(color);
    light.userData.life = life;
    light.userData.maxLife = life;
    light.userData.peak = peak;
    light.intensity = peak;
  }

  explosion(position, color, large = false) {
    const scale = large ? 1.8 : 1;
    const base = new THREE.Color(color);
    this.flash(position, 0xffa24a, 9000 * scale, 0.35 * scale);
    // Shockwave: a flat ring racing outward ahead of the fireball.
    const ringCount = Math.round(28 * scale);
    for (let i = 0; i < ringCount; i += 1) {
      const angle = (i / ringCount) * Math.PI * 2;
      v.set(Math.cos(angle), THREE.MathUtils.randFloatSpread(0.08), Math.sin(angle)).multiplyScalar(46 * scale);
      c1.setRGB(6, 5, 3.5);
      c2.setRGB(1.5, 0.6, 0.15);
      this.glow.spawn(position, v, 0.32, 0.9 * scale, 0.15, c1, c2, 0, 3.5);
    }
    // A white-hot core that lingers a moment after the sparks have gone.
    for (let i = 0; i < 6 * scale; i += 1) {
      v.set(THREE.MathUtils.randFloatSpread(5), THREE.MathUtils.randFloat(1, 5), THREE.MathUtils.randFloatSpread(5));
      c1.setRGB(10, 8, 5);
      c2.setRGB(2.5, 0.7, 0.1);
      this.glow.spawn(position, v, THREE.MathUtils.randFloat(0.5, 0.9) * scale, 3.2 * scale, 0.6, c1, c2, -2, 1.5);
    }
    // Wreckage in the target's own colour, tumbling down and bouncing off the ground.
    for (let i = 0; i < 12 * scale; i += 1) {
      v.set(THREE.MathUtils.randFloatSpread(34), THREE.MathUtils.randFloat(4, 26), THREE.MathUtils.randFloatSpread(34));
      c1.copy(base).multiplyScalar(THREE.MathUtils.randFloat(0.5, 0.9));
      c2.copy(c1).multiplyScalar(0.4);
      this.solid.spawn(position, v, THREE.MathUtils.randFloat(2.5, 4.5), THREE.MathUtils.randFloat(0.9, 1.8) * scale, 0.7, c1, c2, 30, 0.15, true);
    }
    for (let i = 0; i < 26 * scale; i += 1) {
      v.set(THREE.MathUtils.randFloatSpread(1), THREE.MathUtils.randFloatSpread(1), THREE.MathUtils.randFloatSpread(1)).normalize();
      v.multiplyScalar(THREE.MathUtils.randFloat(6, 22) * scale);
      c1.copy(base).multiplyScalar(5);
      c2.setRGB(1.2, 0.25, 0.05);
      this.glow.spawn(position, v, THREE.MathUtils.randFloat(0.25, 0.6), 1.6 * scale, 0.2, c1, c2, 2, 2.5);
    }
    for (let i = 0; i < 30 * scale; i += 1) {
      v.set(THREE.MathUtils.randFloatSpread(30), THREE.MathUtils.randFloat(4, 34), THREE.MathUtils.randFloatSpread(30)).multiplyScalar(scale);
      c1.setRGB(8, 4.5, 1.2);
      c2.setRGB(2, 0.4, 0.05);
      this.glow.spawn(position, v, THREE.MathUtils.randFloat(0.5, 1.2), 0.35, 0.15, c1, c2, 22, 0.6);
    }
    for (let i = 0; i < 18 * scale; i += 1) {
      p.copy(position).add(v.set(THREE.MathUtils.randFloatSpread(3), THREE.MathUtils.randFloatSpread(3), THREE.MathUtils.randFloatSpread(3)));
      v.set(THREE.MathUtils.randFloatSpread(6), THREE.MathUtils.randFloat(2, 7), THREE.MathUtils.randFloatSpread(6));
      const shade = THREE.MathUtils.randFloat(0.12, 0.3);
      c1.setRGB(shade * 1.6, shade * 1.2, shade);
      c2.setRGB(shade * 0.6, shade * 0.6, shade * 0.62);
      this.solid.spawn(p, v, THREE.MathUtils.randFloat(1.4, 2.6) * scale, 1.5 * scale, 4.5 * scale, c1, c2, -1.5, 1.2);
    }
    for (let i = 0; i < 10 * scale; i += 1) {
      v.set(THREE.MathUtils.randFloatSpread(26), THREE.MathUtils.randFloat(6, 20), THREE.MathUtils.randFloatSpread(26));
      c1.copy(base).multiplyScalar(0.35);
      c2.setRGB(0.05, 0.05, 0.05);
      this.solid.spawn(position, v, THREE.MathUtils.randFloat(2.5, 4), THREE.MathUtils.randFloat(0.6, 1.3), 0.5, c1, c2, 26, 0.2, true);
    }
  }

  muzzleFlash(position, direction) {
    this.flash(position, 0xffd27a, 1200, 0.06);
    for (let i = 0; i < 3; i += 1) {
      v.copy(direction).multiplyScalar(THREE.MathUtils.randFloat(8, 20)).add(p.set(THREE.MathUtils.randFloatSpread(3), THREE.MathUtils.randFloatSpread(3), THREE.MathUtils.randFloatSpread(3)));
      c1.setRGB(9, 6, 2);
      c2.setRGB(2, 0.6, 0.1);
      this.glow.spawn(position, v, 0.07, 0.7, 0.2, c1, c2);
    }
  }

  trail(position, color, life) {
    c1.set(color).multiplyScalar(2.4);
    c2.set(color).multiplyScalar(0.6);
    this.glow.spawn(position, v.set(0, 0, 0), life, 0.9, 0.27, c1, c2);
  }

  vapor(position, velocity) {
    c1.setRGB(1.6, 1.65, 1.7);
    c2.setRGB(0.9, 0.92, 0.95);
    this.solid.spawn(position, v.copy(velocity).multiplyScalar(0.05), 0.9, 0.38, 0.06, c1, c2);
  }

  // Blue-white at the nozzle cooling to orange, thrown backwards off the engine.
  afterburner(position, velocity, backward) {
    for (let i = 0; i < 2; i += 1) {
      v.copy(velocity).multiplyScalar(0.55).addScaledVector(backward, THREE.MathUtils.randFloat(14, 30));
      v.add(p.set(THREE.MathUtils.randFloatSpread(2), THREE.MathUtils.randFloatSpread(2), THREE.MathUtils.randFloatSpread(2)));
      c1.setRGB(4, 7, 12);
      c2.setRGB(8, 2.4, 0.3);
      this.glow.spawn(position, v, THREE.MathUtils.randFloat(0.12, 0.22), 0.75, 0.12, c1, c2, 0, 2);
    }
  }

  // White water thrown up and outward, falling back under gravity.
  spray(position, velocity, amount) {
    for (let i = 0; i < amount; i += 1) {
      v.copy(velocity).multiplyScalar(0.25);
      v.x += THREE.MathUtils.randFloatSpread(16);
      v.z += THREE.MathUtils.randFloatSpread(16);
      v.y = THREE.MathUtils.randFloat(5, 14);
      c1.setRGB(1.5, 1.6, 1.7);
      c2.setRGB(0.7, 0.85, 0.95);
      this.solid.spawn(position, v, THREE.MathUtils.randFloat(0.5, 1), 0.7, 0.2, c1, c2, 24, 0.6);
    }
  }

  // A tall column for anything that hits the sea, with a ring of foam round its foot.
  splash(position) {
    for (let i = 0; i < 70; i += 1) {
      const up = i < 40;
      v.set(THREE.MathUtils.randFloatSpread(up ? 7 : 30), THREE.MathUtils.randFloat(up ? 18 : 3, up ? 46 : 12), THREE.MathUtils.randFloatSpread(up ? 7 : 30));
      c1.setRGB(1.6, 1.7, 1.8);
      c2.setRGB(0.6, 0.8, 0.95);
      this.solid.spawn(position, v, THREE.MathUtils.randFloat(1.2, 2.6), THREE.MathUtils.randFloat(1, 2.2), 0.4, c1, c2, 30, 0.5);
    }
  }

  dust(position, velocity, tyre = false) {
    v.copy(velocity).multiplyScalar(0.15);
    v.x += THREE.MathUtils.randFloatSpread(3);
    v.y = THREE.MathUtils.randFloat(0.5, 2.5);
    v.z += THREE.MathUtils.randFloatSpread(3);
    const shade = tyre ? 0.75 : 0.5;
    c1.setRGB(shade, shade * 0.95, shade * 0.85);
    c2.setRGB(shade * 0.8, shade * 0.78, shade * 0.72);
    this.solid.spawn(position, v, tyre ? 1.4 : 0.9, 0.5, tyre ? 3 : 1.8, c1, c2, -0.5, 1.5);
  }

  wake(x, y, z) {
    for (let i = 0; i < 3; i += 1) {
      p.set(x + THREE.MathUtils.randFloatSpread(3), y, z + THREE.MathUtils.randFloatSpread(3));
      c1.setRGB(1.4, 1.5, 1.6);
      c2.setRGB(0.5, 0.7, 0.85);
      this.solid.spawn(p, v.set(THREE.MathUtils.randFloatSpread(1.5), 0.4, THREE.MathUtils.randFloatSpread(1.5)), 1.6, 0.9, 0.2, c1, c2, 1);
    }
  }

  // A slow grey plume that widens and leans with the wind as it climbs.
  chimney(position, wind) {
    v.set(wind.x * 0.9 + THREE.MathUtils.randFloatSpread(0.6), THREE.MathUtils.randFloat(2.2, 3.4), wind.y * 0.9 + THREE.MathUtils.randFloatSpread(0.6));
    const shade = THREE.MathUtils.randFloat(0.28, 0.4);
    c1.setRGB(shade, shade, shade);
    c2.setRGB(shade * 1.25, shade * 1.25, shade * 1.3);
    this.solid.spawn(position, v, THREE.MathUtils.randFloat(3.2, 4.4), 0.8, 3.4, c1, c2, 0, 0.25);
  }

  raindrop(position) {
    c1.setRGB(1.1, 1.2, 1.35);
    c2.setRGB(0.6, 0.7, 0.85);
    this.solid.spawn(position, v.set(THREE.MathUtils.randFloatSpread(2), THREE.MathUtils.randFloat(2, 4), THREE.MathUtils.randFloatSpread(2)), 0.18, 0.35, 0.1, c1, c2, 20);
  }

  smoke(position, heavy) {
    const shade = heavy ? 0.08 : 0.35;
    v.set(THREE.MathUtils.randFloatSpread(1.5), THREE.MathUtils.randFloat(1, 3), THREE.MathUtils.randFloatSpread(1.5));
    c1.setRGB(shade, shade, shade);
    c2.setRGB(shade * 0.7, shade * 0.7, shade * 0.72);
    this.solid.spawn(position, v, heavy ? 1.6 : 1.1, 0.7, heavy ? 3 : 2, c1, c2, -1, 0.8);
    if (heavy && Math.random() < 0.35) {
      c1.setRGB(6, 2.2, 0.4);
      c2.setRGB(1.2, 0.2, 0);
      this.glow.spawn(position, v.multiplyScalar(0.5), 0.25, 0.7, 0.1, c1, c2);
    }
  }

  update(delta) {
    this.glow.update(delta, null);
    this.solid.update(delta, this.heightAt);
    for (const light of this.lights) {
      if (light.userData.life <= 0) {
        light.intensity = 0;
        continue;
      }
      light.userData.life -= delta;
      const ratio = Math.max(0, light.userData.life / light.userData.maxLife);
      light.intensity = light.userData.peak * ratio * ratio;
    }
  }

  clear() {
    this.glow.clear();
    this.solid.clear();
    for (const light of this.lights) {
      light.userData.life = 0;
      light.intensity = 0;
    }
  }
}
