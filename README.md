# Voxel Sky Fighter

**English** | [简体中文](README.zh-CN.md)

Fly over an endless block world: take off from the airfield, fight off wave after wave of enemy aircraft, thread the golden rings, then bring the plane home and land it.
The look stays blocky, but with close-to-realistic lighting, weather and water.

Runs entirely in the browser with no build step. Every texture, sound effect and piece of music is generated in code at runtime; the only dependency is [three.js](https://threejs.org/), loaded from a CDN.

## Running

You need Python 3 and a browser with WebGL 2.

```bash
python3 serve.py
```

Then open <http://localhost:8765/> and click to start.

`serve.py` turns off browser caching, so after editing the code a page refresh picks up the change. Any static file server works too, but it may serve stale copies of the modules.

Add `?debug` to the URL to show a debug panel with frame rate, draw calls and chunk counts, and to expose `window.__game` in the console. `?debug&selftest` also fast-forwards through take-off, combat, a wave, autoland, a crash and free flight, and prints the results to the console (or call `__game.selfTest()`).

`serve.py` also answers `/api/leaderboard` with an in-memory stand-in, so the leaderboard works locally; its scores vanish when the server stops.

## Modes

- **Start Mission**: fight wave after wave. When you go down, your score is sent to the leaderboard.
- **Free Flight**: no enemies and no game over; crashing just puts you back in the air.
- **World seed**: type a number on the title screen (or press Random) for a different world. The seed is also in the URL (`?seed=123`), so a world can be shared as a link.
- **Photo mode**: press **O** in flight to freeze the action and fly a free camera; **K** saves a PNG.

## Leaderboard

Each browser gets a random arcade-style pilot name (it can be rerolled on the title screen). The board keeps every pilot's best score, with the wave reached, the world seed and the date, and shows the world top 10.

Scores are stored by the serverless function in `api/leaderboard.js`, which needs an [Upstash Redis](https://vercel.com/marketplace/upstash) database connected to the Vercel project (it reads `KV_REST_API_URL` and `KV_REST_API_TOKEN`). Without one, or when offline, the game falls back to a board of this browser's own scores.

Scores are reported by the browser, so the server only rejects implausible values; it cannot stop a determined cheat.

## Controls

| Key | Action |
| --- | --- |
| Mouse | Steer (virtual stick) |
| W / S | Pitch up / down |
| A / D | Turn |
| Q / E | Rudder |
| Left click / Space | Guns |
| Right click / F | Missile (needs a lock) |
| Shift | Accelerate on the ground / afterburner in the air |
| B | Air brake |
| Z / C | Barrel roll |
| X | Loop |
| P | Autoland on / off |
| O | Photo mode (WASD move, Q/E down/up, wheel zoom, K save) |
| H | Show / hide controls |
| Esc | Pause |
| Hold R | Restart |

On the runway, hold Shift to build speed, then press W to rotate. Landing slowly and lined up with the runway repairs the plane and earns a bonus.

## Features

- **World**: endlessly generated block terrain with plains, forest, desert, snowfields, mountains, taiga and ocean; villages, windmills, lighthouses, pyramids and towers as landmarks; flocks of birds, boats at sea, airport vehicles and chimney smoke.
- **Combat**: waves that grow tougher (rammers, gunships, aces, ground turrets, hot-air balloons), guns, lock-on homing missiles, and bonus points for stunts and rings.
- **Aircraft**: 9 to choose from, including 4 in a toy-brick style.
- **Visuals**: dynamic day and night with moon phases; clear, cloudy, rain, thunderstorm and fog weather (with automatic changes); god rays, lens flare, rainbows and aurora; water reflections, cascaded shadows, ambient occlusion, bloom, and relief and highlights on block materials.
- **Graphics quality**: low, medium, high and ultra presets, with resolution scaled automatically to hold the frame rate. God rays, water reflections, rain and lightning, ambient life and speed effects can each be switched off.
- **Audio**: separate on/off switches and volume sliders for music and sound effects.

## Layout

```
index.html          Entry page
styles.css          UI styles
serve.py            Local development server (with a stand-in leaderboard API)
api/leaderboard.js  Vercel serverless function for the global leaderboard
src/
  main.js           Startup
  game/             Game loop, input, audio, post-processing, effects, constants
  entities/         Player plane, enemies, bullets and missiles, rings
  world/            Terrain generation, chunk meshing, sky, clouds, weather, water, buildings, ambient life
  ui/               HUD and debug panel
PLAN.md             First-phase improvement plan (done, in Chinese)
PLAN_V2.md          2.x release plan (in Chinese)
```

## License

[MIT](LICENSE)
