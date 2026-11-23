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
import { Boss, BOSS_MOUNTS, Transport } from "../entities/Boss.js";
import { AIRCRAFT, DIFFICULTY, aircraftById } from "./Aircraft.js";
import { VoxelWorld } from "../world/VoxelWorld.js";
import { Atmosphere } from "../world/Atmosphere.js";
import { installShaderPatches } from "../world/WorldShading.js";
import { Effects } from "./Effects.js";
import { Life } from "../world/Life.js";
import { Hud } from "../ui/Hud.js";
import { DebugPanel } from "../ui/DebugPanel.js";
import { Leaderboard } from "./Leaderboard.js";
import { CLIMATE, FEATURE_CELL, WORLD_SEED, featureInCell } from "../world/TerrainGen.js";
import { runSelfTest } from "./SelfTest.js";

const TRICK_LABELS = {
  roll: "BARREL ROLL!",
  loop: "LOOP!",
  nearMiss: "NEAR MISS!",
  ring: "RING!",
};

// Every fifth stage is the boss; two of the four stages in between are missions, in this rotation.
// The first two missions are air-only so ground fire does not arrive before the player has settled in.
const MISSION_ORDER = ["race", "escort", "strike", "antiship"];
const MISSION_TITLES = {
  strike: "GROUND STRIKE",
  race: "RING RACE",
  escort: "ESCORT",
  antiship: "SINK THE FLEET",
  boss: "SKY FORTRESS",
};
const RACE_RINGS = 8;
const LIGHTNING_HEIGHT = 100;

const STORAGE_PREFIX = "vsf.";
const DEFAULT_SETTINGS = {
  plane: "standard",
  difficulty: "normal",
  weatherFlight: true,
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
    // Career points unlock planes. Saves from before unlocks existed start from their best score.
    this.career = loadStored("career", null) ?? this.best;
    store("career", this.career);
    if (!this.isUnlocked(this.settings.plane)) {
      this.settings.plane = "standard";
    }
    this.hangarIndex = AIRCRAFT.findIndex((plane) => plane.id === this.settings.plane);
    this.unlockedNow = [];
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
    this.boss = null;
    this.transport = null;
    this.mission = null;
    this.difficulty = DIFFICULTY.normal;
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
    this.lightningTimer = 15;
    this.gust = { roll: 0, lift: 0, rollTarget: 0, liftTarget: 0, timer: 0 };
  }

  isUnlocked(id) {
    return this.career >= aircraftById(id).unlock;
  }

  scaled(points) {
    return Math.round(points * (this.mode === "combat" ? this.difficulty.score : 1));
  }

  hangarState() {
    const plane = AIRCRAFT[this.hangarIndex];
    return {
      plane: { ...plane, unlocked: this.isUnlocked(plane.id) },
      index: this.hangarIndex,
      count: AIRCRAFT.length,
      flying: this.settings.plane,
    };
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
      hangar: this.hangarState(),
      career: this.career,
      difficulty: `Difficulty: ${(DIFFICULTY[this.settings.difficulty] ?? DIFFICULTY.normal).label}`,
      unlocked: this.unlockedNow,
    });
  }

  handleMenuAction(action, value) {
    this.audio.ensureStarted();
    if (action === "combat" || action === "free") {
      this.startRun(action);
    } else if (action === "plane-prev" || action === "plane-next") {
      this.audio.playClick();
      this.hangarIndex = (this.hangarIndex + (action === "plane-next" ? 1 : -1) + AIRCRAFT.length) % AIRCRAFT.length;
      const plane = AIRCRAFT[this.hangarIndex];
      if (this.isUnlocked(plane.id)) {
        this.settings.plane = plane.id;
        store("settings", this.settings);
        this.applySetting("plane");
      }
      this.refreshOverlay();
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
    this.difficulty = DIFFICULTY[this.settings.difficulty] ?? DIFFICULTY.normal;
    this.unlockedNow = [];
    this.audio.playClick();
    this.input.clearAimToCenter();
    this.input.requestLock();
    this.state = GAME_STATES.TAXI;
    this.player.armorBonus = mode === "combat" ? this.difficulty.armor : 0;
    this.player.health = this.player.maxHealth;
    this.player.missiles = this.player.maxMissiles;
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
    for (const object of [this.boss, this.transport]) {
      if (object) {
        this.disposeObject(object.mesh);
      }
    }
    this.boss = null;
    this.transport = null;
    this.mission = null;
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
    if (!this.photo) {
      const wheel = this.input.consumeLook().wheel;
      if (playing && wheel !== 0) {
        this.player.throttle = THREE.MathUtils.clamp(this.player.throttle - wheel * 0.1, 0, 1);
      }
    }
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
      this.emitVolcanoSmoke(delta);
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

  emitVolcanoSmoke(delta) {
    this.volcanoTimer = (this.volcanoTimer ?? 0) - delta;
    if (this.volcanoTimer > 0) {
      return;
    }
    this.volcanoTimer = 0.12;
    const focus = this.player.mesh.position;
    const cx = Math.floor(focus.x / FEATURE_CELL);
    const cz = Math.floor(focus.z / FEATURE_CELL);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const feature = featureInCell(cx + dx, cz + dz);
        if (feature?.type === "volcano" && Math.hypot(feature.x - focus.x, feature.z - focus.z) < 2200) {
          const crater = new THREE.Vector3(feature.x, this.world.heightAt(feature.x, feature.z) + 4, feature.z);
          this.effects.volcano(crater, this.atmosphere.weather.wind);
        }
      }
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
    if (player.state === GAME_STATES.FLYING) {
      this.applyWeather(delta);
      if (this.state === GAME_STATES.GAME_OVER) {
        return;
      }
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
    const repaired = player.health < player.maxHealth || player.missiles < player.maxMissiles;
    player.health = player.maxHealth;
    player.missiles = player.maxMissiles;
    // The bonus is for bringing a real sortie home by hand, not for hopping along the strip.
    if (player.manualLanding && this.sortieTime > 20) {
      const bonus = this.scaled(PLAYER_CONFIG.landingRepairBonus);
      this.score += bonus;
      this.hud.showToast("SMOOTH LANDING!", bonus, 1);
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

    const points = this.scaled(STUNT_CONFIG.scores[type] * this.combo);
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
    const scale = this.difficulty.enemies;
    const add = (kind, count) => {
      for (let i = 0; i < Math.round(count * scale); i += 1) {
        kinds.push(kind);
      }
    };
    add("rammer", Math.min(8, 1 + wave));
    add("gunner", wave >= 2 ? Math.min(5, 1 + Math.floor((wave - 2) / 2)) : 0);
    add("ace", Math.min(3, Math.floor(wave / 4)));
    add("turret", wave >= 6 ? Math.min(3, 1 + Math.floor((wave - 6) / 3)) : 0);
    if (kinds.length === 0) {
      kinds.push("rammer");
    }
    // Shuffle so the dangerous ones are not always held back to the end.
    for (let i = kinds.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    return kinds;
  }

  stageType(wave) {
    const slot = wave % 5;
    if (slot === 0) {
      return "boss";
    }
    if (slot === 2 || slot === 4) {
      return MISSION_ORDER[(Math.floor(wave / 5) * 2 + (slot === 4 ? 1 : 0)) % MISSION_ORDER.length];
    }
    return "wave";
  }

  startWave() {
    this.wave += 1;
    this.waveActive = true;
    this.mission = null;
    this.enemySpawnTimer = 1.5;
    if (this.wave > 1) {
      this.player.missiles = Math.min(this.player.maxMissiles, this.player.missiles + 1);
    }
    this.audio.playWaveStart();
    const type = this.stageType(this.wave);
    if (type !== "wave" && this.startMission(type)) {
      return;
    }
    this.waveQueue = this.waveComposition(this.wave);
    this.hud.showBanner(`WAVE ${this.wave}`, `${this.waveQueue.length} hostiles inbound`);
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

    if (this.mission) {
      const outcome = this.updateMission(delta);
      if (outcome) {
        this.endMission(outcome === "success");
      }
      return;
    }

    const remaining = this.waveQueue.length + this.enemies.filter((enemy) => enemy.alive && enemy.countsForWave).length;
    if (remaining === 0) {
      const bonus = this.scaled(WAVE_CONFIG.clearBonus * this.wave);
      this.score += bonus;
      this.waveActive = false;
      this.waveTimer = WAVE_CONFIG.intermission;
      this.hud.showBanner(`WAVE ${this.wave} CLEARED`, `+${bonus} bonus`);
      this.audio.playWaveClear();
    }
  }

  // --- Missions ----------------------------------------------------------

  // A spot ahead of the player that passes `accept(x, z, terrain)`, or null.
  findSite(accept, near, far, spread) {
    const forward = this.forwardFlat();
    const lateral = new THREE.Vector3(-forward.z, 0, forward.x);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const site = this.player.mesh.position
        .clone()
        .addScaledVector(forward, THREE.MathUtils.randFloat(near, far))
        .addScaledVector(lateral, THREE.MathUtils.randFloatSpread(spread));
      const terrain = this.world.heightAt(site.x, site.z);
      if (accept(site.x, site.z, terrain)) {
        return site.setY(terrain);
      }
    }
    return null;
  }

  dryFlatGround(x, z, terrain) {
    const sea = this.world.seaLevel;
    if (terrain <= sea + 1 || (Math.abs(x) < 120 && Math.abs(z) < 700)) {
      return false;
    }
    return [[30, 0], [-30, 0], [0, 30], [0, -30]].every(([dx, dz]) => Math.abs(this.world.heightAt(x + dx, z + dz) - terrain) < 7);
  }

  openWater(x, z) {
    const limit = this.world.seaLevel - 4;
    return [[0, 0], [45, 0], [-45, 0], [0, 45], [0, -45]].every(([dx, dz]) => this.world.heightAt(x + dx, z + dz) < limit);
  }

  startMission(type) {
    const wave = this.wave;
    const mission = { type, title: MISSION_TITLES[type], timer: null, targets: [], passed: 0 };
    if (type === "strike" || type === "antiship") {
      const ships = type === "antiship";
      const site = ships
        ? this.findSite((x, z) => this.openWater(x, z), 380, 1300, 1400)
        : this.findSite((x, z, terrain) => this.dryFlatGround(x, z, terrain), 320, 620, 500);
      if (!site) {
        // A dry world has no fleet to sink, so fall back to a strike; failing that, a plain wave.
        return ships ? this.startMission("strike") : false;
      }
      if (ships) {
        const count = Math.min(4, 2 + Math.floor(wave / 8));
        for (let i = 0; i < count; i += 1) {
          const spot = site.clone().add(new THREE.Vector3(THREE.MathUtils.randFloatSpread(90), 0, THREE.MathUtils.randFloatSpread(90)));
          if (this.world.heightAt(spot.x, spot.z) < this.world.seaLevel - 3) {
            mission.targets.push(this.addEnemy("ship", spot.setY(this.world.seaLevel), Math.random() * Math.PI * 2));
          }
        }
        if (mission.targets.length === 0) {
          mission.targets.push(this.addEnemy("ship", site.setY(this.world.seaLevel), Math.random() * Math.PI * 2));
        }
        mission.timer = 150;
        mission.reward = 2000 + 250 * wave;
        this.waveQueue = Array.from({ length: Math.round((2 + Math.floor(wave / 4)) * this.difficulty.enemies) }, () => "rammer");
      } else {
        const heading = Math.random() * Math.PI * 2;
        for (let i = 0; i < 4; i += 1) {
          const spot = site.clone().add(new THREE.Vector3(Math.sin(heading) * (i - 1.5) * 12, 0, Math.cos(heading) * (i - 1.5) * 12));
          mission.targets.push(this.addEnemy("truck", spot.setY(this.world.heightAt(spot.x, spot.z)), heading));
        }
        for (let i = 0; i < 3; i += 1) {
          const angle = (i / 3) * Math.PI * 2;
          const spot = site.clone().add(new THREE.Vector3(Math.cos(angle) * 34, 0, Math.sin(angle) * 34));
          const terrain = this.world.heightAt(spot.x, spot.z);
          if (terrain > this.world.seaLevel + 1) {
            mission.targets.push(this.addEnemy("turret", spot.setY(terrain)));
          }
        }
        mission.timer = 120;
        mission.reward = 1500 + 250 * wave;
        this.waveQueue = Array.from({ length: Math.round((1 + Math.floor(wave / 3)) * this.difficulty.enemies) }, () => "gunner");
      }
      mission.site = site;
      for (const target of mission.targets) {
        target.persistent = true;
      }
    } else if (type === "escort") {
      const forward = this.forwardFlat();
      const lateral = new THREE.Vector3(-forward.z, 0, forward.x);
      const start = this.player.mesh.position.clone().addScaledVector(forward, 110).addScaledVector(lateral, 30);
      start.y = Math.max(start.y, this.groundAt(start.x, start.z) + 50);
      const destination = start.clone().addScaledVector(forward, 1500).addScaledVector(lateral, THREE.MathUtils.randFloatSpread(600));
      this.transport = new Transport(start, destination);
      this.transport.mesh.rotation.y = Math.atan2(forward.x, forward.z);
      this.scene.add(this.transport.mesh);
      mission.reward = 2000 + 300 * wave;
      const count = Math.round((4 + Math.floor(wave / 2)) * this.difficulty.enemies);
      this.waveQueue = Array.from({ length: count }, (_, i) => (i % 3 === 2 ? "gunner" : "rammer"));
    } else if (type === "race") {
      this.spawnRaceRings();
      mission.timer = 55;
      mission.reward = 1500 + 200 * wave;
      this.waveQueue = [];
    } else if (type === "boss") {
      const forward = this.forwardFlat();
      const position = this.player.mesh.position.clone().addScaledVector(forward, 480);
      position.y = Math.min(this.groundAt(position.x, position.z) + 85, PLAYER_CONFIG.maxAltitude - 20);
      this.boss = new Boss(position, Math.atan2(-forward.x, -forward.z));
      this.scene.add(this.boss.mesh);
      for (const mount of BOSS_MOUNTS) {
        const part = this.addEnemy(mount.kind, position.clone());
        part.mount = mount.offset;
        part.persistent = true;
        part.countsForWave = false;
        part.armored = mount.kind === "bossEngine";
        this.boss.parts.push(part);
      }
      this.boss.placeParts();
      mission.reward = 3000 * Math.ceil(wave / 5);
      mission.maxHealth = this.boss.parts.reduce((sum, part) => sum + part.config.health, 0);
      this.waveQueue = Array.from({ length: Math.round(2 * this.difficulty.enemies) }, () => "gunner");
    }
    this.mission = mission;
    this.hud.showBanner(mission.title, this.missionBrief(mission));
    return true;
  }

  missionBrief(mission) {
    return {
      strike: "Destroy the convoy and its flak guns",
      antiship: "Sink every enemy warship",
      escort: "Keep the green transport alive until it lands",
      race: `Fly through all ${RACE_RINGS} blue rings before time runs out`,
      boss: "Knock out the guns, then the engines",
    }[mission.type];
  }

  spawnRaceRings() {
    const position = this.player.mesh.position.clone();
    let yaw = this.player.mesh.rotation.y;
    for (let i = 0; i < RACE_RINGS; i += 1) {
      yaw += THREE.MathUtils.randFloatSpread(0.7);
      const step = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(i === 0 ? 220 : 165);
      position.add(step);
      let ground = -Infinity;
      for (const [dx, dz] of [[0, 0], [24, 0], [-24, 0], [0, 24], [0, -24]]) {
        ground = Math.max(ground, this.groundAt(position.x + dx, position.z + dz));
      }
      position.y = Math.min(ground + THREE.MathUtils.randFloat(24, 55), PLAYER_CONFIG.maxAltitude - 20);
      const ring = new Ring(position, yaw, 0x55ffff);
      ring.race = true;
      this.rings.push(ring);
      this.scene.add(ring.mesh);
    }
  }

  // Returns "success", "fail" or null while the mission is still running.
  updateMission(delta) {
    const mission = this.mission;
    if (mission.timer !== null) {
      mission.timer -= delta;
    }
    let done = false;
    if (mission.type === "strike" || mission.type === "antiship") {
      done = mission.targets.every((target) => !target.alive);
    } else if (mission.type === "race") {
      done = mission.passed >= RACE_RINGS;
    } else if (mission.type === "escort") {
      const transport = this.transport;
      transport.update(delta, this.world);
      if (transport.health <= 0) {
        transport.alive = false;
        this.effects.explosion(transport.mesh.position, 0xff9357, true);
        this.audio.playExplosion(transport.mesh.position, "large");
        return "fail";
      }
      done = transport.arrived;
    } else if (mission.type === "boss") {
      this.updateBoss(delta);
      done = this.boss.crashed;
    }
    if (done) {
      return "success";
    }
    return mission.timer !== null && mission.timer <= 0 ? "fail" : null;
  }

  endMission(success) {
    const mission = this.mission;
    let bonus = 0;
    if (success) {
      bonus = mission.reward;
      if (mission.timer !== null) {
        bonus += Math.round(mission.timer) * 20;
      }
      if (mission.type === "escort") {
        bonus += this.transport.health * 100;
      }
      bonus = this.scaled(bonus);
      this.score += bonus;
      this.hud.showBanner("MISSION COMPLETE", `${mission.title} +${bonus}`);
      this.audio.playWaveClear();
    } else {
      this.hud.showBanner("MISSION FAILED", "No bonus - get ready for the next one");
      this.audio.playDenied();
    }
    // Leftover targets stay in the world but no longer hold up the next stage.
    for (const target of mission.targets) {
      target.countsForWave = false;
      target.persistent = false;
    }
    this.rings = this.rings.filter((ring) => {
      if (ring.race) {
        this.disposeObject(ring.mesh);
        return false;
      }
      return true;
    });
    if (this.transport) {
      this.disposeObject(this.transport.mesh);
      this.transport = null;
    }
    if (this.boss) {
      this.disposeObject(this.boss.mesh);
      this.boss = null;
    }
    this.waveQueue = [];
    this.mission = null;
    this.waveActive = false;
    this.waveTimer = WAVE_CONFIG.intermission + 2;
  }

  updateBoss(delta) {
    const boss = this.boss;
    boss.update(delta, this.world, this.player.mesh.position);
    const guns = boss.parts.filter((part) => part.kind === "bossGun" && part.alive).length;
    const engines = boss.parts.filter((part) => part.kind === "bossEngine" && part.alive).length;
    if (boss.phase === "guns" && guns === 0) {
      boss.phase = "engines";
      for (const part of boss.parts) {
        if (part.kind === "bossEngine") {
          part.armored = false;
          for (const glow of part.glows) {
            glow.material.color.setHex(0xff7a2a).multiplyScalar(5);
          }
        }
      }
      this.hud.showBanner("ENGINES EXPOSED", "The fortress is launching drones!");
      this.audio.playWaveStart();
    }
    if (boss.phase === "engines") {
      boss.droneTimer -= delta;
      if (boss.droneTimer <= 0) {
        boss.droneTimer = 11;
        for (let i = 0; i < 2; i += 1) {
          const spot = boss.mesh.position.clone().add(new THREE.Vector3(THREE.MathUtils.randFloatSpread(30), -14, THREE.MathUtils.randFloatSpread(30)));
          const drone = this.addEnemy("rammer", spot);
          drone.countsForWave = false;
        }
      }
      if (engines === 0) {
        boss.phase = "falling";
        boss.velocity.y = 0;
        this.hud.showBanner("FORTRESS GOING DOWN!", "");
        this.shake = Math.max(this.shake, 1);
      }
    }
    if (boss.phase === "falling") {
      boss.smokeTimer = (boss.smokeTimer ?? 0) - delta;
      if (boss.smokeTimer <= 0) {
        boss.smokeTimer = 0.12;
        this.effects.smoke(boss.randomHullPoint(), true);
        if (Math.random() < 0.35) {
          const point = boss.randomHullPoint();
          this.effects.explosion(point, 0xff9357, Math.random() < 0.3);
          this.audio.playExplosion(point);
        }
      }
      if (boss.crashed) {
        const center = boss.mesh.position;
        for (let i = 0; i < 9; i += 1) {
          this.effects.explosion(boss.randomHullPoint(), i % 2 ? 0xffd257 : 0xff5b2a, true);
        }
        this.effects.flash(center, 0xffb060, 30000, 0.6);
        this.splashIfSea(center);
        this.audio.playExplosion(center, "large");
        this.shake = Math.max(this.shake, 1.6);
      }
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
      this.addEnemy(kind, candidate);
      return true;
    }
    return false;
  }

  addEnemy(kind, position, heading = null) {
    const enemy = new EnemyPlane(kind, position, this.difficulty);
    if (heading !== null) {
      enemy.mesh.rotation.y = heading;
    }
    // In an escort most of the attackers go for the transport rather than the player.
    if (this.transport?.alive && this.mission?.type === "escort" && !enemy.isStatic && Math.random() < 0.6) {
      enemy.target = this.transport;
    }
    this.enemies.push(enemy);
    this.scene.add(enemy.mesh);
    return enemy;
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
        if (ring.race && this.mission?.type === "race") {
          this.mission.passed += 1;
        }
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
    // Fog shortens how far the seeker can see.
    const fog = THREE.MathUtils.clamp((this.atmosphere.weather.state.fog - 1) / 4.5, 0, 1);
    const lockRange = MISSILE_CONFIG.lockRange * (1 - 0.45 * fog);
    for (const enemy of this.enemies) {
      if (!enemy.alive) {
        continue;
      }
      const offset = enemy.mesh.position.clone().sub(player.mesh.position);
      const distance = offset.length();
      if (distance > lockRange) {
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
    if (enemy.armored) {
      // Rounds spark off the engine armour until the guns are gone.
      this.effects.flash(enemy.mesh.position, 0xbfe4ff, 300, 0.05);
      return;
    }
    enemy.health -= amount;
    this.hud.hitMarker();
    if (enemy.health > 0) {
      this.audio.playHitMarker();
      this.effects.smoke(enemy.mesh.position, true);
      return;
    }
    enemy.alive = false;
    const points = this.scaled(enemy.config.score);
    this.score += points;
    const large = ["ace", "turret", "ship", "bossGun", "bossEngine"].includes(enemy.kind);
    this.effects.explosion(enemy.mesh.position, 0xff9357, large);
    if (enemy.kind === "ship") {
      this.effects.splash(enemy.mesh.position.clone());
    }
    if (enemy.kind.startsWith("boss")) {
      this.hud.showToast(enemy.kind === "bossGun" ? "GUN DOWN!" : "ENGINE DOWN!", points, 1);
      this.shake = Math.max(this.shake, 0.6);
    }
    this.audio.playKill(enemy.mesh.position);
  }

  updateEnemies(delta) {
    const player = this.player;
    const engaged = this.state === GAME_STATES.FLYING;
    this.enemies = this.enemies.filter((enemy) => {
      const target = enemy.target?.alive ? enemy.target : player;
      const shot = enemy.update(delta, target, this.world);
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
      const lost = !enemy.persistent && distance > (enemy.isStatic ? 1400 : 650);
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
        } else if (this.transport?.alive && projectile.mesh.position.distanceTo(this.transport.mesh.position) < this.transport.radius) {
          projectile.alive = false;
          this.transport.health -= 1;
          this.effects.smoke(projectile.mesh.position, false);
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

      if (this.transport?.alive && !enemy.isStatic && enemy.mesh.position.distanceTo(this.transport.mesh.position) < enemy.radius + this.transport.radius) {
        enemy.alive = false;
        this.effects.explosion(enemy.mesh.position, 0xff5b5b);
        this.audio.playExplosion(enemy.mesh.position);
        this.transport.health -= 2;
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
    const rammedBoss = this.boss && this.state === GAME_STATES.FLYING && this.boss.contains(player.mesh.position);
    if (!rammedBoss && !this.world.collide(player.mesh.position, player.radius, PLAYER_CONFIG.collisionVerticalRadius)) {
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
    player.health = player.maxHealth;
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
      const before = this.career;
      this.career += this.score;
      store("career", this.career);
      this.unlockedNow = AIRCRAFT.filter((plane) => plane.unlock > before && plane.unlock <= this.career).map((plane) => plane.name);
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

  lightningRisk() {
    const player = this.player;
    return this.atmosphere.weather.state.storm > 0.6 && player.mesh.position.y - player.groundLevel > LIGHTNING_HEIGHT && this.weatherFlies();
  }

  weatherFlies() {
    return this.mode === "combat" || this.settings.weatherFlight;
  }

  // Wind drifts the plane, rain and storms shake it, and high flight in a storm draws lightning.
  applyWeather(delta) {
    if (!this.weatherFlies()) {
      return;
    }
    const player = this.player;
    const weather = this.atmosphere.weather;
    const { rain, storm } = weather.state;
    const position = player.mesh.position;
    position.x += weather.wind.x * 1.6 * delta;
    position.z += weather.wind.y * 1.6 * delta;

    const rough = Math.min(1, storm + rain * 0.35 + this.atmosphere.inCloud * 0.3);
    const gust = this.gust;
    gust.timer -= delta;
    if (gust.timer <= 0) {
      gust.timer = THREE.MathUtils.randFloat(0.25, 0.6);
      gust.rollTarget = THREE.MathUtils.randFloatSpread(2);
      gust.liftTarget = THREE.MathUtils.randFloatSpread(2);
    }
    gust.roll = THREE.MathUtils.damp(gust.roll, gust.rollTarget, 4, delta);
    gust.lift = THREE.MathUtils.damp(gust.lift, gust.liftTarget, 4, delta);
    if (rough > 0.05 && !player.stunt) {
      player.mesh.rotation.z += gust.roll * rough * 1.4 * delta;
      position.y += gust.lift * rough * 7 * delta;
      this.shake = Math.max(this.shake, rough * 0.12);
    }

    if (this.lightningRisk()) {
      this.lightningTimer -= delta;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = THREE.MathUtils.randFloat(12, 24);
        weather.strike(this.camera.position, position);
        this.effects.flash(position, 0xd8e6ff, 20000, 0.25);
        this.hud.showBanner("LIGHTNING STRIKE!", `Stay below ${LIGHTNING_HEIGHT} m in a storm`);
        this.damagePlayer(1);
      }
    }
  }

  objectiveState() {
    const mission = this.mission;
    if (!mission || this.state === GAME_STATES.GAME_OVER) {
      return null;
    }
    const clock = mission.timer !== null ? ` - ${Math.max(0, Math.ceil(mission.timer))}s` : "";
    if (mission.type === "strike" || mission.type === "antiship") {
      const left = mission.targets.filter((target) => target.alive).length;
      return { title: mission.title, detail: `${left} of ${mission.targets.length} targets left${clock}` };
    }
    if (mission.type === "race") {
      return { title: mission.title, detail: `Rings ${mission.passed}/${RACE_RINGS}${clock}` };
    }
    if (mission.type === "escort" && this.transport) {
      const transport = this.transport;
      return {
        title: mission.title,
        detail: `Route ${Math.round(transport.progress * 100)}% - transport hull ${Math.max(0, transport.health)}/${transport.maxHealth}`,
        ratio: Math.max(0, transport.health) / transport.maxHealth,
      };
    }
    if (mission.type === "boss" && this.boss) {
      const health = this.boss.parts.reduce((sum, part) => sum + (part.alive ? Math.max(0, part.health) : 0), 0);
      const phase = { guns: "Destroy the guns - engines are armoured", engines: "Engines exposed - take them out", falling: "Going down!" }[this.boss.phase];
      return { title: mission.title, detail: phase, ratio: health / mission.maxHealth };
    }
    return null;
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
      if (this.lightningRisk()) {
        return "LIGHTNING - FLY LOWER";
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
      const point = this.radarPoint(ring.mesh.position, ring.race ? "raceRing" : "ring");
      if (point) {
        contacts.push(point);
      }
    }
    if (this.mission?.site && this.mission.targets.some((target) => target.alive)) {
      contacts.push(this.radarPoint(this.mission.site, "goal", true));
    }
    if (this.transport) {
      contacts.push(this.radarPoint(this.transport.mesh.position, "ally", true));
      contacts.push(this.radarPoint(this.transport.destination, "goal", true));
    }

    this.hud.update({
      stateLabel: this.state.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase(),
      hint: this.hintText(),
      speed: player.speed,
      altitude: player.mesh.position.y - this.groundAt(player.mesh.position.x, player.mesh.position.z),
      health: player.health,
      maxHealth: player.maxHealth,
      score: this.score,
      best: Math.max(this.best, this.score),
      wave: this.mode === "free" ? "Free flight" : this.wave === 0 ? "-" : this.waveActive ? `${this.wave}${this.mission ? ` (${this.mission.type === "boss" ? "boss" : "mission"})` : ""}` : `${this.wave} (cleared)`,
      missiles: player.missiles,
      maxMissiles: player.maxMissiles,
      boost: player.boost,
      throttle: player.throttle,
      objective: this.objectiveState(),
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
