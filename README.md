# TORQUE OVERDRIVE

2D dirt-bike trials. Sequential-impulse rigid-body solver at 240 Hz: chassis plus two wheels on spring-damper fork / swingarm (`F = -k x - c v`), friction-limited tyres, real wheel torque, articulated rider skeleton (head, torso, upper/lower arms, legs with IK), 11-node verlet ragdoll, collapsing bridge on revolute hinges, catapult pads, loop, gaps, checkpoints.

Works on desktop, laptop, tablet, iPhone and Android. A touch overlay (Throttle, Brake, Lean L/R, Overtorque, Preload, Retry) appears on coarse-pointer devices. Physics is fixed-step and deterministic, so it plays identically on every device; rendering is interpolated. Particles are object-pooled (160).

## Physics

- **Slope roll**: when throttle is released, gravity wins if `sin(theta) > mu_static * cos(theta)`. Tangential accel is `a = g sin(theta) - mu g cos(theta)`. The bike rolls / slides down steep grades instead of locking.
- **Wheel spin**: `omega = v_tangential / wheel_radius`. Spokes spin clockwise going forward and counter-clockwise in reverse.
- **Overtorque (Shift / OT)**: meter charges to 100% (`Math.min(charge, 100)`). Engaged: 2.0x rear-wheel torque, raised RPM limit, fiery exhaust behind the rear wheel, screen shake, wider camera.
- **Rider**: multi-segment skeleton. Knees and elbows tuck under heavy drops, lean back on throttle / wheelies, tuck forward on downhills.
- **Hazards**: collapsing planks snap on revolute joints under load; catapult plates fire a vertical impulse; violent impacts spawn a ragdoll.

## Controls

| Input          | Action                                          |
| -------------- | ----------------------------------------------- |
| W / Up / GAS   | Throttle                                        |
| S / Down / BRK | Brake (hold at standstill to reverse)           |
| A / D / LEAN   | Pitch the bike / shift weight                   |
| Space / HOP    | Preload (hold) then release to hop              |
| Shift / OT     | Overtorque: 2x engine torque + higher rev limit |
| R / RTRY       | Retry from last checkpoint                      |
| Esc            | Pause                                           |

Gamepad: RT throttle, LT brake, stick lean, A hop, B overtorque, Start retry.

## Always-winnable

The course is deterministic (no random obstacles). `node tests/verify.js` checks slope roll, wheel omega binding, overtorque cap, suspension compression, catapults, bridge, ragdoll, and rider skeleton.

## Run

Keep `index.html` and `game.js` in the same folder. Open `index.html` or serve the folder:

```bash
python3 -m http.server 8000
```
