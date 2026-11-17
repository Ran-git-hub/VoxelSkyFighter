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

Add `?debug` to the URL to show a debug panel with frame rate, draw calls and chunk counts, and to expose `window.__game` in the console.

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
| H | Show / hide controls |
| Esc | Pause |
| Hold R | Restart |

On the runway, hold Shift to build speed, then press W to rotate. Landing slowly and lined up with the runway repairs the plane and earns a bonus.

## Features

- **World**: endlessly generated block terrain with plains, forest, desert, snowfields, mountains, taiga and ocean; villages, windmills, lighthouses, pyramids and towers as landmarks; flocks of birds, boats at sea, airport vehicles and chimney smoke.
- **Combat**: waves that grow tougher (rammers, gunships, aces, ground turrets, hot-air balloons), guns, lock-on homing missiles, and bonus points for stunts and rings.
- **Aircraft**: 9 to choose from, including 4 in a toy-brick style.
- **Visuals**: dynamic day and night with moon phases; clear, cloudy, rain, thunderstorm and fog weather (with automatic changes); god rays, lens flare, rainbows and aurora; water reflections, cascaded shadows, ambient occlusion, bloom, and relief and highlights on block materials.
- **Graphics quality**: low, medium, high and ultra presets, with resolution scaled automatically to hold the frame rate.

## Layout

```
index.html          Entry page
styles.css          UI styles
serve.py            Local development server
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
