import { GAME_STATES } from "./constants.js";
import { EnemyPlane } from "../entities/EnemyPlane.js";
import { landmarkInCell } from "../world/TerrainGen.js";

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
    // High enough that no seed's hills lie across the straight line ahead.
    game.player.mesh.position.y += 250;
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

  // Missions start from the stage before them, high above the terrain so the plane can fly straight.
  const startStage = (wave) => {
    takeOff();
    game.player.mesh.position.y += 250;
    game.wave = wave - 1;
    game.waveTimer = 0;
    run(0.1);
    game.waveQueue.length = 0;
    return game.mission;
  };

  check("faster plane cruises faster", () => {
    const savedPlane = game.player.skin;
    const cruise = (skin) => {
      game.player.setSkin(skin);
      takeOff();
      game.player.mesh.position.y += 250;
      run(10);
      return game.player.speed;
    };
    const jet = cruise("f16");
    const biplane = cruise("brickbiplane");
    game.player.setSkin(savedPlane);
    return { passed: jet > biplane * 1.3, detail: `f16 ${jet.toFixed(1)}, biplane ${biplane.toFixed(1)}` };
  });

  check("throttle holds a cruise speed", () => {
    takeOff();
    game.player.mesh.position.y += 250;
    game.player.throttle = 0;
    run(10);
    const slow = game.player.speed;
    game.player.throttle = 1;
    run(10);
    const fast = game.player.speed;
    run(2);
    const steady = Math.abs(game.player.speed - fast) < 1;
    return { passed: fast > slow + 20 && steady, detail: `${slow.toFixed(1)} -> ${fast.toFixed(1)}` };
  });

  check("strike mission completes", () => {
    const mission = startStage(7);
    if (mission?.type !== "strike") {
      return { passed: false, detail: `stage ${mission?.type ?? "plain wave"}` };
    }
    const before = game.score;
    for (const target of mission.targets) {
      target.alive = false;
    }
    run(0.2);
    return { passed: !game.mission && !game.waveActive && game.score > before, detail: `${mission.targets.length} targets` };
  });

  check("race mission counts rings", () => {
    const mission = startStage(2);
    if (mission?.type !== "race") {
      return { passed: false, detail: `stage ${mission?.type}` };
    }
    const position = game.player.mesh.position;
    for (const ring of game.rings.filter((item) => item.race)) {
      position.copy(ring.mesh.position).addScaledVector(ring.normal, -3);
      game.updateRings();
      position.copy(ring.mesh.position).addScaledVector(ring.normal, 3);
      game.updateRings();
    }
    const passed = mission.passed;
    run(0.2);
    return { passed: passed === 8 && !game.mission, detail: `rings ${passed}` };
  });

  check("escort fails when the transport is lost", () => {
    const mission = startStage(4);
    if (mission?.type !== "escort") {
      return { passed: false, detail: `stage ${mission?.type}` };
    }
    game.transport.health = 0;
    run(0.2);
    return { passed: !game.mission && !game.transport, detail: "transport destroyed" };
  });

  check("boss falls once its engines are gone", () => {
    const mission = startStage(5);
    if (mission?.type !== "boss") {
      return { passed: false, detail: `stage ${mission?.type}` };
    }
    const boss = game.boss;
    const engines = boss.parts.filter((part) => part.kind === "bossEngine");
    game.damageEnemy(engines[0], 100);
    const armored = engines[0].alive;
    for (const part of boss.parts.filter((item) => item.kind === "bossGun")) {
      game.damageEnemy(part, 100);
    }
    run(0.2);
    const exposed = boss.phase === "engines";
    for (const engine of engines) {
      game.damageEnemy(engine, 100);
    }
    const down = run(20, () => !game.mission);
    return { passed: armored && exposed && down && !game.boss, detail: `armored ${armored}, exposed ${exposed}, down ${down}` };
  });

  check("a rammer that does not commit flies past", () => {
    takeOff();
    game.player.mesh.position.y += 250;
    const ahead = game.player.mesh.position.clone().addScaledVector(game.player.getShotDirection(), 220);
    const rammer = game.addEnemy("rammer", ahead);
    rammer.ramChance = 0;
    const health = game.player.health;
    let closest = Infinity;
    run(10, null, () => {
      closest = Math.min(closest, rammer.mesh.position.distanceTo(game.player.mesh.position));
    });
    return { passed: rammer.alive && game.player.health === health && closest < 60, detail: `closest ${closest.toFixed(1)}` };
  });

  check("repair kit restores a heart", () => {
    takeOff();
    game.player.mesh.position.y += 250;
    game.player.health = 2;
    const spot = game.player.mesh.position.clone().addScaledVector(game.player.getShotDirection(), 40);
    game.spawnPickup(spot);
    const healed = run(3, () => game.player.health === 3);
    return { passed: healed && game.pickups.length === 0, detail: `health ${game.player.health}` };
  });

  check("flying past a landmark discovers it once", () => {
    const saved = game.atlas.snapshot();
    try {
      takeOff();
      let landmark = null;
      for (let r = 1; r < 6 && !landmark; r += 1) {
        for (let i = -r; i <= r && !landmark; i += 1) {
          for (let j = -r; j <= r && !landmark; j += 1) {
            landmark = landmarkInCell(i, j);
          }
        }
      }
      if (!landmark) {
        return { passed: false, detail: "no landmark nearby" };
      }
      game.atlas.restore({ places: [], kinds: [] });
      const focus = { x: landmark.x, y: 0, z: landmark.z };
      for (let i = 0; i < 40; i += 1) {
        game.world.updateLandmarks(focus);
      }
      game.player.mesh.position.set(landmark.x, game.groundAt(landmark.x, landmark.z) + 120, landmark.z);
      const before = game.score;
      game.discoveryTimer = 0;
      game.checkDiscoveries(0.1);
      const gained = game.score - before;
      game.discoveryTimer = 0;
      game.checkDiscoveries(0.1);
      const again = game.score - before - gained;
      const known = game.atlas.has(`${landmark.type}:${landmark.x}:${landmark.z}`);
      return { passed: known && gained >= 1000 && again === 0, detail: `${landmark.type} +${gained}, repeat +${again}` };
    } finally {
      game.atlas.restore(saved);
    }
  });

  game.mode = savedMode;
  game.reset();
  const failed = results.filter((result) => !result.passed).length;
  console.table(results);
  console.log(failed ? `SELF TEST: ${failed} of ${results.length} FAILED` : `SELF TEST: all ${results.length} passed`);
  return { passed: failed === 0, results };
}
