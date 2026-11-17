import * as THREE from "three";
import { ATMOSPHERE_GLSL, worldUniforms } from "./WorldShading.js";

const skyVertex = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const skyFragment = /* glsl */ `
uniform float uShowDiscs;
uniform float uStars;
uniform float uTime;
uniform float uRainbow;
uniform float uAurora;
uniform float uMoonPhase;
varying vec3 vDirection;
${ATMOSPHERE_GLSL}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// Returns the square's local coordinates in [-1, 1], or a value > 1 outside it.
vec2 squareCoords(vec3 dir, vec3 center, float halfSize) {
  vec3 right = normalize(cross(center, abs(center.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, center);
  if (dot(dir, center) <= 0.0) {
    return vec2(2.0);
  }
  return vec2(dot(dir, right), dot(dir, up)) / halfSize;
}

void main() {
  vec3 dir = normalize(vDirection);
  vec3 color = skyRadiance(dir);

  if (uShowDiscs > 0.5 && dir.y > -0.01) {
    vec2 sun = squareCoords(dir, uSunDir, 0.035);
    if (max(abs(sun.x), abs(sun.y)) < 1.0) {
      vec3 tau = TAU_R + TAU_M;
      color += uSunRadiance * exp(-tau * airMass(uSunDir.y)) * 1.6 * (1.0 - uOvercast);
    }

    vec2 moon = squareCoords(dir, uMoonDir, 0.03);
    if (max(abs(moon.x), abs(moon.y)) < 1.0) {
      vec2 pixel = floor((moon + 1.0) * 4.0);
      float crater = step(0.72, hash13(vec3(pixel, 7.0)));
      vec3 moonColor = vec3(0.85, 0.88, 0.95) * (1.0 - crater * 0.35);
      // Phases move the terminator across the disc one pixel column at a time.
      float column = (pixel.x + 0.5) / 4.0 - 1.0;
      float edge = cos(uMoonPhase * 6.2831853);
      float lit = uMoonPhase < 0.5 ? step(edge, column) : step(column, -edge);
      color = mix(color, moonColor * 1.6, lit * smoothstep(-0.05, 0.08, uMoonDir.y) * (1.0 - smoothstep(-0.05, 0.25, uSunDir.y) * 0.75));
    }

    if (uStars > 0.0) {
      vec3 a = abs(dir);
      vec3 face;
      vec2 uv;
      if (a.x > a.y && a.x > a.z) {
        uv = dir.yz / a.x;
        face = vec3(sign(dir.x), 0.0, 0.0);
      } else if (a.y > a.z) {
        uv = dir.xz / a.y;
        face = vec3(0.0, sign(dir.y), 0.0);
      } else {
        uv = dir.xy / a.z;
        face = vec3(0.0, 0.0, sign(dir.z));
      }
      vec2 cell = floor(uv * 160.0);
      float h = hash13(vec3(cell, dot(face, vec3(1.0, 2.0, 3.0))));
      if (h > 0.9965) {
        float twinkle = 0.7 + 0.3 * sin(uTime * (2.0 + h * 40.0) + h * 100.0);
        color += vec3(0.9, 0.95, 1.0) * (h - 0.9965) / 0.0035 * twinkle * uStars * (1.0 - uOvercast) * smoothstep(0.0, 0.15, dir.y);
      }
    }
  }

  if (uShowDiscs > 0.5 && uRainbow > 0.0 && dir.y > 0.0) {
    // The primary bow sits about 42 degrees out from the point opposite the sun, red on the outside.
    float band = (degrees(acos(clamp(dot(dir, -uSunDir), -1.0, 1.0))) - 39.4) / 3.2;
    if (band > 0.0 && band < 1.0) {
      float stripe = floor(band * 6.0);
      vec3 hue = stripe < 1.0 ? vec3(0.55, 0.3, 0.9) : stripe < 2.0 ? vec3(0.25, 0.45, 1.0) : stripe < 3.0 ? vec3(0.25, 0.85, 0.4)
        : stripe < 4.0 ? vec3(1.0, 0.9, 0.25) : stripe < 5.0 ? vec3(1.0, 0.55, 0.15) : vec3(0.95, 0.2, 0.2);
      float brightness = dot(color, vec3(0.3333)) * 1.1 + 0.05;
      color += hue * brightness * uRainbow * 0.5 * smoothstep(0.0, 0.1, dir.y);
    }
  }

  if (uShowDiscs > 0.5 && uAurora > 0.0 && dir.y > 0.06) {
    // Curtains hang in a flat layer overhead; projecting onto it and flooring gives blocky ribbons.
    vec2 plane = floor(vec2(dir.x, -dir.z) / dir.y * 22.0) / 22.0;
    float ray = 0.55 + 0.45 * hash13(vec3(plane.x * 22.0, floor(uTime * 1.2), 3.0));
    float glow = 0.0;
    float tint = 0.0;
    for (int i = 0; i < 2; i += 1) {
      float offset = float(i) * 1.4;
      float wave = sin(plane.x * 1.2 + uTime * 0.11 + offset * 2.0) * 0.5 + sin(plane.x * 0.45 - uTime * 0.07 + offset) * 0.8;
      float across = plane.y - 1.1 - offset - wave;
      float ribbon = smoothstep(-0.05, 0.0, across) * (1.0 - smoothstep(0.0, 0.9, across));
      glow += ribbon;
      tint += ribbon * smoothstep(0.1, 0.9, across);
    }
    vec3 aurora = mix(vec3(0.1, 0.95, 0.5), vec3(0.6, 0.2, 0.9), clamp(tint / max(glow, 0.001), 0.0, 1.0));
    color += aurora * glow * ray * uAurora * 0.16 * smoothstep(0.06, 0.25, dir.y);
  }

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

export function createSkyMaterial(showDiscs) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...worldUniforms,
      uShowDiscs: { value: showDiscs ? 1 : 0 },
      uStars: { value: 0 },
    },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
}

export function createSkyMesh(radius, showDiscs) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(radius * 2, radius * 2, radius * 2), createSkyMaterial(showDiscs));
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return mesh;
}
