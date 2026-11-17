export const GAME_STATES = {
  START: "start",
  TAXI: "taxi",
  TAKEOFF: "takeoff",
  FLYING: "flying",
  LANDING: "landing",
  GAME_OVER: "gameOver",
};

export const PLAYER_CONFIG = {
  taxiAcceleration: 18,
  drag: 1.8,
  turnRateGround: 0.9,
  turnRateAir: 0.9,
  rollRate: 2.8,
  pitchRate: 1.5,
  yawRateMouse: 1.1,
  minTakeoffSpeed: 38,
  maxTaxiSpeed: 72,
  maxFlySpeed: 64,
  climbStrength: 16,
  gravity: 7,
  minAltitude: 2,
  safeGroundAltitude: 3.2,
  maxAltitude: 300,
  fireCooldown: 0.18,
  maxHealth: 5,
  takeoffRotateSpeed: 3.2,
  takeoffCommitSpeed: 42,
  takeoffLiftOffAltitude: 12,
  takeoffMinDuration: 1.15,
  takeoffPitchAngle: 0.35,
  takeoffPitchHold: 0.9,
  takeoffGroundRollTime: 0.55,
  takeoffLiftBlendTime: 0.65,
  collisionRadius: 2.8,
  collisionVerticalRadius: 1.5,
  mouseYawStrength: 2.2,
  mousePitchStrength: 1.4,
  obstacleImpactSpeed: 18,
  landingApproachSpeed: 34,
  landingTouchdownSpeed: 22,
  landingDescentRate: 10,
  landingRollBrake: 14,
  landingApproachAltitude: 26,
  landingVectorTime: 1.6,
  boostSpeed: 92,
  brakeSpeed: 30,
  boostDrain: 0.3,
  boostRegen: 0.14,
  maxMissiles: 4,
  manualLandingMaxSpeed: 58,
  manualLandingMaxSink: 22,
  landingRepairBonus: 400,
};

export const ENEMY_CONFIG = {
  spawnInterval: 2.4,
  collisionRadius: 2.8,
  bulletSpeed: 130,
  bulletLifetime: 2.6,
};

export const ENEMY_KINDS = {
  rammer: { health: 1, speed: 60, turn: 0.9, score: 100, fireInterval: 0, range: 0, scale: 1 },
  gunner: { health: 2, speed: 70, turn: 1.1, score: 250, fireInterval: 1.7, burst: 1, range: 230, scale: 1.1 },
  ace: { health: 4, speed: 82, turn: 1.5, score: 600, fireInterval: 1.5, burst: 3, range: 260, scale: 1.25 },
  turret: { health: 3, speed: 0, turn: 0, score: 300, fireInterval: 2.2, burst: 2, range: 300, scale: 1 },
  balloon: { health: 1, speed: 0, turn: 0, score: 75, fireInterval: 0, range: 0, scale: 1 },
};

export const MISSILE_CONFIG = {
  speed: 130,
  turn: 2.6,
  lifetime: 5,
  damage: 6,
  lockRange: 420,
  lockCone: 0.2,
  lockTime: 0.8,
  blastRadius: 7,
};

export const WAVE_CONFIG = {
  intermission: 5,
  clearBonus: 500,
  ringScore: 300,
  ringRadius: 11,
};

export const PROJECTILE_CONFIG = {
  speed: 95,
  lifetime: 2.4,
  collisionRadius: 1.5,
};

export const STUNT_CONFIG = {
  rollDuration: 0.7,
  loopDuration: 1.6,
  loopMinAltitude: 45,
  comboWindow: 4.5,
  maxCombo: 8,
  nearMissRadius: 16,
  trailInterval: 0.03,
  trailLife: 0.85,
  scores: {
    roll: 250,
    loop: 500,
    nearMiss: 150,
    ring: 300,
  },
};

export const WORLD_CONFIG = {
  runwayLength: 900,
  runwayWidth: 28,
  runwayHalfWidth: 14,
};
