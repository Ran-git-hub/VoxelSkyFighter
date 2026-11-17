import { GAME_STATES } from "./constants.js";
import { EnemyPlane } from "../entities/EnemyPlane.js";

const STEP = 1 / 60;

// Fast-forward checks of the core loop, run with ?debug&selftest or __game.selfTest().
// Each case starts from a fresh run and drives the simulation directly, with no rendering.
export function runSelfTest(game) {
  const results = [];
  const keys = game.input.keys;

  const run = (seconds, until, each) => {
    for (let i = 0; i < seconds / STEP; i += 1) {
      each?.(i * STEP);
      game.simulate(STEP);
      game.effects.update(STEP);
      if (until?.()) {
        return true;
      }
    }
    return false;
  };

  const takeOff = () => {
    game.reset();
    game.startRun(game.mode);
    // No waves unless a case asks for one, so stray enemies cannot change the outcome.
    game.waveTimer = 1e9;
    keys.add("ShiftLeft");
    const flying = run(25, () => game.state === GAME_STATES.FLYING, (t) => {
      if (t > 5) {
        keys.add("KeyW");
      }
    });
    keys.clear();
    run(3);
    return flying;
  };

  const check = (name, test) => {
    const started = performance.now();
    let passed = false;
    let detail = "";
    try {
      const outcome = test();
      passed = outcome === true || outcome?.passed === true;
      detail = outcome?.detail ?? "";
    } catch (error) {
      detail = error.message;
    }
    keys.clear();
    results.push({ name, passed, detail, ms: Math.round(performance.now() - started) });
  };

  const savedMode = game.mode;
  game.mode = "combat";

  check("take off from the runway", () => takeOff());

  check("straight flight scores nothing", () => {
    takeOff();
    const before = game.score;
    run(20);
    return { passed: game.score === before && game.state === GAME_STATES.FLYING, detail: `score ${game.score - before}` };
  });

  check("guns destroy a target ahead", () => {
    takeOff();
    const player = game.player;
    const ahead = player.mesh.position.clone().addScaledVector(player.getShotDirection(), 70);
    const target = new EnemyPlane("balloon", ahead);
    game.enemies.push(target);
    game.scene.add(target.mesh);
    const scoreBefore = game.score;
    keys.add("Space");
    run(4, () => !target.alive);
    return { passed: !target.alive && game.score > scoreBefore, detail: `score +${game.score - scoreBefore}` };
  });

  check("wave starts and clears", () => {
    takeOff();
    game.waveTimer = 0;
    run(0.1);
    const started = game.waveActive && game.wave === 1;
    game.waveQueue.length = 0;
    for (const enemy of game.enemies) {
      enemy.alive = false;
    }
    const scoreBefore = game.score;
    run(1, () => !game.waveActive);
    return { passed: started && !game.waveActive && game.score > scoreBefore, detail: `wave ${game.wave}` };
  });

  check("autoland brings the plane home", () => {
    takeOff();
    run(10);
    game.toggleAutoLanding();
    const landed = run(180, () => game.state === GAME_STATES.TAXI);
    return { passed: landed, detail: `state ${game.state}` };
  });

  check("diving into the ground ends the run", () => {
    takeOff();
    game.input.flightTarget.y = 1;
    keys.add("KeyS");
    const dead = run(40, () => game.state === GAME_STATES.GAME_OVER);
    return { passed: dead, detail: `state ${game.state}` };
  });

  check("free flight respawns after a crash", () => {
    game.mode = "free";
    takeOff();
    const before = game.respawns;
    game.input.flightTarget.y = 1;
    keys.add("KeyS");
    const respawned = run(40, () => game.respawns > before);
    keys.clear();
    const passed = respawned && game.state === GAME_STATES.FLYING && game.enemies.length === 0;
    game.mode = "combat";
    return { passed, detail: `state ${game.state}, enemies ${game.enemies.length}` };
  });

  game.mode = savedMode;
  game.reset();
  const failed = results.filter((result) => !result.passed).length;
  console.table(results);
  console.log(failed ? `SELF TEST: ${failed} of ${results.length} FAILED` : `SELF TEST: all ${results.length} passed`);
  return { passed: failed === 0, results };
}
