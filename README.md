# TORQUE OVERDRIVE

Endless, procedurally generated, Hill-Climb-Racing-style arcade physics game. Pure HTML5 Canvas, no dependencies, no build step. Runs in any modern browser (desktop, laptop, tablet, iPhone, Android).

**Deploy (GitHub Pages):** keep `index.html`, `sim.js`, and `game.js` at the site root and enable Pages from `main`. Optional `?seed=123` replays a specific track.

## Features

- **Procedural tracks** (seeded Perlin, 3 stacked octaves, new seed every run) in 5 biomes: Countryside, Desert, Arctic Ice (low friction), Moon (0.38 g, craters), Swamp Mud (high drag). Visual surface is Catmull-Rom interpolated; physics stays on the linear polyline for determinism.
- **Solvability guarantee:** `max_slope = atan(min(0.5*mu, T/(m g r)))` so every hill is climbable by the stock bike; slope change per sample is rate-limited (min curvature radius ~500 px, no wedging valleys), and `TOSim.validate()` checks it. Fuel cans are placed every 1500-2100 px on the road.
- **Fuel** (drains faster on throttle/nitro), **coins** on crest arcs and climbs, flip / 500 m bonuses.
- **Nitro (Shift / NITRO only):** 2.0x rear-wheel torque, raised RPM ceiling, fire particles, wider camera FOV, screen shake. Meter charges with a smooth catch-up curve.
- **Preload / bunny hop (Space / HOP only):** hold compresses both springs; release fires an upward impulse. Shift and Space are never shared.
- **Garage** (menu / pause / game over): 4 upgrades x 8 levels (Engine, Suspension, Tyre Grip, Fuel Tank). Selecting Classic Stunt Bike, 4x4 Hill Climber, or High-Speed Quad re-instantiates the rigid body from that profile (mass, wheelbase, wheel radius, spring stiffness, torque, drive layout) on the next run. Progress saved in `localStorage`.
- **Physics:** 240 Hz fixed step, spring-damper suspension, impulse tyre contact, `omega = v/r` rolling (clockwise forward, counter-clockwise reverse). Tangential gravity `g*sin(theta)` beats static friction so the bike rolls back down hills when throttle is released.
- **Rider:** IK-articulated limbs that flex on throttle, brake, wheelie, stoppie, and heavy landings. Dual coil springs compress with travel. Head or inverted-roof impact severs the rider into a 6-node verlet ragdoll.
- **Camera & juice:** speed-based FOV (zoom-out), landing / nitro screen shake (honours `prefers-reduced-motion`), pooled exhaust / dust / fire particles (320).
- **Controls (desktop):** W/Up gas, S/Down brake+reverse, A/D or Left/Right tilt, **Shift nitro**, **Space hop**, Esc/P pause, R restart, Enter to start.
- **Controls (touch):** auto-shown overlay on phones, tablets, and coarse pointers — Lean L/R, Nitro, Hop, Brake, Gas. Multi-touch pointer events; 44 px+ targets; safe-area insets for notched iPhones. Keyboard still works on hybrid devices.
- **Performance:** allocation-free hot loop, DPR capped at 2, adaptive resolution if frames exceed budget, auto-pause when the tab is hidden, iOS AudioContext unlock on first gesture.

`verify.js` covers terrain validity, wheel omega, hill roll-back, nitro, fuel, and ragdoll. `moon_bot.js` is a headless low-g drive check.
