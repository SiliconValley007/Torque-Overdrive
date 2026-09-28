/* TORQUE OVERDRIVE - simulation core (pure logic, no DOM). Works in browser + Node. */
(function (root) {
  "use strict";
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (t) => t * t * (3 - 2 * t);
  const G = 330,
    DT = 1 / 240,
    MU_TIRE = 1.5,
    PXM = 33;

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* 1D seeded Perlin gradient noise, range ~[-1,1] */
  function makeNoise(rnd) {
    const P = new Uint8Array(512),
      g = new Float32Array(256),
      perm = [];
    for (let i = 0; i < 256; i++) {
      perm.push(i);
      g[i] = rnd() * 2 - 1;
    }
    for (let i = 255; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0,
        t = perm[i];
      perm[i] = perm[j];
      perm[j] = t;
    }
    for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
    return (x) => {
      const xi = Math.floor(x),
        xf = x - xi;
      const a = g[P[xi & 255]],
        b = g[P[(xi + 1) & 255]];
      const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
      return (a * xf + (b * (xf - 1) - a * xf) * u) * 2;
    };
  }

  /* ---------------- biomes ---------------- */
  const BIOMES = [
    {
      id: "hills",
      name: "Countryside Hills",
      g: 1,
      mu: 1.0,
      drag: 1,
      cap: 0.7,
      amp: 0.7,
      freq: 1,
      sky: ["#4fb6f5", "#d9f2ff"],
      far: ["#8fc7a6", "#6fae8b"],
      top: "#7bd14f",
      dirt: ["#8a5f36", "#4b311b"],
      deco: "#4f9a35",
      sun: "#fff6c2",
    },
    {
      id: "desert",
      name: "Desert Dunes",
      g: 1,
      mu: 0.85,
      drag: 1.4,
      cap: 0.6,
      amp: 0.8,
      freq: 0.6,
      sky: ["#f6a45a", "#ffe7b8"],
      far: ["#e2a56a", "#cf8f57"],
      top: "#f2d089",
      dirt: ["#d9a55b", "#8f5f2c"],
      deco: "#b9853f",
      sun: "#fff0b0",
    },
    {
      id: "arctic",
      name: "Arctic Ice",
      g: 1,
      mu: 0.3,
      drag: 0.6,
      cap: 0.22,
      amp: 0.42,
      freq: 0.8,
      sky: ["#7fa7d6", "#e8f4ff"],
      far: ["#b9d3ee", "#9dbddd"],
      top: "#ffffff",
      dirt: ["#9fd4f0", "#4d86b3"],
      deco: "#dff3ff",
      sun: "#ffffff",
    },
    {
      id: "moon",
      name: "Moon (Low Gravity)",
      g: 0.38,
      mu: 0.9,
      drag: 0.15,
      cap: 0.55,
      amp: 0.65,
      freq: 0.9,
      craters: 1,
      sky: ["#04040d", "#1a1740"],
      far: ["#3a3a55", "#2b2b45"],
      top: "#c9c9d6",
      dirt: ["#8b8b9c", "#4a4a5a"],
      deco: "#6e6e82",
      sun: "#cfe6ff",
      stars: 1,
    },
    {
      id: "mud",
      name: "Swamp Mud",
      g: 1,
      mu: 0.9,
      drag: 2.5,
      cap: 0.3,
      amp: 0.5,
      freq: 1.1,
      sky: ["#7f9a6b", "#cfe0b5"],
      far: ["#6d8a5a", "#587649"],
      top: "#6b5b2f",
      dirt: ["#5d4526", "#2f2313"],
      deco: "#3f4d24",
      sun: "#f3f1c0",
    },
  ];

  /* ---------------- vehicles ---------------- */
  const VEHICLES = [
    {
      id: "bike",
      name: "Classic Stunt Bike",
      price: 0,
      mass: 10,
      inertia: 2400,
      wb: 52,
      wr: 12,
      wm: 2,
      torque: 23000,
      wmax: 58,
      ks: 1100,
      cs: 95,
      susL: 15,
      ay: 6,
      drive: [1, 0],
      hip: [-9, -13],
      grip: [17, -16],
      peg: [-2, 6],
      torso: 20,
      body: [
        [-30, -6],
        [32, -8],
        [0, 12],
      ],
      color: "#dc2626",
    },
    {
      id: "jeep",
      name: "4x4 Hill Climber",
      price: 350,
      mass: 18,
      inertia: 6800,
      wb: 80,
      wr: 16,
      wm: 3.5,
      torque: 47000,
      wmax: 40,
      ks: 2600,
      cs: 210,
      susL: 18,
      ay: 10,
      drive: [0.6, 0.6],
      hip: [-8, -20],
      grip: [16, -22],
      peg: [10, 2],
      torso: 19,
      body: [
        [-46, -8],
        [48, -8],
        [0, 14],
      ],
      color: "#2f9e44",
    },
    {
      id: "quad",
      name: "High-Speed Quad",
      price: 700,
      mass: 12,
      inertia: 3200,
      wb: 60,
      wr: 13,
      wm: 2.4,
      torque: 30000,
      wmax: 78,
      ks: 1500,
      cs: 125,
      susL: 15,
      ay: 6,
      drive: [1, 0],
      hip: [-10, -15],
      grip: [18, -18],
      peg: [2, 4],
      torso: 20,
      body: [
        [-38, -6],
        [40, -6],
        [0, 12],
      ],
      color: "#f59f00",
    },
  ];

  /* ---------------- procedural terrain ---------------- */
  function Terrain(seed, biome) {
    const rnd = mulberry32(seed ^ 0x9e3779b9),
      noise = makeNoise(rnd);
    const DX = 10,
      T = this;
    T.seed = seed;
    T.biome = biome;
    T.DX = DX;
    T.ys = [0];
    T.ss = [0];
    T.n = 1;
    T.items = [];
    T.itemI = 0;
    T.nextFuel = 1100;
    /* max_slope = atan(min(0.5*mu, T/(m g r))) so every hill is climbable by the weakest stock vehicle */
    const v0 = VEHICLES[0],
      tqClimb =
        (v0.torque * Math.max(v0.drive[0], v0.drive[1])) /
        (v0.mass * G * v0.wr);
    const cap = (T.cap = Math.min(
      biome.cap,
      0.5 * MU_TIRE * biome.mu,
      tqClimb,
    ));
    const DS_MAX = 0.02; // max slope change per sample -> min curvature radius ~500px (no acute valleys)
    T.dsMax = DS_MAX;
    const f1 = (0.0007 + rnd() * 0.0007) * biome.freq,
      f2 = f1 * (2.1 + rnd() * 0.6),
      f3 = f1 * (4.3 + rnd() * 1.2);
    const o1 = rnd() * 1000,
      o2 = rnd() * 1000,
      o3 = rnd() * 1000,
      A = biome.amp * (0.85 + rnd() * 0.3);
    const craters = [];
    if (biome.craters) {
      let cx = 900;
      for (let i = 0; i < 4000; i++) {
        const w = 140 + rnd() * 140;
        craters.push({
          c: cx,
          w,
          d: Math.min(50 + rnd() * 110, w * cap * 0.5),
        });
        cx += 900 + rnd() * 1300;
      }
    }
    let s = 0,
      y = 0,
      ci = 0;
    const irnd = mulberry32(seed ^ 0x51ed270b);
    T.extend = function (toX) {
      while (T.n * DX < toX) {
        const x = T.n * DX,
          dif = 0.45 + 0.55 * clamp(x / 7000, 0, 1);
        let st =
          A *
          (noise(x * f1 + o1) +
            0.5 * noise(x * f2 + o2) +
            0.22 * noise(x * f3 + o3)) *
          dif;
        if (biome.craters) {
          while (
            ci < craters.length - 1 &&
            craters[ci].c + craters[ci].w * 3 < x
          )
            ci++;
          const cr = craters[ci],
            u = (x - cr.c) / cr.w;
          if (Math.abs(u) < 3)
            st += cr.d * Math.exp(-u * u) * ((-2 * u) / cr.w);
        }
        st -= 0.0009 * y; // mean reversion keeps the course inside a band
        st *= smooth(clamp((x - 400) / 500, 0, 1)); // flat start runway
        st = clamp(st, -cap, cap);
        s += clamp(st - s, -DS_MAX, DS_MAX);
        s = clamp(s, -cap, cap);
        y += s * DX;
        T.ys.push(y);
        T.ss.push(s);
        T.n++;
      }
      while (T.itemI + 100 <= T.n - 40) genItems(T.itemI, T.itemI + 100);
    };
    function genItems(a, b) {
      const out = [],
        ys = T.ys;
      const put = (t, x, yy) => out.push({ t, x, y: yy, on: 1 });
      for (let i = Math.max(a, 16); i < b; i++) {
        if (i < 45) continue;
        let crest = true;
        for (let k = -15; k <= 15; k++)
          if (k && ys[i + k] < ys[i]) {
            crest = false;
            break;
          }
        if (crest && ys[i - 15] - ys[i] > 25 && ys[i + 15] - ys[i] > 25) {
          const cx = i * DX,
            cy = ys[i],
            gold = irnd() < 0.2;
          for (let j = -3; j <= 3; j++)
            put(
              gold && j === 0 ? 2 : 0,
              cx + j * 36,
              cy - 45 - 42 * (1 - (j / 3) * (j / 3)),
            );
          if (irnd() < 0.3) put(1, cx, cy - 150); // risky airborne fuel
          i += 20;
        }
      }
      if (irnd() < 0.75) {
        // ground trail
        const n = 4 + ((irnd() * 5) | 0),
          i0 = a + 10 + ((irnd() * 60) | 0);
        for (let k = 0; k < n; k++) {
          const ii = i0 + k * 3;
          put(0, ii * DX, ys[ii] - 30);
        }
      }
      while (T.nextFuel < b * DX) {
        // guaranteed-reachable fuel: on the road, spaced 1500-2100px
        const i = Math.round(T.nextFuel / DX);
        put(1, i * DX, ys[i] - 30);
        T.nextFuel += 1500 + irnd() * 600;
      }
      out.sort((p, q) => p.x - q.x);
      for (const it of out) T.items.push(it);
      T.itemI = b;
    }
    /* Catmull-Rom (visual) + linear (physics). Linear T.y keeps contact deterministic. */
    T.y = function (x) {
      if (x < 0) x = 0;
      const f = x / DX,
        i = f | 0,
        t = f - i;
      if (i + 1 >= T.n) T.extend(x + 3000);
      return T.ys[i] + (T.ys[i + 1] - T.ys[i]) * t;
    };
    T.crY = function (x) {
      if (x < 0) x = 0;
      if (x / DX + 3 >= T.n) T.extend(x + 3000);
      const f = x / DX,
        i = Math.max(1, Math.min(T.n - 3, f | 0)),
        t = f - (f | 0);
      const y0 = T.ys[i - 1],
        y1 = T.ys[i],
        y2 = T.ys[i + 1],
        y3 = T.ys[i + 2];
      const t2 = t * t,
        t3 = t2 * t;
      return (
        0.5 *
        (2 * y1 +
          (-y0 + y2) * t +
          (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 +
          (-y0 + 3 * y1 - 3 * y2 + y3) * t3)
      );
    };
    T.slope = function (x) {
      const i = Math.max(0, (x / DX) | 0);
      if (i + 1 >= T.n) T.extend(x + 3000);
      return T.ss[i + 1] !== undefined ? T.ss[i + 1] : 0;
    };
    /* circle-vs-polyline contact. out: {hit,nx,ny,d} (normal points out of ground) */
    T.contact = function (px, py, r, out) {
      const i0 = Math.max(0, Math.floor((px - r) / DX) - 1),
        i1 = Math.floor((px + r) / DX) + 1;
      if (i1 + 2 >= T.n) T.extend(px + 3000);
      const ys = T.ys;
      let best = -1e9;
      out.hit = 0;
      for (let i = i0; i <= i1; i++) {
        const ax = i * DX,
          ay = ys[i],
          ey = ys[i + 1] - ay,
          L2 = DX * DX + ey * ey,
          L = Math.sqrt(L2);
        const t = clamp(((px - ax) * DX + (py - ay) * ey) / L2, 0, 1);
        const wx = px - (ax + DX * t),
          wy = py - (ay + ey * t),
          d2 = wx * wx + wy * wy;
        if (d2 >= r * r) continue;
        const dist = Math.sqrt(d2),
          nx = ey / L,
          ny = -DX / L,
          side = wx * nx + wy * ny;
        let dd, mx, my;
        if (side >= 0) {
          if (dist > 1e-5 && (t <= 0 || t >= 1)) {
            mx = wx / dist;
            my = wy / dist;
          } else {
            mx = nx;
            my = ny;
          }
          dd = r - dist;
        } else {
          mx = nx;
          my = ny;
          dd = r + dist;
        }
        if (dd > best) {
          best = dd;
          out.hit = 1;
          out.nx = mx;
          out.ny = my;
          out.d = dd;
        }
      }
      return out.hit;
    };
    T.extend(3000);
  }

  /* 2-bone IK: joint position for limb A->target */
  function ik(ax, ay, tx, ty, l1, l2, bend, o) {
    let dx = tx - ax,
      dy = ty - ay,
      d = Math.hypot(dx, dy) || 1e-4;
    d = Math.min(d, l1 + l2 - 0.01);
    dx = (tx - ax) / (Math.hypot(tx - ax, ty - ay) || 1);
    dy = (ty - ay) / (Math.hypot(tx - ax, ty - ay) || 1);
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d),
      h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
    o.x = ax + dx * a - dy * h * bend;
    o.y = ay + dy * a + dx * h * bend;
  }
  /* rider pose in chassis-local coordinates (used by renderer, ragdoll spawn and head collision) */
  function riderPose(sim, o) {
    const d = sim.def,
      r = sim.rider,
      th = r.lean,
      Lt = d.torso * (1 - 0.1 * r.tuck);
    o.hipX = d.hip[0];
    o.hipY = d.hip[1] + r.tuck * 4;
    o.shX = o.hipX + Lt * Math.sin(th);
    o.shY = o.hipY - Lt * Math.cos(th);
    const nth = th * 0.6 + 0.1;
    o.headX = o.shX + 11 * Math.sin(nth);
    o.headY = o.shY - 11 * Math.cos(nth);
    o.gripX = d.grip[0];
    o.gripY = d.grip[1];
    o.pegX = d.peg[0];
    o.pegY = d.peg[1];
    const e = (o.e = o.e || {}),
      k = (o.k = o.k || {});
    const armBend = clamp(
      1 + r.tuck * 0.35 + Math.max(0, -th) * 0.2,
      0.7,
      1.35,
    );
    const legBend = clamp(1 + r.tuck * 0.5 + Math.max(0, th) * 0.18, 0.7, 1.4);
    ik(o.shX, o.shY, o.gripX, o.gripY, 11, 12, armBend, e);
    ik(o.hipX, o.hipY, o.pegX, o.pegY, 13, 13, legBend, k);
    return o;
  }

  /* ---------------- simulation ---------------- */
  function cloneVeh(v) {
    return {
      id: v.id,
      name: v.name,
      price: v.price,
      mass: v.mass,
      inertia: v.inertia,
      wb: v.wb,
      wr: v.wr,
      wm: v.wm,
      torque: v.torque,
      wmax: v.wmax,
      ks: v.ks,
      cs: v.cs,
      susL: v.susL,
      ay: v.ay,
      drive: v.drive.slice(),
      hip: v.hip.slice(),
      grip: v.grip.slice(),
      peg: v.peg.slice(),
      torso: v.torso,
      body: v.body.map((p) => p.slice()),
      color: v.color,
    };
  }
  function Sim(o) {
    this.seed = o.seed >>> 0;
    this.bi = o.biome;
    this.biome = BIOMES[o.biome];
    this.cnt = { hit: 0, nx: 0, ny: -1, d: 0 };
    this.cb = { hit: 0, nx: 0, ny: -1, d: 0 };
    this.pose = {};
    this.ev = null;
    this.T = new Terrain(this.seed, this.biome);
    this.bindVehicle(o.veh, o.up);
    this.reset();
  }
  const P = Sim.prototype;
  /* re-instantiate rigid body from a vehicle profile (mass, wheelbase, wheel radius, spring ks) */
  P.bindVehicle = function (vi, up) {
    const v = VEHICLES[vi | 0] || VEHICLES[0];
    this.veh = VEHICLES[vi | 0] ? vi | 0 : 0;
    this.def = cloneVeh(v);
    this.up = up ? up.slice() : [0, 0, 0, 0];
    this.g = G * this.biome.g;
    this.recalc();
  };
  P.recalc = function () {
    const d = this.def,
      u = this.up;
    this.st = {
      torque: d.torque * (1 + 0.1 * u[0]),
      wmax: d.wmax * (1 + 0.04 * u[0]),
      ks: d.ks * (1 + 0.1 * u[1]),
      cs: d.cs * (1 + 0.14 * u[1]),
      mu: MU_TIRE * (1 + 0.08 * u[2]) * this.biome.mu,
      tank: 100 * (1 + 0.2 * u[3]),
    };
    if (this.fuel !== undefined) this.fuel = Math.min(this.fuel, this.st.tank);
  };
  P.reset = function () {
    const d = this.def,
      T = this.T,
      x0 = 140,
      gy = T.y(x0);
    this.x = x0;
    this.a = 0;
    this.vx = 0;
    this.vy = 0;
    this.w = 0;
    this.y = gy - d.wr - d.susL - d.ay - 1;
    this.wh = [-1, 1].map((sx, i) => ({
      x: x0 + (sx * d.wb) / 2,
      y: gy - d.wr,
      vx: 0,
      vy: 0,
      om: 0,
      ang: 0,
      gr: 0,
      N: 0,
      slip: 0,
      s: d.susL,
      px: 0,
      py: 0,
      pang: 0,
    }));
    this.wh.forEach((w) => {
      w.px = w.x;
      w.py = w.y;
    });
    this.px = this.x;
    this.py = this.y;
    this.pa = this.a;
    this.fuel = this.st.tank;
    this.nitro = 100;
    this.coins = 0;
    this.dist = 0;
    this.maxX = x0;
    this.time = 0;
    this.thrS = 0;
    this.nitOn = 0;
    this.crashed = 0;
    this.over = "";
    this.overT = 0;
    this.rag = null;
    this.stall = 0;
    this.rider = { lean: 0, tuck: 0 };
    this.air = 0;
    this.airA = 0;
    this.iScan = 0;
    this.acc = 0;
    this.kmh = 0;
    this.milestone = 0;
    this.impact = 0;
    this.hopPre = 0;
    this.hopWas = 0;
  };
  P.emit = function (t, x, y, v) {
    if (this.ev) this.ev(t, x, y, v);
  };
  P.step = function (inp) {
    const dt = DT,
      d = this.def,
      s = this.st,
      g = this.g,
      T = this.T,
      M = d.mass,
      I = d.inertia,
      bio = this.biome;
    this.px = this.x;
    this.py = this.y;
    this.pa = this.a;
    for (const w of this.wh) {
      w.px = w.x;
      w.py = w.y;
      w.pang = w.ang;
    }
    const alive = !this.crashed,
      ca = Math.cos(this.a),
      sa = Math.sin(this.a);
    if (alive) this.time += dt;
    const thr = alive && this.fuel > 0 ? inp.thr : 0,
      brk = alive ? inp.brk : 0;
    const nit =
      alive && inp.nit && thr > 0 && this.nitro > 2 && this.fuel > 0 ? 1 : 0;
    const hop = alive ? (inp.hop ? 1 : 0) : 0;
    this.nitOn = nit;
    this.thrS += (thr - this.thrS) * Math.min(1, dt * 12);
    const fwd = this.vx * ca + this.vy * sa,
      reverse = brk && fwd < 30 && !thr;
    let tq = 0;
    if (alive)
      tq += (inp.lean || 0) * I * (this.wh[0].gr || this.wh[1].gr ? 11 : 12);
    /* wheels: engine / brake / rolling resistance */
    for (let i = 0; i < 2; i++) {
      const w = this.wh[i],
        share = d.drive[i],
        r = d.wr,
        Iw = 0.5 * d.wm * r * r;
      let Te = 0;
      if (share > 0) {
        if (thr) {
          const wm = s.wmax * (nit ? 1.35 : 1);
          Te =
            s.torque *
            share *
            this.thrS *
            (nit ? 2 : 1) *
            clamp(1 - w.om / wm, 0, 1);
        } else if (reverse)
          Te = -0.5 * s.torque * share * clamp(1 + w.om / (0.4 * s.wmax), 0, 1);
      }
      w.om += (Te / Iw) * dt;
      tq -= Te * 0.85;
      if (brk && !reverse) {
        const dw =
          ((d.drive[i] > 0 && d.drive[1 - i] > 0 ? 9000 : 12000) / Iw) * dt;
        w.om = w.om > 0 ? Math.max(0, w.om - dw) : Math.min(0, w.om + dw);
      }
      const rr = (5 + 10 * (bio.drag - 1 > 0 ? bio.drag - 1 : 0)) * dt;
      w.om = w.om > 0 ? Math.max(0, w.om - rr) : Math.min(0, w.om + rr);
    }
    if (nit) this.nitro = Math.max(0, this.nitro - 30 * dt);
    else
      this.nitro = Math.min(
        100,
        this.nitro + (3.5 + 0.09 * (100 - this.nitro)) * dt,
      );
    /* forces */
    let fx = 0,
      fy = M * g;
    const sp = Math.hypot(this.vx, this.vy),
      kd = 0.00012 * bio.drag * M * sp;
    fx -= kd * this.vx;
    fy -= kd * this.vy;
    const nX = -sa,
      nY = ca,
      tX = ca,
      tY = sa,
      L = d.susL * (1 - 0.42 * this.hopPre),
      smin = 0.3 * d.susL,
      smax = 1.25 * d.susL;
    for (let i = 0; i < 2; i++) {
      const w = this.wh[i],
        lx = ((i ? 1 : -1) * d.wb) / 2,
        rx = lx * ca - d.ay * sa,
        ry = lx * sa + d.ay * ca;
      const ax = this.x + rx,
        ay = this.y + ry,
        dx = w.x - ax,
        dy = w.y - ay;
      const sN = dx * nX + dy * nY,
        e = dx * tX + dy * tY;
      const rvx = w.vx - (this.vx - this.w * ry),
        rvy = w.vy - (this.vy + this.w * rx);
      const rn = rvx * nX + rvy * nY,
        rt = rvx * tX + rvy * tY;
      let Fa = -s.ks * (sN - L) - s.cs * rn;
      if (sN < smin) Fa -= 9000 * (sN - smin) + 40 * rn * (rn < 0 ? 1 : 0);
      else if (sN > smax) Fa -= 6000 * (sN - smax);
      const Fl = -26000 * e - 240 * rt,
        Fx = Fa * nX + Fl * tX,
        Fy = Fa * nY + Fl * tY;
      w.s = sN;
      w.vx += (Fx / d.wm) * dt;
      w.vy += (Fy / d.wm + g) * dt;
      fx -= Fx;
      fy -= Fy;
      tq -= rx * Fy - ry * Fx;
    }
    this.vx += (fx / M) * dt;
    this.vy += (fy / M) * dt;
    this.w += (tq / I) * dt;
    const air = !(this.wh[0].gr || this.wh[1].gr);
    this.w /= 1 + (air ? 0.55 : 1.6) * dt;
    /* wheel-ground contact: normal + friction impulses */
    const cn = this.cnt;
    let land = 0;
    for (let i = 0; i < 2; i++) {
      const w = this.wh[i],
        r = d.wr,
        m = d.wm,
        Iw = 0.5 * m * r * r;
      w.gr = 0;
      w.N = 0;
      w.slip = 0;
      if (!T.contact(w.x, w.y, r, cn)) continue;
      const nx = cn.nx,
        ny = cn.ny,
        vn = w.vx * nx + w.vy * ny,
        vb = Math.min((0.2 * Math.max(cn.d - 0.3, 0)) / dt, 140);
      let jn = 0;
      if (vn < vb) {
        jn = m * (vb - vn);
        w.vx += (jn / m) * nx;
        w.vy += (jn / m) * ny;
      }
      if (vn < -120) land = Math.max(land, -vn);
      w.gr = 1;
      w.N = jn / dt;
      const tx = -ny,
        ty = nx,
        vc = w.vx * tx + w.vy * ty - w.om * r,
        K = 1 / m + (r * r) / Iw;
      let jt = -vc / K;
      const mx = s.mu * jn;
      jt = clamp(jt, -mx, mx);
      w.vx += (jt / m) * tx;
      w.vy += (jt / m) * ty;
      w.om -= (jt * r) / Iw;
      w.slip = Math.abs(vc);
    }
    if (land > 0) {
      this.impact = Math.max(this.impact, land);
      this.emit("land", this.wh[0].x, this.wh[0].y, land);
    }
    /* preload / bunny hop: hold compresses springs; release fires an upward impulse */
    const grounded = this.wh[0].gr || this.wh[1].gr;
    if (hop && grounded) this.hopPre = Math.min(1, this.hopPre + dt * 3.6);
    else if (hop) this.hopPre = Math.min(1, this.hopPre + dt * 1.2);
    if (this.hopWas && !hop) {
      if (this.hopPre > 0.12 && grounded) {
        const imp = 210 * this.hopPre;
        this.vy -= imp;
        this.wh[0].vy -= imp * 0.35;
        this.wh[1].vy -= imp * 0.35;
        this.emit("hop", this.x, this.y, this.hopPre);
      }
      this.hopPre = 0;
    }
    if (!hop) this.hopPre = Math.max(0, this.hopPre - dt * 4);
    this.hopWas = hop;
    /* chassis point contacts (tail/nose/belly rigid, head/roof = crash) */
    const pz = riderPose(this, this.pose),
      pts = d.body,
      cb = this.cb;
    for (let it = 0; it < 2; it++) {
      for (let k = 0; k < 5; k++) {
        let lx,
          ly,
          rad = 4,
          kind = 0;
        if (k < 3) {
          lx = pts[k][0];
          ly = pts[k][1];
        } else if (k === 3) {
          lx = pz.headX;
          ly = pz.headY;
          rad = 7;
          kind = 1;
        } else {
          lx = 0;
          ly = d.hip[1] - 4;
          rad = 5;
          kind = 2;
        }
        const rx = lx * ca - ly * sa,
          ry = lx * sa + ly * ca;
        if (!T.contact(this.x + rx, this.y + ry, rad, cb)) continue;
        if (kind === 1 && alive) this.crash("crash");
        if (kind === 2 && alive && Math.abs(Math.atan2(sa, ca)) > 1.9)
          this.crash("crash");
        const nx = cb.nx,
          ny = cb.ny,
          vpx = this.vx - this.w * ry,
          vpy = this.vy + this.w * rx,
          vn = vpx * nx + vpy * ny;
        const vb = Math.min((0.2 * Math.max(cb.d - 0.5, 0)) / dt, 120);
        if (vn >= vb) continue;
        const rn = rx * ny - ry * nx,
          Kn = 1 / M + (rn * rn) / I,
          jn = (vb - vn) / Kn;
        if (vn < -160) this.emit("thud", this.x + rx, this.y + ry, -vn);
        this.vx += (jn * nx) / M;
        this.vy += (jn * ny) / M;
        this.w += (rn * jn) / I;
        const tx = -ny,
          ty = nx,
          vt = (this.vx - this.w * ry) * tx + (this.vy + this.w * rx) * ty;
        const rt = rx * ty - ry * tx,
          Kt = 1 / M + (rt * rt) / I,
          mx = 0.5 * bio.mu * jn,
          jt = clamp(-vt / Kt, -mx, mx);
        this.vx += (jt * tx) / M;
        this.vy += (jt * ty) / M;
        this.w += (rt * jt) / I;
      }
    }
    /* integrate */
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.a += this.w * dt;
    for (const w of this.wh) {
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      w.ang += w.om * dt;
    }
    if (this.x < 20) {
      this.x = 20;
      if (this.vx < 0) this.vx = 0;
    }
    for (const w of this.wh)
      if (w.x < 12) {
        w.x = 12;
        if (w.vx < 0) w.vx = 0;
      }
    /* rider articulation: throttle leans forward, brake/tuck, wheelie leans back, landings compress */
    const R = this.rider,
      wc = ((d.susL - (this.wh[0].s + this.wh[1].s) / 2) / d.susL) * 1.4;
    const wheelie = this.wh[0].gr && !this.wh[1].gr ? 1 : 0;
    const stoppie = this.wh[1].gr && !this.wh[0].gr ? 1 : 0;
    const tl =
      0.32 * this.thrS +
      0.45 * (inp.lean || 0) -
      0.28 * wheelie +
      0.22 * (brk ? 1 : 0) +
      0.12 * stoppie;
    R.lean += (tl - R.lean) * Math.min(1, dt * 7);
    R.tuck = Math.max(
      R.tuck - dt * 2.5,
      clamp(wc, 0, 1),
      clamp(land / 280, 0, 1),
      clamp(this.impact / 520, 0, 0.85),
      this.hopPre,
    );
    /* bookkeeping */
    if (alive) {
      this.fuel = Math.max(
        0,
        this.fuel - (0.7 + 2.4 * this.thrS + (nit ? 3 : 0)) * dt,
      );
      this.maxX = Math.max(this.maxX, this.x);
      this.dist = (this.maxX - 140) / PXM;
      this.kmh = Math.hypot(this.vx, this.vy) * 0.11;
      if (air) {
        this.air += dt;
        this.airA += this.w * dt;
      } else {
        if (this.air > 0.35) {
          const fl = Math.floor(Math.abs(this.airA) / (TAU * 0.85));
          if (fl > 0) {
            this.coins += 10 * fl;
            this.emit("flip", this.x, this.y, fl);
          }
        }
        this.air = 0;
        this.airA = 0;
      }
      if (this.fuel <= 0 && Math.hypot(this.vx, this.vy) < 12) {
        this.stall += dt;
        if (this.stall > 2) this.finish("out of fuel");
      } else this.stall = 0;
      if (Math.floor(this.dist / 500) > this.milestone) {
        this.milestone = Math.floor(this.dist / 500);
        this.coins += 25 * this.milestone;
        this.emit("mile", this.x, this.y, this.milestone);
      }
      this.pickups();
    } else {
      this.stepRag();
      this.overT += dt;
      if (this.overT > 1.5 && !this.over) this.finish("crashed");
    }
    this.impact *= 0.98;
  };
  P.finish = function (why) {
    if (!this.over) {
      this.over = why;
      this.emit("over", this.x, this.y, 0);
    }
  };
  P.pickups = function () {
    const it = this.T.items,
      px = this.x,
      ca = Math.cos(this.a),
      sa = Math.sin(this.a);
    while (this.iScan < it.length && it[this.iScan].x < px - 900) this.iScan++;
    for (let i = this.iScan; i < it.length && it[i].x < px + 300; i++) {
      const o = it[i];
      if (!o.on) continue;
      let hit = false;
      const rr = o.t === 1 ? 38 : 30;
      const dx = o.x - this.x,
        dy = o.y - this.y;
      if (dx * dx + dy * dy < rr * rr) hit = true;
      if (!hit)
        for (const w of this.wh) {
          const ex = o.x - w.x,
            ey = o.y - w.y;
          if (ex * ex + ey * ey < (rr - 4) * (rr - 4)) {
            hit = true;
            break;
          }
        }
      if (!hit) {
        const hx = this.x + this.pose.headX * ca - this.pose.headY * sa - o.x,
          hy = this.y + this.pose.headX * sa + this.pose.headY * ca - o.y;
        hit = hx * hx + hy * hy < 26 * 26;
      }
      if (hit) {
        o.on = 0;
        if (o.t === 1) {
          this.fuel = Math.min(this.st.tank, this.fuel + 55);
          this.emit("fuel", o.x, o.y, 0);
        } else {
          const v = o.t === 2 ? 5 : 1;
          this.coins += v;
          this.emit("coin", o.x, o.y, v);
        }
      }
    }
  };
  /* ---- 6-node verlet skeletal ragdoll: head, chest, pelvis, hand, knee, foot ---- */
  const RAG_C = [
    [0, 1, 11, 1],
    [1, 2, 20, 1],
    [1, 3, 24, 1],
    [2, 4, 15, 1],
    [4, 5, 15, 1],
    [0, 2, 31, 0.4],
    [1, 4, 33, 0.3],
    [2, 3, 36, 0.2],
    [2, 5, 29, 0.3],
  ];
  P.crash = function (why) {
    if (this.crashed) return;
    this.crashed = 1;
    this.impact = 400;
    const pz = riderPose(this, this.pose),
      ca = Math.cos(this.a),
      sa = Math.sin(this.a),
      dt = DT;
    const loc = [
      [pz.headX, pz.headY],
      [pz.shX, pz.shY],
      [pz.hipX, pz.hipY],
      [pz.e.x, pz.e.y],
      [pz.k.x, pz.k.y],
      [pz.pegX, pz.pegY],
    ];
    this.rag = loc.map((p, i) => {
      const rx = p[0] * ca - p[1] * sa,
        ry = p[0] * sa + p[1] * ca,
        x = this.x + rx,
        y = this.y + ry;
      const vx = this.vx - this.w * ry + (Math.random() - 0.5) * 80,
        vy = this.vy + this.w * rx - 40 * (i < 3 ? 1 : 0.3);
      return { x, y, px: x - vx * dt, py: y - vy * dt };
    });
    this.thrS = 0;
    this.emit("crash", this.x, this.y, 0);
  };
  P.stepRag = function () {
    const n = this.rag,
      dt = DT,
      g = this.g,
      T = this.T,
      out = this.cnt;
    for (const p of n) {
      const vx = (p.x - p.px) * 0.9985,
        vy = (p.y - p.py) * 0.9985;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy + g * dt * dt;
    }
    for (let it = 0; it < 6; it++) {
      for (const c of RAG_C) {
        const a = n[c[0]],
          b = n[c[1]],
          dx = b.x - a.x,
          dy = b.y - a.y,
          dd = Math.hypot(dx, dy) || 1e-4,
          df = ((dd - c[2]) / dd) * 0.5 * c[3];
        a.x += dx * df;
        a.y += dy * df;
        b.x -= dx * df;
        b.y -= dy * df;
      }
      for (let i = 0; i < 6; i++) {
        const p = n[i],
          rad = i === 0 ? 6 : 3.5;
        if (T.contact(p.x, p.y, rad, out)) {
          p.x += out.nx * out.d;
          p.y += out.ny * out.d;
          let vx = p.x - p.px,
            vy = p.y - p.py;
          const vn = vx * out.nx + vy * out.ny;
          if (vn < 0) {
            vx -= 1.25 * vn * out.nx;
            vy -= 1.25 * vn * out.ny;
          }
          const tx = -out.ny,
            ty = out.nx,
            vt = vx * tx + vy * ty;
          vx -= vt * tx * 0.12;
          vy -= vt * ty * 0.12;
          p.px = p.x - vx;
          p.py = p.y - vy;
        }
      }
    }
  };
  /* terrain validator: slope cap, curvature limit, fuel spacing. returns list of problems */
  function validate(T, upToX) {
    const bad = [],
      ss = T.ss,
      ys = T.ys;
    T.extend(upToX + 3000);
    const n = Math.min(T.n - 1, Math.floor(upToX / T.DX));
    for (let i = 1; i < n; i++) {
      if (Math.abs(ss[i]) > T.cap + 1e-9) bad.push("slope@" + i);
      if (Math.abs(ss[i] - ss[i - 1]) > T.dsMax + 1e-9) bad.push("curv@" + i);
      if (!isFinite(ys[i])) bad.push("nan@" + i);
    }
    let last = 0;
    for (const it of T.items)
      if (it.t === 1 && it.y > ys[Math.round(it.x / T.DX)] - 40) {
        if (it.x - last > 2300 && it.x < upToX) bad.push("fuelgap@" + it.x);
        last = it.x;
      }
    return bad;
  }
  root.TOSim = {
    Sim,
    Terrain,
    BIOMES,
    VEHICLES,
    DT,
    G,
    PXM,
    MU_TIRE,
    mulberry32,
    riderPose,
    validate,
    clamp,
  };
  if (typeof module !== "undefined") module.exports = root.TOSim;
})(typeof window !== "undefined" ? window : globalThis);
