import { GAME_STATES, PLAYER_CONFIG } from "../game/constants.js";

const HEART_PIXELS = [
  ".oo...oo.",
  "offo.offo",
  "ofhfofffo",
  "offfffffo",
  ".offfffo.",
  "..offfo..",
  "...ofo...",
  "....o....",
];

function heartMarkup() {
  const rects = [];
  HEART_PIXELS.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell !== ".") {
        rects.push(`<rect class="${cell}" x="${x}" y="${y}" width="1" height="1"/>`);
      }
    });
  });
  return `<svg class="heart" viewBox="0 0 9 8" shape-rendering="crispEdges">${rects.join("")}</svg>`;
}

const POOL_CONTACTS = 24;
const POOL_ARROWS = 6;

export class Hud {
  constructor(root, { settings, onSettingChange, onResume } = {}) {
    this.root = root;
    this.root.innerHTML = `
      <div class="hud">
        <div class="debug-lines controls-panel collapsed" id="controls-panel">
          <div class="line heading">Controls <span class="key-hint">[H]</span></div>
          <div class="controls-body">
            <div class="line"><strong>Mouse</strong> Steer</div>
            <div class="line"><strong>W/S</strong> Pitch <strong>A/D</strong> Turn <strong>Q/E</strong> Rudder</div>
            <div class="line"><strong>Left Click / Space</strong> Guns</div>
            <div class="line"><strong>Right Click / F</strong> Missile (needs lock)</div>
            <div class="line"><strong>Shift</strong> Throttle / Afterburner</div>
            <div class="line"><strong>B</strong> Air Brake</div>
            <div class="line"><strong>Z / C</strong> Barrel Roll <strong>X</strong> Loop</div>
            <div class="line"><strong>P</strong> Autoland On/Off</div>
            <div class="line"><strong>Esc</strong> Pause <strong>Hold R</strong> Restart</div>
          </div>
        </div>
        <div class="debug-lines stats-panel" id="stats-panel">
          <div class="line">Wave: <strong id="stat-wave">-</strong></div>
          <div class="line">Score: <strong id="stat-score">0</strong> <span class="dim">Best <span id="stat-best">0</span></span></div>
          <div class="line">Speed: <strong id="stat-speed">0</strong> Alt: <strong id="stat-altitude">0</strong></div>
          <div class="line">Missiles: <strong id="stat-missiles"></strong></div>
          <div class="line meter-line">Boost <span class="meter"><span class="meter-fill" id="boost-fill"></span></span></div>
          <div class="line"><strong id="stat-state">READY</strong> <span id="stat-takeoff"></span></div>
        </div>
        <div class="settings-panel" id="settings-panel">
          <div class="settings-title">Settings</div>
          <label class="sr-only" for="plane-style">Plane Style</label>
          <select id="plane-style" class="mc-button" data-setting="plane">
            <option value="standard">Plane: Standard</option>
            <option value="mario">Plane: Super Mario</option>
            <option value="f16">Plane: F-16 Style</option>
            <option value="airshow">Plane: Air Show</option>
            <option value="brickstorm">Plane: Brick Storm</option>
            <option value="brickbiplane">Plane: Brick Biplane</option>
            <option value="brickairliner">Plane: Brick Airliner</option>
            <option value="brickseaplane">Plane: Brick Seaplane</option>
            <option value="brickjet">Plane: Brick Jet</option>
          </select>
          <label class="sr-only" for="time-of-day">Time of Day</label>
          <select id="time-of-day" class="mc-button" data-setting="time">
            <option value="dawn">Time: Dawn</option>
            <option value="noon">Time: Noon</option>
            <option value="sunset">Time: Sunset</option>
            <option value="night">Time: Night</option>
            <option value="cycle">Time: Day Cycle</option>
          </select>
          <label class="sr-only" for="weather">Weather</label>
          <select id="weather" class="mc-button" data-setting="weather">
            <option value="auto">Weather: Auto</option>
            <option value="clear">Weather: Clear</option>
            <option value="cloudy">Weather: Cloudy</option>
            <option value="rain">Weather: Rain</option>
            <option value="storm">Weather: Storm</option>
            <option value="fog">Weather: Fog</option>
          </select>
          <label class="sr-only" for="graphics-quality">Graphics</label>
          <select id="graphics-quality" class="mc-button" data-setting="quality">
            <option value="low">Graphics: Low</option>
            <option value="medium">Graphics: Medium</option>
            <option value="high">Graphics: High</option>
            <option value="ultra">Graphics: Ultra</option>
          </select>
          <button id="invert-y" class="mc-button" type="button"></button>
          <button id="speed-fx" class="mc-button" type="button"></button>
          <div class="mc-slider">
            <label class="sr-only" for="mouse-sensitivity">Mouse Sensitivity</label>
            <input id="mouse-sensitivity" type="range" min="0.3" max="2.5" step="0.1" />
            <span class="mc-slider-label">Sensitivity: <span id="mouse-sensitivity-value"></span></span>
          </div>
        </div>
        <div class="map-panel">
          <div class="map-title">Radar</div>
          <div class="map-scope" id="radar-scope">
            <div class="radar-contacts" id="radar-contacts"></div>
            <div class="radar-home" id="radar-home"></div>
            <div class="radar-player" id="radar-player"></div>
          </div>
        </div>
        <div class="status-bar">
          <div class="hearts" id="hearts">${heartMarkup().repeat(PLAYER_CONFIG.maxHealth)}</div>
          <div class="xp">
            <div class="xp-level hidden" id="combo-value"></div>
            <div class="xp-bar"><div class="xp-fill" id="combo-fill"></div></div>
          </div>
        </div>
        <div class="toasts" id="toasts"></div>
        <div class="banner hidden" id="banner"></div>
        <div class="warning hidden" id="warning"></div>
        <div class="markers" id="markers">
          <div class="lock-box hidden" id="lock-box"></div>
          <div class="lead-pip hidden" id="lead-pip"></div>
        </div>
        <div class="reticle"><div class="hit-marker" id="hit-marker"></div></div>
        <div class="stick-dot" id="stick-dot"></div>
        <div class="damage-flash" id="damage-flash"></div>
        <div class="overlay" id="overlay"></div>
      </div>
    `;

    const find = (selector) => this.root.querySelector(selector);
    this.stateEl = find("#stat-state");
    this.speedEl = find("#stat-speed");
    this.altitudeEl = find("#stat-altitude");
    this.scoreEl = find("#stat-score");
    this.bestEl = find("#stat-best");
    this.waveEl = find("#stat-wave");
    this.missilesEl = find("#stat-missiles");
    this.boostFillEl = find("#boost-fill");
    this.takeoffEl = find("#stat-takeoff");
    this.heartEls = [...this.root.querySelectorAll(".heart")];
    this.overlayEl = find("#overlay");
    this.toastsEl = find("#toasts");
    this.bannerEl = find("#banner");
    this.warningEl = find("#warning");
    this.comboValueEl = find("#combo-value");
    this.comboFillEl = find("#combo-fill");
    this.controlsEl = find("#controls-panel");
    this.settingsEl = find("#settings-panel");
    this.lockBoxEl = find("#lock-box");
    this.leadPipEl = find("#lead-pip");
    this.hitMarkerEl = find("#hit-marker");
    this.stickDotEl = find("#stick-dot");
    this.damageEl = find("#damage-flash");
    this.radarHomeEl = find("#radar-home");

    // Fixed pools: rebuilding these nodes every frame thrashes layout.
    const pool = (parent, count, className) =>
      Array.from({ length: count }, () => {
        const node = document.createElement("div");
        node.className = `${className} hidden`;
        parent.appendChild(node);
        return node;
      });
    this.contactEls = pool(find("#radar-contacts"), POOL_CONTACTS, "radar-contact");
    this.arrowEls = pool(find("#markers"), POOL_ARROWS, "edge-arrow");

    for (const select of this.root.querySelectorAll("select[data-setting]")) {
      select.value = settings[select.dataset.setting];
      select.addEventListener("change", () => {
        onSettingChange?.(select.dataset.setting, select.value);
        // A focused select would swallow flight keys as type-ahead.
        select.blur();
      });
    }
    const toggle = (selector, key, label) => {
      const button = find(selector);
      const render = (value) => {
        button.textContent = `${label}: ${value ? "On" : "Off"}`;
        button.dataset.value = value ? "1" : "";
      };
      render(settings[key]);
      button.addEventListener("click", () => {
        const value = !button.dataset.value;
        render(value);
        onSettingChange?.(key, value);
        button.blur();
      });
    };
    toggle("#invert-y", "invertY", "Invert Y");
    toggle("#speed-fx", "speedFx", "Speed FX");
    const slider = find("#mouse-sensitivity");
    const sliderValue = find("#mouse-sensitivity-value");
    slider.value = settings.sensitivity;
    sliderValue.textContent = `${Number(settings.sensitivity).toFixed(2)}x`;
    slider.addEventListener("input", () => {
      const value = Number(slider.value);
      sliderValue.textContent = `${value.toFixed(2)}x`;
      onSettingChange?.("sensitivity", value);
    });
    slider.addEventListener("change", () => slider.blur());

    this.overlayEl.addEventListener("click", () => onResume?.());
    this.bannerTimer = null;
    this.lastMissiles = null;
  }

  toggleHelp() {
    this.controlsEl.classList.toggle("collapsed");
  }

  showToast(label, points, combo) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<span class="toast-label">${label}</span><span class="toast-points">+${points}${
      combo > 1 ? ` (x${combo})` : ""
    }</span>`;
    // animationend never fires while the tab is backgrounded, so time it out too.
    toast.addEventListener("animationend", () => toast.remove());
    setTimeout(() => toast.remove(), 2500);
    this.toastsEl.appendChild(toast);
  }

  clearToasts() {
    this.toastsEl.innerHTML = "";
    this.bannerEl.classList.add("hidden");
  }

  showBanner(title, subtitle = "") {
    this.bannerEl.innerHTML = `<div class="banner-title">${title}</div><div class="banner-sub">${subtitle}</div>`;
    this.bannerEl.classList.remove("hidden");
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.bannerEl.classList.add("hidden"), 2600);
  }

  hitMarker() {
    this.hitMarkerEl.classList.remove("show");
    void this.hitMarkerEl.offsetWidth;
    this.hitMarkerEl.classList.add("show");
  }

  damageFlash() {
    this.damageEl.classList.remove("show");
    void this.damageEl.offsetWidth;
    this.damageEl.classList.add("show");
  }

  update({
    stateLabel,
    hint,
    speed,
    altitude,
    health,
    score,
    best,
    wave,
    missiles,
    boost,
    combo = 0,
    comboRatio = 0,
    radarContacts = [],
    radarHome,
    stick,
    showStick,
    lock,
    lead,
    arrows = [],
    warning,
  }) {
    this.stateEl.textContent = stateLabel;
    this.takeoffEl.textContent = hint;
    this.speedEl.textContent = Math.round(speed).toString();
    this.altitudeEl.textContent = Math.round(altitude).toString();
    this.scoreEl.textContent = score.toString();
    this.bestEl.textContent = best.toString();
    this.waveEl.textContent = wave;
    if (missiles !== this.lastMissiles) {
      this.lastMissiles = missiles;
      this.missilesEl.textContent = "▮".repeat(missiles) + "▯".repeat(Math.max(0, PLAYER_CONFIG.maxMissiles - missiles));
    }
    this.boostFillEl.style.width = `${boost * 100}%`;
    this.heartEls.forEach((heart, index) => heart.classList.toggle("empty", index >= health));

    this.comboValueEl.classList.toggle("hidden", combo === 0);
    this.comboValueEl.textContent = `x${combo}`;
    this.comboFillEl.style.width = `${Math.max(0, Math.min(1, comboRatio)) * 100}%`;

    this.contactEls.forEach((node, index) => {
      const contact = radarContacts[index];
      node.classList.toggle("hidden", !contact);
      if (contact) {
        node.style.left = `${contact.x}%`;
        node.style.top = `${contact.y}%`;
        node.style.opacity = contact.strength;
        node.dataset.kind = contact.kind;
      }
    });
    this.radarHomeEl.style.left = `${radarHome.x}%`;
    this.radarHomeEl.style.top = `${radarHome.y}%`;

    this.stickDotEl.classList.toggle("hidden", !showStick);
    this.stickDotEl.style.left = `${stick.x}%`;
    this.stickDotEl.style.top = `${stick.y}%`;

    this.lockBoxEl.classList.toggle("hidden", !lock);
    if (lock) {
      this.lockBoxEl.style.left = `${lock.x}%`;
      this.lockBoxEl.style.top = `${lock.y}%`;
      this.lockBoxEl.classList.toggle("locked", lock.locked);
      this.lockBoxEl.style.setProperty("--lock", lock.progress);
    }
    this.leadPipEl.classList.toggle("hidden", !lead);
    if (lead) {
      this.leadPipEl.style.left = `${lead.x}%`;
      this.leadPipEl.style.top = `${lead.y}%`;
    }
    this.arrowEls.forEach((node, index) => {
      const arrow = arrows[index];
      node.classList.toggle("hidden", !arrow);
      if (arrow) {
        node.style.left = `${arrow.x}%`;
        node.style.top = `${arrow.y}%`;
        node.style.transform = `translate(-50%, -50%) rotate(${arrow.angle}rad)`;
      }
    });

    this.warningEl.classList.toggle("hidden", !warning);
    if (warning) {
      this.warningEl.textContent = warning;
    }
  }

  setOverlay(state, { score = 0, best = 0, wave = 0, paused = false } = {}) {
    this.settingsEl.classList.toggle("hidden", !(paused || state === GAME_STATES.START || state === GAME_STATES.GAME_OVER));
    if (state === GAME_STATES.START) {
      this.overlayEl.className = "overlay overlay-title";
      this.overlayEl.innerHTML = `
        <div class="title-screen">
          <div class="logo">VOXEL SKY FIGHTER<span class="splash">Now with missiles!</span></div>
          <p>Hold <strong>Shift</strong> to accelerate down the runway, then pull up with <strong>W</strong>.</p>
          <p><strong>Mouse</strong> steers, <strong>Left Click / Space</strong> fires guns, <strong>Right Click / F</strong> launches a locked missile.</p>
          <p>Clear each wave, fly through gold rings, and land on the runway to repair and rearm.</p>
          <p class="hint">Best score: <strong>${best}</strong> &middot; press <strong>H</strong> in flight for the full controls.</p>
          <div class="press-key">Press <strong>Enter</strong> or click to start</div>
        </div>
      `;
      return;
    }

    if (state === GAME_STATES.GAME_OVER) {
      this.overlayEl.className = "overlay overlay-dead";
      this.overlayEl.innerHTML = `
        <div class="death-screen">
          <h2>You Died!</h2>
          <p>Score: <strong>${score}</strong> &middot; Wave <strong>${wave}</strong></p>
          <p>${score >= best && score > 0 ? "New best score!" : `Best: <strong>${best}</strong>`}</p>
          <div class="press-key">Press <strong>R</strong> to respawn</div>
        </div>
      `;
      return;
    }

    if (paused) {
      this.overlayEl.className = "overlay overlay-paused";
      this.overlayEl.innerHTML = `
        <div class="title-screen">
          <div class="logo">PAUSED</div>
          <p>Settings are in the top right corner.</p>
          <div class="press-key">Click or press <strong>Esc</strong> to resume</div>
        </div>
      `;
      return;
    }

    this.overlayEl.className = "overlay hidden";
  }
}
