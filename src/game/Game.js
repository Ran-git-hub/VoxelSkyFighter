import * as THREE from "three";
import { Input } from "./Input.js";
import { AudioManager } from "./AudioManager.js";
import { Graphics } from "./Graphics.js";
import {
  ENEMY_CONFIG,
  GAME_STATES,
  MISSILE_CONFIG,
  PLAYER_CONFIG,
  PROJECTILE_CONFIG,
  STUNT_CONFIG,
  WAVE_CONFIG,
} from "./constants.js";
import { PlayerPlane } from "../entities/PlayerPlane.js";
import { EnemyPlane } from "../entities/EnemyPlane.js";
import { Missile, Projectile } from "../entities/Projectile.js";
import { Ring } from "../entities/Ring.js";
import { VoxelWorld } from "../world/VoxelWorld.js";
import { Atmosphere } from "../world/Atmosphere.js";
import { installShaderPatches } from "../world/WorldShading.js";
import { Effects } from "./Effects.js";
import { Life } from "../world/Life.js";
import { Hud } from "../ui/Hud.js";
import { DebugPanel } from "../ui/DebugPanel.js";
import { Leaderboard } from "./Leaderboard.js";
import { CLIMATE, WORLD_SEED } from "../world/TerrainGen.js";
import { runSelfTest } from "./SelfTest.js";

const TRICK_LABELS = {
  roll: "BARREL ROLL!",
  loop: "LOOP!",
  nearMiss: "NEAR MISS!",
  ring: "RING!",
};

const STORAGE_PREFIX = "vsf.";
const DEFAULT_SETTINGS = {
  plane: "standard",
  time: "noon",
  weather: "auto",
  quality: "high",
  sensitivity: 1,
  invertY: false,
  speedFx: true,
  godRays: true,
  reflections: true,
  weatherFx: true,
  life: true,
  music: true,
  musicVolume: 1,
  sfx: true,
  sfxVolume: 1,
};
const PLAYING_STATES = new Set([GAME_STATES.TAXI, GAME_STATES.TAKEOFF, GAME_STATES.FLYING, GAME_STATES.LANDING]);
const RADAR_RANGE = 420;
const RESTART_HOLD = 0.9;
const TRACK_CONE = 0.5;
const PHOTO_LOOK = 0.0025;
const PHOTO_SPEED = 30;

function loadStored(key, fallback) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Private browsing can refuse storage; the game still works without persistence.
  }
}

export class Game {
  constructor({ canvas, hudRoot }) {
    installShaderPatches();
    this.canvas = canvas;
    this.debug = new URLSearchParams(window.location.search).has("debug");
    // The composer renders into its own targets, so default-framebuffer MSAA would be wasted.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.5, 2200);
    this.clock = new THREE.Clock();
    // Automated runs cannot take pointer lock, so debug mode flies without it.
    this.input = new Input(canvas, { requireLock: !this.debug });
    this.input.onLockChange = (locked) => this.setPaused(!locked && this.input.requireLock && PLAYING_STATES.has(this.state));
    this.audio = new AudioManager();
    this.settings = { ...DEFAULT_SETTINGS, ...loadStored("settings", {}) };
    this.best = loadStored("best", 0);
    this.hud = new Hud(hudRoot, {
      settings: this.settings,
      onSettingChange: (key, value) => {
        this.settings[key] = value;
        store("settings", this.settings);
        this.applySetting(key);
        this.audio.playClick();
      },
      onResume: () => this.handleConfirm(),
      onAction: (action, value) => this.handleMenuAction(action, value),
    });
    this.player = new PlayerPlane();
    this.projectiles = [];
    this.missiles = [];
    this.enemies = [];
    this.rings = [];
    this.state = GAME_STATES.START;
    this.mode = "combat";
    this.photo = null;
    this.respawns = 0;
    this.submitResult = null;
    this.leaderboard = new Leaderboard();
    this.leaderboard.onChange = () => {
      if (this.state === GAME_STATES.START || (this.state === GAME_STATES.GAME_OVER && this.deathTimer <= 0)) {
        this.hud.updateBoard(this.boardState());
      }
    };
    this.paused = false;
    this.cameraYaw = 0;
    this.cameraPitch = 0;
    this.cameraBoost = 0;
    this.shake = 0;
    this.resetRun();

    this.world = new VoxelWorld(this.scene);
    this.scene.add(this.player.mesh);
    this.effects = new Effects(this.scene, (x, z) => this.groundAt(x, z));
    this.life = new Life(this.scene, this.world);

    this.atmosphere = new Atmosphere(this.scene, this.renderer, this.camera);
    this.graphics = new Graphics(this.renderer, this.scene, this.camera);
    this.graphics.onAoPass = (active, box) => this.world.cullForAo(active, box);
    this.graphics.waterLevel = this.world.seaLevel;
    this.graphics.waterInView = (frustum) => this.world.waterInView(frustum);
    this.graphics.onReflectionPass = (position) => this.atmosphere.sky.position.copy(position);
    this.atmosphere.weather.heightAt = (x, z) => this.groundAt(x, z);
    this.atmosphere.weather.onThunder = (distance) => this.audio.playThunder(distance);
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      this.applySetting(key);
    }
    this.resize(window.innerWidth, window.innerHeight);

    if (this.debug) {
      window.__game = this;
      this.selfTest = () => runSelfTest(this);
      if (new URLSearchParams(window.location.search).has("selftest")) {
        setTimeout(() => this.hud.showBanner("SELF TEST", this.selfTest().passed ? "all passed" : "FAILED - see console"), 1500);
      }
      this.debugPanel = new DebugPanel(hudRoot);
    }

    this.onResize = () => this.resize(window.innerWidth, window.innerHeight);
  }

  resetRun() {
    this.trailTimer = 0;
    this.vaporTimer = 0;
    this.smokeTimer = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.score = 0;
    this.wave = 0;
    this.waveQueue = [];
    this.waveActive = false;
    this.waveTimer = 3;
    this.enemySpawnTimer = 0;
    this.lockTarget = null;
    this.lockProgress = 0;
    this.lockTickTimer = 0;
    this.missileLatch = false;
    this.restartHold = 0;
    this.deathTimer = 0;
    this.warningTimer = 0;
    this.sortieTime = 0;
  }

  applySetting(key) {
    const value = this.settings[key];
    if (key === "plane") {
      this.player.setSkin(value);
    } else if (key === "time") {
      this.atmosphere.setPreset(value);
    } else if (key === "weather") {
      this.atmosphere.weather.setPreset(value);
    } else if (key === "quality") {
      this.applyQuality(value);
    } else if (key === "sensitivity") {
      this.input.setMouseSensitivity(value);
    } else if (key === "invertY") {
      this.input.invertY = value;
    } else if (key === "godRays" || key === "reflections") {
      this.graphics.setToggle(key, value);
    } else if (key === "weatherFx") {
      this.atmosphere.weather.fx = value;
    } else if (key === "life") {
      this.life.setEnabled(value);
    } else if (["music", "musicVolume", "sfx", "sfxVolume"].includes(key)) {
      this.audio.setLevels(this.settings);
    }
  }

  resize(width, height) {
    this.viewWidth = width;
    this.viewHeight = height;
    // A hidden or minimised window reports zero size; sizing render targets to it floods the console with GL errors.
    if (width < 2 || height < 2) {
      return;
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.graphics.setSize(width, height);
    this.atmosphere.refreshCascades();
  }

  applyQuality(name) {
    const quality = this.graphics.setQuality(name);
    this.atmosphere.setShadowMapSize(quality.shadowMapSize);
    this.atmosphere.setViewDistance(quality.viewDistance);
    this.world.setViewDistance(quality.viewDistance, quality.lodFactor);
    this.world.setVegetationDensity(quality.vegetation, quality.plantRadius, quality.treeRadius);
  }

  start() {
    this.input.attach();
    window.addEventListener("resize", this.onResize);
    this.refreshOverlay();
    this.leaderboard.refresh();
    this.renderer.setAnimationLoop(() => this.update());
  }

  groundAt(x, z) {
    return Math.max(this.world.heightAt(x, z), this.world.seaLevel);
  }

  boardState() {
    const board = this.leaderboard;
    return { entries: board.entries, online: board.online, loading: board.loading, pilot: board.pilot.name };
  }

  refreshOverlay() {
    this.hud.setOverlay(this.state, {
      score: this.score,
      best: this.best,
      wave: this.wave,
      paused: this.paused,
      seed: WORLD_SEED,
      climate: CLIMATE.name,
      mode: this.mode,
      board: this.boardState(),
      result: this.submitResult,
    });
  }

  handleMenuAction(action, value) {
    this.audio.ensureStarted();
    if (action === "combat" || action === "free") {
      this.startRun(action);
    } else if (action === "rename") {
      this.audio.playClick();
      this.leaderboard.rename();
    } else if (action === "seed" || action === "random-seed") {
      // The terrain workers read the seed at start-up, so a new world means a fresh page load.
      const seed = action === "seed" ? Number.parseInt(String(value).trim(), 10) : Math.floor(Math.random() * 1e9);
      if (!Number.isFinite(seed) || seed < 0 || seed >= 1e9) {
        this.audio.playDenied();
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set("seed", seed);
      window.location.assign(url);
    }
  }

  startRun(mode) {
    if (this.state !== GAME_STATES.START) {
      return;
    }
    this.mode = mode;
    this.audio.playClick();
    this.input.clearAimToCenter();
    this.input.requestLock();
    this.state = GAME_STATES.TAXI;
    this.player.beginRun();
    this.paused = false;
    if (mode === "free") {
      this.hud.showBanner("FREE FLIGHT", "No enemies - explore, sightsee, take pictures with O");
    }
    this.refreshOverlay();
  }

  setPaused(paused) {
    if (this.paused === paused) {
      return;
    }
    if (paused && this.photo) {
      this.togglePhoto();
    }
    this.paused = paused;
    this.refreshOverlay();
  }

  // Enter, or a click on an overlay: start the run, or come back from pause.
  handleConfirm() {
    this.audio.ensureStarted();
    if (this.state === GAME_STATES.START) {
      this.startRun("combat");
    } else if (this.state === GAME_STATES.GAME_OVER) {
      if (this.deathTimer <= 0) {
        this.reset();
      }
    } else if (this.paused) {
      this.input.requestLock();
      if (!this.input.requireLock) {
        this.setPaused(false);
      }
    }
  }

  reset() {
    for (const list of [this.projectiles, this.missiles, this.enemies, this.rings]) {
      for (const item of list) {
        this.disposeObject(item.mesh);
      }
      list.length = 0;
    }
    this.effects.clear();
    this.hud.clearToasts();
    this.resetRun();
    this.player.reset();
    this.player.mesh.visible = true;
    if (this.photo) {
      this.togglePhoto();
    }
    this.submitResult = null;
    this.leaderboard.refresh();
    this.state = GAME_STATES.START;
    this.paused = false;
    this.input.releaseLock();
    this.input.clearAimToCenter();
    this.refreshOverlay();
  }

  handlePresses(delta) {
    for (const code of this.input.consumePresses()) {
      if (code === "Enter") {
        this.handleConfirm();
      } else if (code === "KeyH") {
        this.hud.toggleHelp();
      } else if (code === "Escape" && !this.input.requireLock && PLAYING_STATES.has(this.state)) {
        this.setPaused(!this.paused);
      } else if (code === "KeyO" && !this.paused && (PLAYING_STATES.has(this.state) || this.state === GAME_STATES.GAME_OVER)) {
        this.togglePhoto();
      } else if (code === "KeyK" && this.photo) {
        this.captureNext = true;
      } else if (this.photo) {
        continue;
      } else if (code === "KeyP" && !this.paused) {
        this.toggleAutoLanding();
      } else if (code === "KeyR" && this.state === GAME_STATES.GAME_OVER && this.deathTimer <= 0) {
        this.audio.playClick();
        this.reset();
      }
    }

    // Restarting mid-flight throws the run away, so it has to be held rather than tapped.
    if (this.input.restart && PLAYING_STATES.has(this.state)) {
      this.restartHold += delta;
      if (this.restartHold >= RESTART_HOLD) {
        this.audio.playClick();
        this.reset();
      }
    } else {
      this.restartHold = 0;
    }
  }

  toggleAutoLanding() {
    if (this.state === GAME_STATES.LANDING) {
      if (this.player.cancelAutoLanding()) {
        this.state = GAME_STATES.FLYING;
        this.audio.playClick();
      }
      return;
    }
    if (this.state !== GAME_STATES.FLYING) {
      return;
    }
    this.input.clearAimToCenter();
    this.player.beginAutoLanding();
    this.state = GAME_STATES.LANDING;
    this.suspendWave();
    this.audio.playClick();
  }

  update() {
    const frameTime = this.clock.getDelta();
    const delta = Math.min(frameTime, 0.033);
    this.handlePresses(delta);
    // Covers a refused lock request as well as Esc: without the pointer there is no way to steer.
    const unlocked = this.input.requireLock && !this.input.locked && PLAYING_STATES.has(this.state);
    this.lockWait = unlocked ? (this.lockWait ?? 0) + frameTime : 0;
    if (this.lockWait > 0.6 && !this.paused) {
      // No lock and no error either: treat it as a refusal so the fallback can take over.
      this.input.onLockError();
      this.setPaused(this.input.requireLock);
    }

    const playing = PLAYING_STATES.has(this.state) && !this.paused && !this.photo;
    if (playing) {
      this.simulate(delta);
    }
    if (!this.paused) {
      this.life.update(delta, this.player.mesh.position, this.effects);
      this.chimneyTimer = (this.chimneyTimer ?? 0) - delta;
      if (this.chimneyTimer <= 0) {
        this.chimneyTimer = 0.22;
        for (const top of this.settings.life ? this.world.chimneys() : []) {
          if (top.distanceToSquared(this.player.mesh.position) < 520 * 520) {
            this.effects.chimney(top, this.atmosphere.weather.wind);
          }
        }
      }
      this.effects.update(delta);
      if (this.state === GAME_STATES.GAME_OVER && this.deathTimer > 0) {
        this.deathTimer -= delta;
        if (this.deathTimer <= 0) {
          this.refreshOverlay();
        }
      }
    }

    this.audio.updateEngine({
      speedRatio: THREE.MathUtils.clamp(this.player.speed / PLAYER_CONFIG.maxFlySpeed, 0, 1.3),
      throttle: this.player.boosting || (this.state === GAME_STATES.TAXI && this.input.throttle) ? 1 : 0,
      onGround: this.player.altitude <= PLAYER_CONFIG.minAltitude + 0.1,
      climbRate: this.player.velocity.y,
      active: playing,
    });
    this.audio.updateEnemyDrone(playing ? this.nearestEnemyPosition() : null);
    this.audio.updateHeartbeat(playing && this.player.health <= 1);
    this.audio.tickMusic();
    if (this.photo) {
      this.updatePhotoCamera(frameTime);
    } else {
      this.updateCamera(delta);
    }
    this.audio.updateListener(
      this.camera.position,
      this.camera.getWorldDirection(new THREE.Vector3()),
      new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion)
    );
    this.updateHud(delta);
    this.world.update(this.player.mesh.position);
    this.atmosphere.update(this.player.mesh.position, this.camera.position, delta);
    this.graphics.setNight(this.atmosphere.night);
    const rush = THREE.MathUtils.smoothstep(this.player.speed, PLAYER_CONFIG.maxFlySpeed * 1.02, PLAYER_CONFIG.boostSpeed);
    this.speedRush = THREE.MathUtils.damp(this.speedRush ?? 0, this.settings.speedFx && this.state === GAME_STATES.FLYING ? rush : 0, 4, delta);
    this.graphics.setSpeed(this.speedRush, delta);
    this.graphics.setMist(this.atmosphere.inCloud, this.atmosphere.mistColor, delta);
    this.graphics.setLight(this.atmosphere.rayDirection, this.atmosphere.lightColor, this.atmosphere.rayStrength, this.atmosphere.flareStrength);
    this.audio.updateRain(this.atmosphere.weather.state.rain);
    this.graphics.setFocus(this.player.mesh.position);
    if (this.viewWidth >= 2 && this.viewHeight >= 2) {
      this.graphics.render(frameTime);
      if (this.captureNext) {
        this.captureNext = false;
        this.savePicture();
      }
    }
    if (this.debugPanel) {
      const chunks = this.world.stats();
      this.debugPanel.update(frameTime, {
        ...this.graphics.stats,
        quality: this.graphics.qualityName,
        resolutionScale: this.graphics.resolutionScale,
        chunks: chunks.visible,
        pending: chunks.pending,
      });
    }
  }

  simulate(delta) {
    const player = this.player;
    const previousPosition = player.mesh.position.clone();
    const previousState = this.state;
    this.handleStuntInput();
    player.update(delta, this.input, this.world);
    if (player.justCompletedStunt) {
      this.awardTrick(player.justCompletedStunt);
    }
    this.resolvePlayerWorldCollisions(previousPosition);
    if (this.state === GAME_STATES.GAME_OVER) {
      return;
    }
    this.state = player.state;
    if (previousState === GAME_STATES.FLYING && this.state === GAME_STATES.LANDING) {
      this.suspendWave();
    }

    if (player.justBecameReady) {
      this.audio.playTakeoffReady();
    }
    if (player.justLiftedOff) {
      this.audio.playLiftoff();
    }
    if (player.justTouchedDown) {
      this.audio.playTouchdown();
      this.shake = Math.max(this.shake, 0.5);
      for (let i = 0; i < 14; i += 1) {
        this.effects.dust(player.mesh.position.clone().setY(this.player.groundLevel + 0.4), player.velocity, true);
      }
    }
    if (player.justLanded) {
      this.completeLanding();
    }

    if (this.state === GAME_STATES.FLYING) {
      this.sortieTime += delta;
      if (this.input.fire && player.canFire()) {
        this.spawnProjectile();
        player.fireTimer = PLAYER_CONFIG.fireCooldown;
        this.audio.playShoot();
      }
      this.updateLock(delta);
      if (this.mode === "combat") {
        this.updateWave(delta);
      }
    } else {
      this.lockTarget = null;
      this.lockProgress = 0;
    }
    this.missileLatch = this.input.missile;

    this.updateProjectiles(delta);
    this.updateMissiles(delta);
    this.updateEnemies(delta);
    this.updateRings();
    this.emitStuntTrail(delta);
    this.emitFlightEffects(delta);
    this.emitGroundEffects(delta);
    this.updateCombo(delta);
    this.checkCollisions();
  }

  completeLanding() {
    const player = this.player;
    const repaired = player.health < PLAYER_CONFIG.maxHealth || player.missiles < PLAYER_CONFIG.maxMissiles;
    player.health = PLAYER_CONFIG.maxHealth;
    player.missiles = PLAYER_CONFIG.maxMissiles;
    // The bonus is for bringing a real sortie home by hand, not for hopping along the strip.
    if (player.manualLanding && this.sortieTime > 20) {
      this.score += PLAYER_CONFIG.landingRepairBonus;
      this.hud.showToast("SMOOTH LANDING!", PLAYER_CONFIG.landingRepairBonus, 1);
    }
    if (repaired) {
      this.hud.showBanner("REPAIRED & REARMED", "Hold Shift to take off again");
    }
    this.audio.playRepair();
    this.sortieTime = 0;
  }

  handleStuntInput() {
    for (const action of this.input.consumeStunts()) {
      const type = action === "loop" ? "loop" : "roll";
      const direction = action === "rollLeft" ? 1 : action === "rollRight" ? -1 : 1;
      if (this.player.beginStunt(type, direction)) {
        this.audio.playStunt(type, direction);
      }
    }
  }

  nearestEnemyPosition() {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const enemy of this.enemies) {
      const distance = enemy.mesh.position.distanceToSquared(this.player.mesh.position);
      if (enemy.alive && !enemy.isStatic && distance < nearestDistance) {
        nearest = enemy.mesh.position;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  awardTrick(type) {
    this.combo = Math.min(this.combo + 1, STUNT_CONFIG.maxCombo);
    this.comboTimer = STUNT_CONFIG.comboWindow;

    const points = STUNT_CONFIG.scores[type] * this.combo;
    this.score += points;
    this.hud.showToast(TRICK_LABELS[type], points, this.combo);
    this.audio.playTrick(this.combo);
  }

  updateCombo(delta) {
    if (this.combo === 0) {
      return;
    }

    this.comboTimer -= delta;
    if (this.comboTimer <= 0) {
      this.combo = 0;
      this.comboTimer = 0;
    }
  }

  // --- Waves -------------------------------------------------------------

  waveComposition(wave) {
    const kinds = [];
    const add = (kind, count) => {
      for (let i = 0; i < count; i += 1) {
        kinds.push(kind);
      }
    };
    add("rammer", Math.min(8, 1 + wave));
    add("gunner", wave >= 2 ? Math.min(5, 1 + Math.floor((wave - 2) / 2)) : 0);
    add("ace", Math.min(3, Math.floor(wave / 4)));
    add("turret", wave >= 3 ? Math.min(3, 1 + Math.floor((wave - 3) / 3)) : 0);
    // Shuffle so the dangerous ones are not always held back to the end.
    for (let i = kinds.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    return kinds;
  }

  startWave() {
    this.wave += 1;
    this.waveActive = true;
    this.waveQueue = this.waveComposition(this.wave);
    this.enemySpawnTimer = 1.5;
    if (this.wave > 1) {
      this.player.missiles = Math.min(PLAYER_CONFIG.maxMissiles, this.player.missiles + 1);
    }
    this.hud.showBanner(`WAVE ${this.wave}`, `${this.waveQueue.length} hostiles inbound`);
    this.audio.playWaveStart();
    this.spawnRings();
    for (let i = 0; i < 3; i += 1) {
      this.spawnEnemy("balloon");
    }
  }

  updateWave(delta) {
    if (!this.waveActive) {
      this.waveTimer -= delta;
      if (this.waveTimer <= 0) {
        this.startWave();
      }
      return;
    }

    const flyers = this.enemies.filter((enemy) => enemy.alive && !enemy.isStatic).length;
    this.enemySpawnTimer -= delta;
    if (this.waveQueue.length > 0 && flyers < 3 + Math.floor(this.wave / 2) && this.enemySpawnTimer <= 0) {
      this.enemySpawnTimer = ENEMY_CONFIG.spawnInterval;
      const kind = this.waveQueue.shift();
      if (!this.spawnEnemy(kind)) {
        // No clear spot this time (a turret needs dry land); fall back to something that can always spawn.
        this.waveQueue.push(kind === "turret" ? "gunner" : kind);
      }
    }

    const remaining = this.waveQueue.length + this.enemies.filter((enemy) => enemy.alive && enemy.countsForWave).length;
    if (remaining === 0) {
      const bonus = WAVE_CONFIG.clearBonus * this.wave;
      this.score += bonus;
      this.waveActive = false;
      this.waveTimer = WAVE_CONFIG.intermission;
      this.hud.showBanner(`WAVE ${this.wave} CLEARED`, `+${bonus} bonus`);
      this.audio.playWaveClear();
    }
  }

  // Hostile aircraft break off whenever the player is not free-flying; they rejoin from the queue afterwards.
  suspendWave() {
    this.enemies = this.enemies.filter((enemy) => {
      if (enemy.isStatic) {
        return true;
      }
      this.waveQueue.push(enemy.kind);
      this.disposeObject(enemy.mesh);
      return false;
    });
    this.projectiles = this.projectiles.filter((projectile) => {
      if (!projectile.hostile) {
        return true;
      }
      this.disposeObject(projectile.mesh);
      return false;
    });
    this.lockTarget = null;
    this.lockProgress = 0;
  }

  forwardFlat() {
    const heading = this.player.mesh.rotation.y;
    return new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));
  }

  spawnEnemy(kind) {
    const forward = this.forwardFlat();
    const lateral = new THREE.Vector3(-forward.z, 0, forward.x);
    const origin = this.player.mesh.position;
    const grounded = kind === "turret";

    // Retry a few candidates and lift them clear of the terrain so nothing
    // spawns inside a mountain and explodes on its first frame.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = origin
        .clone()
        .addScaledVector(forward, THREE.MathUtils.randFloat(grounded ? 260 : 220, grounded ? 460 : 340))
        .addScaledVector(lateral, THREE.MathUtils.randFloatSpread(grounded ? 300 : 320));
      const terrain = this.world.heightAt(candidate.x, candidate.z);
      const ground = Math.max(terrain, this.world.seaLevel);
      if (grounded) {
        const nearRunway = Math.abs(candidate.x) < 80 && Math.abs(candidate.z) < 620;
        if (terrain <= this.world.seaLevel + 1 || nearRunway || this.world.collide(candidate.clone().setY(terrain + 8), 5)) {
          continue;
        }
        candidate.y = terrain;
      } else {
        const offset = kind === "balloon" ? THREE.MathUtils.randFloat(-10, 30) : THREE.MathUtils.randFloat(-20, 45);
        candidate.y = THREE.MathUtils.clamp(origin.y + offset, ground + 32, PLAYER_CONFIG.maxAltitude - 12);
        if (this.world.collide(candidate, ENEMY_CONFIG.collisionRadius * 3)) {
          continue;
        }
      }
      const enemy = new EnemyPlane(kind, candidate);
      this.enemies.push(enemy);
      this.scene.add(enemy.mesh);
      return true;
    }
    return false;
  }

  spawnRings() {
    for (const ring of this.rings) {
      this.disposeObject(ring.mesh);
    }
    this.rings = [];
    const forward = this.forwardFlat();
    const lateral = new THREE.Vector3(-forward.z, 0, forward.x);
    const yaw = this.player.mesh.rotation.y;
    const side = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < 3; i += 1) {
      const position = this.player.mesh.position
        .clone()
        .addScaledVector(forward, 300 + i * 170)
        .addScaledVector(lateral, side * (60 + i * 45));
      // Low enough to be a dare, high enough to always be clear of the terrain around it.
      let ground = -Infinity;
      for (const [dx, dz] of [[0, 0], [24, 0], [-24, 0], [0, 24], [0, -24]]) {
        ground = Math.max(ground, this.groundAt(position.x + dx, position.z + dz));
      }
      position.y = Math.min(ground + 26 + i * 8, PLAYER_CONFIG.maxAltitude - 20);
      const ring = new Ring(position, yaw);
      this.rings.push(ring);
      this.scene.add(ring.mesh);
    }
  }

  updateRings() {
    const position = this.player.mesh.position;
    this.rings = this.rings.filter((ring) => {
      if (this.state === GAME_STATES.FLYING && ring.passedBy(position)) {
        this.awardTrick("ring");
        this.audio.playRing();
        this.effects.explosion(ring.mesh.position, 0xffd257);
        this.disposeObject(ring.mesh);
        return false;
      }
      return true;
    });
  }

  // --- Weapons -----------------------------------------------------------

  updateLock(delta) {
    const player = this.player;
    const forward = player.getShotDirection();
    let best = null;
    let bestAngle = TRACK_CONE;
    for (const enemy of this.enemies) {
      if (!enemy.alive) {
        continue;
      }
      const offset = enemy.mesh.position.clone().sub(player.mesh.position);
      const distance = offset.length();
      if (distance > MISSILE_CONFIG.lockRange) {
        continue;
      }
      const angle = Math.acos(THREE.MathUtils.clamp(offset.dot(forward) / distance, -1, 1));
      if (angle < bestAngle) {
        best = enemy;
        bestAngle = angle;
      }
    }

    if (best !== this.lockTarget) {
      this.lockTarget = best;
      this.lockProgress = 0;
    }
    if (best) {
      const wasLocked = this.lockProgress >= 1;
      const rate = bestAngle < MISSILE_CONFIG.lockCone ? 1 / MISSILE_CONFIG.lockTime : -1.5;
      this.lockProgress = THREE.MathUtils.clamp(this.lockProgress + rate * delta, 0, 1);
      if (this.lockProgress >= 1 && !wasLocked) {
        this.audio.playLocked();
      } else if (rate > 0 && this.lockProgress < 1) {
        this.lockTickTimer -= delta;
        if (this.lockTickTimer <= 0) {
          this.lockTickTimer = 0.16;
          this.audio.playLockTick();
        }
      }
    }

    if (this.input.missile && !this.missileLatch) {
      if (this.lockTarget && this.lockProgress >= 1 && player.missiles > 0) {
        player.missiles -= 1;
        const origin = player.mesh.localToWorld(new THREE.Vector3(0, -1.2, -1));
        const missile = new Missile(origin, forward, this.lockTarget);
        missile.smokeTimer = 0;
        this.missiles.push(missile);
        this.scene.add(missile.mesh);
        this.audio.playMissile();
      } else {
        this.audio.playDenied();
      }
    }
  }

  spawnProjectile() {
    const muzzle = this.player.getMuzzlePosition();
    const direction = this.player.getShotDirection();
    const projectile = new Projectile(muzzle, direction);
    // Shots inherit the plane's speed so they do not fall behind during a boost.
    projectile.velocity.addScaledVector(direction, this.player.speed * 0.6);
    this.projectiles.push(projectile);
    this.scene.add(projectile.mesh);
    this.effects.muzzleFlash(muzzle, direction);
  }

  updateProjectiles(delta) {
    this.projectiles = this.projectiles.filter((projectile) => {
      projectile.update(delta);
      if (this.world.collide(projectile.mesh.position, 0.6)) {
        projectile.alive = false;
      }
      if (!projectile.alive) {
        this.disposeObject(projectile.mesh);
        return false;
      }
      return true;
    });
  }

  updateMissiles(delta) {
    this.missiles = this.missiles.filter((missile) => {
      missile.update(delta);
      missile.smokeTimer -= delta;
      if (missile.smokeTimer <= 0) {
        missile.smokeTimer = 0.025;
        const exhaust = missile.getExhaustPosition();
        this.effects.trail(exhaust, 0xff9a3a, 0.25);
        this.effects.smoke(exhaust, false);
      }

      let detonate = Boolean(this.world.collide(missile.mesh.position, 1));
      for (const enemy of this.enemies) {
        if (enemy.alive && missile.mesh.position.distanceTo(enemy.mesh.position) < MISSILE_CONFIG.blastRadius + enemy.radius) {
          this.damageEnemy(enemy, MISSILE_CONFIG.damage);
          detonate = true;
        }
      }
      if (detonate) {
        this.effects.explosion(missile.mesh.position, 0xffb347, true);
        this.audio.playExplosion(missile.mesh.position, "large");
        missile.alive = false;
      }
      if (!missile.alive) {
        this.disposeObject(missile.mesh);
        return false;
      }
      return true;
    });
  }

  damageEnemy(enemy, amount) {
    enemy.health -= amount;
    this.hud.hitMarker();
    if (enemy.health > 0) {
      this.audio.playHitMarker();
      this.effects.smoke(enemy.mesh.position, true);
      return;
    }
    enemy.alive = false;
    this.score += enemy.config.score;
    this.effects.explosion(enemy.mesh.position, 0xff9357, enemy.kind === "ace" || enemy.kind === "turret");
    this.audio.playKill(enemy.mesh.position);
  }

  updateEnemies(delta) {
    const player = this.player;
    const engaged = this.state === GAME_STATES.FLYING;
    this.enemies = this.enemies.filter((enemy) => {
      const shot = enemy.update(delta, player, this.world);
      if (shot && engaged) {
        const muzzle = enemy.getMuzzlePosition();
        const projectile = new Projectile(muzzle, shot, {
          hostile: true,
          speed: ENEMY_CONFIG.bulletSpeed,
          lifetime: ENEMY_CONFIG.bulletLifetime,
        });
        this.projectiles.push(projectile);
        this.scene.add(projectile.mesh);
        this.effects.muzzleFlash(muzzle, shot);
        this.audio.playEnemyShot(muzzle);
      }

      if (enemy.exhaust !== null) {
        enemy.trailTimer = (enemy.trailTimer ?? 0) - delta;
        if (enemy.trailTimer <= 0) {
          enemy.trailTimer = 0.03;
          this.effects.trail(enemy.getExhaustPosition(), enemy.kind === "ace" ? 0xb06aff : 0xff8a2a, 0.16);
        }
      }
      // A hit that did not kill leaves the target trailing smoke for the rest of its life.
      if (enemy.health < enemy.config.health) {
        enemy.smokeTimer = (enemy.smokeTimer ?? 0) - delta;
        if (enemy.smokeTimer <= 0) {
          enemy.smokeTimer = 0.06;
          this.effects.smoke(enemy.mesh.position, enemy.health <= 1);
        }
      }

      const distance = enemy.mesh.position.distanceTo(player.mesh.position);
      if (!enemy.isStatic && this.world.collide(enemy.mesh.position, enemy.radius, PLAYER_CONFIG.collisionVerticalRadius)) {
        enemy.alive = false;
        this.effects.explosion(enemy.mesh.position, 0xff9357);
        this.splashIfSea(enemy.mesh.position);
        this.audio.playExplosion(enemy.mesh.position);
      }
      // Anything the player has left far behind rejoins the fight from the queue instead of chasing forever.
      const lost = distance > (enemy.isStatic ? 1400 : 650);
      if (lost && enemy.alive && enemy.countsForWave) {
        this.waveQueue.push(enemy.kind);
      }
      if (!enemy.alive || lost) {
        this.disposeObject(enemy.mesh);
        return false;
      }
      return true;
    });
  }

  checkCollisions() {
    const player = this.player;
    const position = player.mesh.position;
    for (const projectile of this.projectiles) {
      if (!projectile.alive) {
        continue;
      }
      if (projectile.hostile) {
        if (this.state === GAME_STATES.FLYING && projectile.mesh.position.distanceTo(position) < player.radius + 0.6) {
          projectile.alive = false;
          this.damagePlayer(1);
        }
        continue;
      }
      for (const enemy of this.enemies) {
        if (
          enemy.alive &&
          projectile.alive &&
          projectile.mesh.position.distanceTo(enemy.mesh.position) < PROJECTILE_CONFIG.collisionRadius + enemy.radius
        ) {
          projectile.alive = false;
          this.damageEnemy(enemy, 1);
        }
      }
    }

    for (const enemy of this.enemies) {
      if (!enemy.alive) {
        continue;
      }

      const distance = enemy.mesh.position.distanceTo(position);
      if (distance < enemy.radius + 2.4) {
        enemy.alive = false;
        this.effects.explosion(enemy.mesh.position, 0xff5b5b);
        this.audio.playExplosion(enemy.mesh.position);
        this.damagePlayer(enemy.kind === "balloon" ? 1 : 2);
        continue;
      }

      // Only pay out once the enemy is receding again, and only while the player
      // is actually manoeuvring, so flying straight and being overtaken earns nothing.
      const passed = enemy.previousDistance !== null && distance > enemy.previousDistance;
      if (
        !enemy.nearMissed &&
        !enemy.isStatic &&
        passed &&
        this.state === GAME_STATES.FLYING &&
        player.maneuverTimer > 0 &&
        distance < STUNT_CONFIG.nearMissRadius
      ) {
        enemy.nearMissed = true;
        this.awardTrick("nearMiss");
        this.audio.playNearMiss(enemy.mesh.position);
      }
      enemy.previousDistance = distance;
    }
  }

  resolvePlayerWorldCollisions(previousPosition) {
    const player = this.player;
    if (player.crashed) {
      this.killPlayer();
      return;
    }
    // The autopilot and the rollout keep themselves clear of the ground, so a clipped tree cannot wreck a landing.
    if (player.state === GAME_STATES.LANDING) {
      return;
    }
    if (!this.world.collide(player.mesh.position, player.radius, PLAYER_CONFIG.collisionVerticalRadius)) {
      return;
    }

    if (player.state === GAME_STATES.TAXI) {
      player.mesh.position.copy(previousPosition);
      player.velocity.set(0, 0, 0);
      return;
    }
    this.killPlayer();
  }

  damagePlayer(amount) {
    if (this.state === GAME_STATES.GAME_OVER) {
      return;
    }
    this.player.health -= amount;
    this.hud.damageFlash();
    this.shake = Math.max(this.shake, 0.9);
    if (this.player.health > 0) {
      this.audio.playHurt();
      return;
    }
    this.killPlayer();
  }

  // Free flight has no game over: the wreck explodes and a fresh plane appears overhead.
  respawnFree() {
    const player = this.player;
    this.respawns += 1;
    this.effects.explosion(player.mesh.position, 0xff5b5b, true);
    this.splashIfSea(player.mesh.position);
    this.audio.playExplosion(player.mesh.position, "large");
    this.shake = 1.2;
    const position = player.mesh.position;
    position.y = Math.max(this.groundAt(position.x, position.z), this.world.seaLevel) + 80;
    player.mesh.rotation.set(0, player.mesh.rotation.y, 0);
    player.stunt = null;
    player.crashed = false;
    player.health = PLAYER_CONFIG.maxHealth;
    player.state = GAME_STATES.FLYING;
    player.velocity.copy(player.getShotDirection()).multiplyScalar(PLAYER_CONFIG.maxFlySpeed * 0.8);
    this.state = GAME_STATES.FLYING;
    this.input.clearAimToCenter();
    this.hud.showBanner("RESPAWNED", "Free flight - crashes cost nothing");
  }

  killPlayer() {
    if (this.state === GAME_STATES.GAME_OVER) {
      return;
    }
    if (this.mode === "free") {
      this.respawnFree();
      return;
    }
    const player = this.player;
    player.health = 0;
    player.state = GAME_STATES.GAME_OVER;
    player.mesh.visible = false;
    player.velocity.set(0, 0, 0);
    this.state = GAME_STATES.GAME_OVER;
    this.effects.explosion(player.mesh.position, 0xff5b5b, true);
    this.splashIfSea(player.mesh.position);
    this.audio.playExplosion(player.mesh.position, "large");
    this.audio.playGameOver();
    this.hud.damageFlash();
    this.shake = 1.6;
    // Let the wreck burn for a moment before the results screen covers it.
    this.deathTimer = 1.6;
    if (this.score > this.best) {
      this.best = this.score;
      store("best", this.best);
    }
    this.submitResult = null;
    if (this.score > 0) {
      this.leaderboard.submit({ score: this.score, wave: this.wave, seed: WORLD_SEED }).then((result) => {
        this.submitResult = result;
        if (this.state === GAME_STATES.GAME_OVER && this.deathTimer <= 0) {
          this.refreshOverlay();
        }
      });
    }
    this.input.releaseLock();
  }

  // --- Effects, camera, HUD ------------------------------------------------

  emitStuntTrail(delta) {
    if (!this.player.stunt) {
      this.trailTimer = 0;
      return;
    }

    this.trailTimer -= delta;
    if (this.trailTimer > 0) {
      return;
    }
    this.trailTimer = STUNT_CONFIG.trailInterval;

    const color = this.player.stunt.type === "loop" ? 0xffd257 : 0x63e6ff;
    for (const tip of this.player.getWingtipPositions()) {
      this.effects.trail(tip, color, STUNT_CONFIG.trailLife);
    }
  }

  splashIfSea(position) {
    const sea = this.world.seaLevel;
    if (position.y < sea + 6 && this.world.heightAt(position.x, position.z) < sea) {
      this.effects.splash(position.clone().setY(sea));
    }
  }

  emitGroundEffects(delta) {
    const player = this.player;
    const position = player.mesh.position;
    const sea = this.world.seaLevel;
    const overWater = this.world.heightAt(position.x, position.z) < sea;
    this.sprayTimer = (this.sprayTimer ?? 0) - delta;
    if (this.sprayTimer <= 0) {
      this.sprayTimer = 0.03;
      const height = position.y - sea;
      // Skimming the sea drags a rooster tail of spray; the lower the pass, the bigger it gets.
      if (this.state === GAME_STATES.FLYING && overWater && height < 16) {
        this.effects.spray(position.clone().setY(sea + 0.3), player.velocity, Math.ceil((1 - height / 16) * 4));
      }
      const rolling = this.state !== GAME_STATES.FLYING && position.y <= PLAYER_CONFIG.minAltitude + 0.3 && player.speed > 14;
      if (rolling) {
        this.effects.dust(position.clone().setY(player.groundLevel + 0.3), player.velocity);
      }
    }

    // Rain pocks the ground round the plane when it is low enough to see it.
    const rain = this.atmosphere.weather.state.rain;
    if (rain > 0.05 && this.settings.weatherFx && position.y - player.groundLevel < 70) {
      for (let i = 0; i < Math.ceil(rain * 5); i += 1) {
        const x = position.x + THREE.MathUtils.randFloatSpread(90);
        const z = position.z + THREE.MathUtils.randFloatSpread(90);
        const ground = this.world.heightAt(x, z);
        if (ground >= sea) {
          this.effects.raindrop(new THREE.Vector3(x, ground + 0.3, z));
        }
      }
    }
  }

  emitFlightEffects(delta) {
    const player = this.player;
    const flying = this.state === GAME_STATES.FLYING;
    this.vaporTimer -= delta;
    // Vapour only streams off the tips under load; in level cruise it read as a row of floating lights.
    const loaded = player.boosting || Math.abs(player.mesh.rotation.z) > 0.5 || Math.abs(player.mesh.rotation.x) > 0.45;
    if (flying && loaded && this.vaporTimer <= 0) {
      this.vaporTimer = 0.015;
      for (const tip of player.getWingtipPositions()) {
        this.effects.vapor(tip, player.velocity);
      }
    }
    if (flying && player.boosting) {
      const backward = player.getShotDirection().negate();
      for (const exhaust of player.getExhaustPositions()) {
        this.effects.afterburner(exhaust, player.velocity, backward);
      }
      if (Math.random() < 0.25) {
        this.effects.flash(player.getExhaustPositions()[0], 0x6aa8ff, 500, 0.08);
      }
    }
    this.smokeTimer -= delta;
    if (flying && player.health <= 2 && this.smokeTimer <= 0) {
      this.smokeTimer = player.health <= 1 ? 0.04 : 0.08;
      this.effects.smoke(player.mesh.localToWorld(new THREE.Vector3(0, 0.6, 2.5)), player.health <= 1);
    }
  }

  // Three.js never frees GPU buffers on its own, so every mesh we drop has to
  // release its geometry and material or the run leaks for as long as it lasts.
  disposeObject(object) {
    this.scene.remove(object);
    object.traverse((node) => {
      if (node.isMesh) {
        node.geometry.dispose();
        node.material.dispose();
      }
    });
  }

  togglePhoto() {
    if (this.photo) {
      this.photo = null;
      this.hud.setPhotoMode(false);
      this.camera.fov = 68;
      this.camera.updateProjectionMatrix();
      return;
    }
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    this.photo = {
      yaw: Math.atan2(-direction.x, -direction.z),
      pitch: Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)),
      fov: this.camera.fov,
    };
    this.input.consumeLook();
    this.hud.setPhotoMode(true);
  }

  updatePhotoCamera(delta) {
    const photo = this.photo;
    const look = this.input.consumeLook();
    photo.yaw -= look.x * PHOTO_LOOK * (photo.fov / 68);
    photo.pitch = THREE.MathUtils.clamp(photo.pitch - look.y * PHOTO_LOOK * (photo.fov / 68), -1.5, 1.5);
    photo.fov = THREE.MathUtils.clamp(photo.fov + look.wheel * 4, 15, 100);
    const camera = this.camera;
    camera.rotation.set(photo.pitch, photo.yaw, 0, "YXZ");
    if (camera.fov !== photo.fov) {
      camera.fov = photo.fov;
      camera.updateProjectionMatrix();
    }
    const keys = this.input.keys;
    const move = new THREE.Vector3(
      (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
      (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0),
      (keys.has("KeyS") ? 1 : 0) - (keys.has("KeyW") ? 1 : 0)
    );
    if (move.lengthSq() > 0) {
      const boost = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 4 : 1;
      move.normalize().applyEuler(camera.rotation).multiplyScalar(PHOTO_SPEED * boost * delta);
      camera.position.add(move);
      camera.position.y = Math.max(camera.position.y, this.groundAt(camera.position.x, camera.position.z) + 1.5);
    }
  }

  savePicture() {
    this.canvas.toBlob((blob) => {
      if (!blob) {
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `voxel-sky-fighter-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      this.audio.playClick();
    }, "image/png");
  }

  updateCamera(delta) {
    const player = this.player;
    const playerPos = player.mesh.position;
    const looping = player.stunt?.type === "loop";
    // Follow heading and a clamped pitch rather than the airframe itself, so a loop or
    // a roll happens in front of a level camera instead of flipping the horizon.
    const targetPitch = looping ? player.stunt.startPitch : THREE.MathUtils.clamp(player.mesh.rotation.x, -0.9, 0.9);
    const yawError = Math.atan2(
      Math.sin(player.mesh.rotation.y - this.cameraYaw),
      Math.cos(player.mesh.rotation.y - this.cameraYaw)
    );
    this.cameraYaw += yawError * Math.min(1, 6 * delta);
    this.cameraPitch = THREE.MathUtils.damp(this.cameraPitch, targetPitch * 0.75, 4, delta);

    const forward = new THREE.Vector3(
      -Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
      Math.sin(this.cameraPitch),
      -Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch)
    );
    this.cameraBoost = THREE.MathUtils.damp(this.cameraBoost, this.state === GAME_STATES.TAKEOFF ? 1 : 0, 3, delta);
    const rush = THREE.MathUtils.clamp((player.speed - 55) / 37, 0, 1);
    const desired = playerPos
      .clone()
      .addScaledVector(forward, -17 - this.cameraBoost * 4 - rush * 3)
      .add(new THREE.Vector3(0, 6.5 - this.cameraBoost * 1.2, 0));

    this.camera.position.lerp(desired, 1 - Math.pow(0.0005, delta));
    // Keep the lens out of the terrain, and lift it when a ridge sits between it and the plane.
    const middle = this.camera.position.clone().lerp(playerPos, 0.5);
    const floor = Math.max(
      this.groundAt(this.camera.position.x, this.camera.position.z),
      this.groundAt(middle.x, middle.z) - (playerPos.y - this.camera.position.y) * 0.5
    );
    this.camera.position.y = Math.max(this.camera.position.y, floor + 2.5);

    const fov = THREE.MathUtils.damp(this.camera.fov, 68 + rush * 14, 3, delta);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    const lookTarget = playerPos
      .clone()
      .addScaledVector(forward, 24)
      .add(new THREE.Vector3(0, 2.2 + this.cameraBoost * 1.2, 0));
    this.camera.lookAt(lookTarget);

    if (this.shake > 0.01) {
      this.shake = THREE.MathUtils.damp(this.shake, 0, 5, delta);
      this.camera.position.x += THREE.MathUtils.randFloatSpread(this.shake);
      this.camera.position.y += THREE.MathUtils.randFloatSpread(this.shake);
      this.camera.rotation.z += THREE.MathUtils.randFloatSpread(this.shake * 0.03);
    }
    this.camera.updateMatrixWorld();
  }

  project(point) {
    const view = point.clone().applyMatrix4(this.camera.matrixWorldInverse);
    const ndc = point.clone().project(this.camera);
    return {
      x: 50 + ndc.x * 50,
      y: 50 - ndc.y * 50,
      visible: view.z < 0 && Math.abs(ndc.x) < 0.96 && Math.abs(ndc.y) < 0.96,
      view,
    };
  }

  radarPoint(position, kind, clampToEdge = false) {
    const center = this.player.mesh.position;
    const heading = this.player.mesh.rotation.y;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    const dx = position.x - center.x;
    const dz = position.z - center.z;
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const distance = Math.hypot(localX, localZ);
    if (distance > RADAR_RANGE && !clampToEdge) {
      return null;
    }
    const scale = Math.min(distance, RADAR_RANGE) / RADAR_RANGE / (distance || 1);
    return {
      x: 50 + localX * scale * 44,
      y: 50 + localZ * scale * 44,
      strength: Math.max(0.45, 1 - distance / RADAR_RANGE),
      kind,
    };
  }

  groundWarning() {
    const player = this.player;
    if (this.state !== GAME_STATES.FLYING || player.stunt) {
      return false;
    }
    // Coming in over the strip is supposed to be low; do not nag during a landing.
    const nearStrip = Math.abs(player.mesh.position.x) < 70 && Math.abs(player.mesh.position.z) < 760;
    if (nearStrip && player.speed < 62) {
      return false;
    }
    for (const seconds of [0.5, 1, 1.6]) {
      const ahead = player.mesh.position.clone().addScaledVector(player.velocity, seconds);
      if (ahead.y - this.groundAt(ahead.x, ahead.z) < 5) {
        return true;
      }
    }
    return false;
  }

  hintText() {
    const player = this.player;
    if (this.state === GAME_STATES.TAXI) {
      if (player.takeoffReady) {
        return "PULL UP (W)";
      }
      return this.input.throttle ? "ACCELERATE" : "HOLD SHIFT";
    }
    if (this.state === GAME_STATES.TAKEOFF) {
      return "LIFT OFF";
    }
    if (this.state === GAME_STATES.LANDING) {
      return player.landingPhase === "rollout" ? "ROLLOUT" : "AUTOLAND - P CANCELS";
    }
    if (this.state === GAME_STATES.FLYING) {
      if (this.restartHold > 0) {
        return "HOLD R TO RESTART";
      }
      return player.boosting ? "AFTERBURNER" : player.braking ? "AIR BRAKE" : "";
    }
    return "";
  }

  updateHud(delta) {
    const player = this.player;
    const flying = this.state === GAME_STATES.FLYING;

    const aim = this.project(player.mesh.position.clone().addScaledVector(player.getShotDirection(), 400));
    if (aim.view.z < 0) {
      this.hud.root.style.setProperty("--reticle-x", `${aim.x}%`);
      this.hud.root.style.setProperty("--reticle-y", `${aim.y}%`);
    }

    let lock = null;
    let lead = null;
    const arrows = [];
    if (flying) {
      if (this.lockTarget?.alive) {
        const target = this.lockTarget;
        const marker = this.project(target.mesh.position);
        if (marker.visible) {
          lock = { x: marker.x, y: marker.y, locked: this.lockProgress >= 1, progress: this.lockProgress };
        }
        const distance = target.mesh.position.distanceTo(player.mesh.position);
        const shotSpeed = PROJECTILE_CONFIG.speed + player.speed * 0.6;
        const pip = this.project(target.mesh.position.clone().addScaledVector(target.velocity, distance / shotSpeed));
        if (pip.visible && !target.isStatic) {
          lead = pip;
        }
      }
      for (const enemy of this.enemies) {
        if (arrows.length >= 6 || !enemy.alive || enemy.kind === "balloon") {
          continue;
        }
        const marker = this.project(enemy.mesh.position);
        if (!marker.visible) {
          const angle = Math.atan2(marker.view.x, marker.view.y);
          arrows.push({ x: 50 + Math.sin(angle) * 42, y: 50 - Math.cos(angle) * 42, angle });
        }
      }
    }

    const warning = this.groundWarning() ? "PULL UP" : null;
    if (warning) {
      this.warningTimer -= delta;
      if (this.warningTimer <= 0) {
        this.warningTimer = 0.5;
        this.audio.playWarning();
      }
    } else {
      this.warningTimer = 0;
    }

    const contacts = [];
    for (const enemy of this.enemies) {
      const point = enemy.alive && this.radarPoint(enemy.mesh.position, enemy.kind);
      if (point) {
        contacts.push(point);
      }
    }
    for (const ring of this.rings) {
      const point = this.radarPoint(ring.mesh.position, "ring");
      if (point) {
        contacts.push(point);
      }
    }

    this.hud.update({
      stateLabel: this.state.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase(),
      hint: this.hintText(),
      speed: player.speed,
      altitude: player.mesh.position.y - this.groundAt(player.mesh.position.x, player.mesh.position.z),
      health: player.health,
      score: this.score,
      best: Math.max(this.best, this.score),
      wave: this.mode === "free" ? "Free flight" : this.wave === 0 ? "-" : this.waveActive ? `${this.wave}` : `${this.wave} (cleared)`,
      missiles: player.missiles,
      boost: player.boost,
      combo: this.combo,
      comboRatio: this.combo > 0 ? this.comboTimer / STUNT_CONFIG.comboWindow : 0,
      radarContacts: contacts,
      radarHome: this.radarPoint(this.world.runway.position, "home", true),
      stick: this.input.getAimUiPosition(),
      showStick: flying && !this.paused,
      lock,
      lead,
      arrows,
      warning,
    });
  }
}
