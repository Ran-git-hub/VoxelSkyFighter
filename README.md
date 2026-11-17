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

Add `?debug` to the URL to show a debug panel with frame rate, draw calls and chunk counts, and to expose `window.__game` in the console. `?debug&selftest` also fast-forwards through take-off, combat, a wave, autoland, a crash, free flight, plane handling, the missions and the boss, and prints the results to the console (or call `__game.selfTest()`).

`serve.py` also answers `/api/leaderboard` with an in-memory stand-in, so the leaderboard works locally; its scores vanish when the server stops.

## Modes

- **Start Mission**: a campaign of stages. Plain waves alternate with missions, and every fifth stage is a boss. When you go down, your score is sent to the leaderboard.
- **Free Flight**: no enemies and no game over; crashing just puts you back in the air.
- **World seed**: type a number on the title screen (or press Random) for a different world. The seed is also in the URL (`?seed=123`), so a world can be shared as a link.
- **Photo mode**: press **O** in flight to freeze the action and fly a free camera; **K** saves a PNG.

## Campaign

| Stage | What happens |
| --- | --- |
| 1, 3, 6, 8, ... | A wave of enemy aircraft, plus bonus rings and balloons |
| 2, 4, 7, 9, ... | A mission, rotating through the four below |
| 5, 10, 15, ... | Boss: the Sky Fortress airship |

- **Ground strike**: destroy a truck convoy and its flak guns before the timer runs out.
- **Ring race**: fly through 8 blue rings in time.
- **Escort**: keep the green transport alive until it reaches its destination; most attackers go for it, not you.
- **Sink the fleet**: sink every warship (a world with no sea nearby gets a ground strike instead).
- **Sky Fortress**: its guns can be shot off first; its engines stay armoured until the guns are gone, then it launches drones. Destroy both engines and it falls out of the sky.

A completed mission pays a bonus (more for time left, or for the transport's remaining hull); a failed one pays nothing and the campaign carries on.

**Difficulty** (Easy, Normal, Hard, in the Game settings) changes the number of enemies, how often and how accurately they fire, and your armour. Scores are scaled by 0.8, 1 and 1.3 to keep the board fair. A change takes effect from the next run.

**Weather** affects flight: wind drifts the plane, rain and storms shake it, a storm sends lightning at planes flying more than 100 m up (one heart per strike), and fog shortens the missile lock range. In Free Flight this can be switched off.

## Aircraft

Each plane has its own speed, turn rate, armour (hearts) and missile rack; pick one in the hangar on the title screen, which shows the comparison bars. Standard keeps the original handling.

New pilots start with Standard, Brick Biplane and Super Mario. The others unlock with career points, the total of all your mission scores: Air Show 5,000, Brick Seaplane 10,000, F-16 Style 20,000, Brick Jet 35,000, Brick Airliner 50,000, Brick Storm 75,000.

## Leaderboard

Each browser gets a random arcade-style pilot name (it can be rerolled on the title screen). Every finished mission is entered with its score, the wave reached, the world seed and the date; the board keeps only the ten highest, so one pilot can hold several places. Your runs show in green, and the run you just finished is highlighted.

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
| Wheel, T / G | Cruise throttle (stays where you leave it) |
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
- **Combat**: waves that grow tougher (rammers, gunships, aces, ground turrets, hot-air balloons), four mission types, a boss airship every five stages, guns, lock-on homing missiles, and bonus points for stunts and rings.
- **Aircraft**: 9 to choose from, including 4 in a toy-brick style, each with its own handling; most are unlocked by playing.
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
```

## License

[MIT](LICENSE)
