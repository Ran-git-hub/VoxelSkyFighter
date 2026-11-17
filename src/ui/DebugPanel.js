export class DebugPanel {
  constructor(root) {
    this.el = document.createElement("div");
    this.el.className = "debug-panel";
    root.appendChild(this.el);
    this.frames = 0;
    this.elapsed = 0;
    this.fps = 0;
  }

  update(delta, { calls, triangles, quality, resolutionScale, chunks, pending }) {
    this.frames += 1;
    this.elapsed += delta;
    if (this.elapsed < 0.5) {
      return;
    }
    this.fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    this.el.textContent =
      `FPS ${this.fps.toFixed(0)} | Draw calls ${calls} | Triangles ${(triangles / 1000).toFixed(0)}k\n` +
      `${quality} @ ${(resolutionScale * 100).toFixed(0)}% | chunks ${chunks} (+${pending} pending)`;
  }
}
