#!/usr/bin/env node
/* Headless physics checks for TORQUE OVERDRIVE. */
"use strict";
const S = require("./sim.js");
let fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log("PASS  " + name);
  else {
    fails++;
    console.log("FAIL  " + name + (extra ? "  " + extra : ""));
  }
}
function drive(seed, biome, veh, steps, inp, up) {
  const sim = new S.Sim({ seed, biome, veh: veh || 0, up: up || [0, 0, 0, 0] });
  const input = Object.assign({ thr: 0, brk: 0, lean: 0, nit: 0, hop: 0 }, inp || {});
  for (let i = 0; i < steps; i++) sim.step(input);
  return sim;
}

/* terrain validity */
{
  for (const seed of [1, 42, 99991, 123456789]) {
    for (let bi = 0; bi < S.BIOMES.length; bi++) {
      const sim = new S.Sim({ seed, biome: bi, veh: 0, up: [0, 0, 0, 0] });
      const bad = S.validate(sim.T, 8000);
      ok("terrain seed=" + seed + " " + S.BIOMES[bi].id, bad.length === 0, bad.slice(0, 4).join(","));
    }
  }
}

/* wheel omega sign: throttle -> positive omega */
{
  const sim = drive(7, 0, 0, 240 * 2, { thr: 1 });
  ok("wheel omega forward", sim.wh[0].om > 1, "om=" + sim.wh[0].om.toFixed(3));
}

/* reverse omega */
{
  const sim = new S.Sim({ seed: 7, biome: 0, veh: 0, up: [0, 0, 0, 0] });
  for (let i = 0; i < 80; i++) sim.step({ thr: 1, brk: 0, lean: 0, nit: 0, hop: 0 });
  for (let i = 0; i < 400; i++) sim.step({ thr: 0, brk: 1, lean: 0, nit: 0, hop: 0 });
  ok("wheel omega reverse", sim.wh[0].om < 0, "om=" + sim.wh[0].om.toFixed(3));
}

/* hill roll-back: climb then coast, vx should turn downhill */
{
  let found = false,
    detail = "no steep sample";
  for (const seed of [3, 11, 77, 101, 404, 2026]) {
    const sim = new S.Sim({ seed, biome: 0, veh: 0, up: [0, 0, 0, 0] });
    sim.T.extend(4000);
    let peakI = 80,
      peak = sim.T.ys[80];
    for (let i = 40; i < 250; i++)
      if (sim.T.ys[i] < peak) {
        peak = sim.T.ys[i];
        peakI = i;
      }
    if (peakI < 50) continue;
    const x = peakI * sim.T.DX;
    const slope = sim.T.slope(x);
    sim.x = x;
    sim.y = sim.T.y(x) - sim.def.wr - sim.def.susL - sim.def.ay - 1;
    sim.vx = 8;
    sim.vy = 0;
    sim.w = 0;
    sim.a = Math.atan(slope);
    const ca = Math.cos(sim.a),
      sa = Math.sin(sim.a);
    for (let i = 0; i < 2; i++) {
      const w = sim.wh[i],
        lx = ((i ? 1 : -1) * sim.def.wb) / 2;
      w.x = sim.x + lx * ca;
      w.y = sim.T.y(w.x) - sim.def.wr;
      w.vx = 8;
      w.vy = 0;
      w.om = 8 / sim.def.wr;
    }
    for (let i = 0; i < 240 * 3; i++)
      sim.step({ thr: 0, brk: 0, lean: 0, nit: 0, hop: 0 });
    const along = sim.vx * ca + sim.vy * sa;
    if (slope < -0.08) {
      found = along < 2;
      detail = "along=" + along.toFixed(2) + " slope=" + slope.toFixed(3);
      ok("hill roll-back", found, detail);
      found = true;
      break;
    }
  }
  if (!found) ok("hill roll-back", false, detail);
}

/* nitro raises torque / speed vs stock */
{
  const a = drive(21, 0, 0, 240 * 3, { thr: 1, nit: 0 });
  const b = drive(21, 0, 0, 240 * 3, { thr: 1, nit: 1 });
  ok("nitro faster", b.x > a.x + 20, "x " + a.x.toFixed(1) + " vs " + b.x.toFixed(1));
  ok("nitro spends meter", b.nitro < 95, "nitro=" + b.nitro.toFixed(1));
}

/* fuel drains on throttle */
{
  const sim = drive(5, 0, 0, 240 * 4, { thr: 1 });
  ok("fuel drains", sim.fuel < sim.st.tank - 5, "fuel=" + sim.fuel.toFixed(2));
}

/* ragdoll on crash */
{
  const sim = new S.Sim({ seed: 9, biome: 0, veh: 0, up: [0, 0, 0, 0] });
  sim.crash("crash");
  ok("ragdoll spawn", !!(sim.rag && sim.rag.length === 6));
  const x0 = sim.rag.map((n) => n.x + n.y).join(",");
  for (let i = 0; i < 240; i++) sim.step({ thr: 0, brk: 0, lean: 0, nit: 0, hop: 0 });
  const x1 = sim.rag.map((n) => n.x + n.y).join(",");
  ok("ragdoll steps", x0 !== x1);
}

/* determinism same seed */
{
  function snap(seed) {
    const sim = drive(seed, 2, 0, 240 * 5, { thr: 1, lean: 0.2 });
    return [sim.x, sim.y, sim.a, sim.vx, sim.vy, sim.w, sim.fuel, sim.wh[0].om, sim.wh[1].om]
      .map((v) => v.toFixed(8))
      .join("|");
  }
  const A = snap(314159),
    B = snap(314159),
    C = snap(314160);
  ok("determinism same seed", A === B);
  ok("determinism different seed", A !== C);
}

if (fails) {
  console.log("\n" + fails + " failed");
  process.exit(1);
}
console.log("\nall checks passed");
