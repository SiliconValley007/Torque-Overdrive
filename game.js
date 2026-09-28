(() => {
  "use strict";
  const C = document.getElementById("c"),
    X = C.getContext("2d", { alpha: false });
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2,
    PI = Math.PI;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp = (a, b, t) => a + (b - a) * t,
    hyp = Math.hypot;
  const smooth = (t) => t * t * (3 - 2 * t);
  const wrapPI = (a) => {
    a %= TAU;
    return a > PI ? a - TAU : a < -PI ? a + TAU : a;
  };

  /* ================= constants (world scale ~33 px per metre) ================= */
  const G = 330,
    DT = 1 / 240,
    MAXSTEPS = 20,
    ITER = 10;
  const WR = 12; // wheel radius
  const BETA = 0.2,
    SLOP = 0.4,
    MAXPUSH = 220; // contact solver
  const M_CH = 10,
    I_CH = 2600,
    M_W = 1.1,
    I_W = 0.65 * 1.1 * WR * WR;
  const T0 = 23000,
    W0 = 58,
    OT_MULT = 2.0,
    W0_OT = 92; // engine: torque at standstill, no-load wheel rad/s
  const KD = 0.0032; // aero drag
  const BRAKE_R = 9000,
    BRAKE_F = 13000,
    ROLL_RES = 16,
    ENG_BRAKE = 28;
  const LEAN_GND = 30000,
    LEAN_AIR = 9500,
    AIR_DAMP = 0.55,
    GND_ANG_DAMP = 0.6;
  const HOP_COMP = 6,
    HOP_KICK = 135;
  const OT_DRAIN = 0.42,
    OT_REGEN = 0.16,
    OT_MIN = 0.25;
  const MU_S = 0.22,
    MU_K = 0.14,
    MU_W = 0.85,
    MU_C = 0.5;
  const FUSE = 0.8; // bridge plank fuse (s)
  let coasting = 1,
    braking = 0;

  /* ================= state ================= */
  let W = 0,
    H = 0,
    DPR = 1,
    running = 0,
    t0 = 0,
    acc = 0,
    simT = 0,
    shake = 0,
    best = 0,
    alpha = 0;
  try {
    best = +localStorage.getItem("tod_best") || 0;
  } catch (e) {}
  const inp = { thr: 0, brk: 0, lean: 0, hop: 0, ot: 0, retry: 0 };
  const ZERO = { thr: 0, brk: 0, lean: 0, hop: 0, ot: 0 };
  let hopLock = 0;
  const keys = {};
  const touch = { thr: 0, brk: 0, leanL: 0, leanR: 0, hop: 0, ot: 0, retry: 0 };
  const cam = { x: 80, y: 380, z: 1 };

  /* ================= particles (pooled) ================= */
  const NP = 160,
    dust = Array.from({ length: NP }, () => ({
      a: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      s: 1,
      l: 0.4,
      c: 0,
    }));
  let di = 0;
  function emit(x, y, n, sp, c, dvx, dvy) {
    for (let i = 0; i < n; i++) {
      const p = dust[di++ % NP],
        a = Math.random() * TAU,
        s = (0.3 + Math.random()) * sp;
      p.a = 1;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s + (dvx || 0);
      p.vy = Math.sin(a) * s - 8 + (dvy || 0);
      p.s = 1.2 + Math.random() * 3;
      p.l = 0.3 + Math.random() * 0.55;
      p.c = c || 0;
    }
  }
  function stepParticles(h) {
    for (const p of dust) {
      if (p.a <= 0) continue;
      p.x += p.vx * h;
      p.y += p.vy * h;
      p.vy += (p.c ? -30 : 60) * h;
      p.vx *= 1 - 1.2 * h;
      p.a -= h / p.l;
      if (p.c) p.s += h * 6;
    }
  }

  /* ================= audio ================= */
  let AC = null,
    engOsc = null,
    engGain = null,
    engF = 80;
  function audioInit() {
    if (AC) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      AC = new Ctx();
      engOsc = AC.createOscillator();
      engOsc.type = "sawtooth";
      const f = AC.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 880;
      engGain = AC.createGain();
      engGain.gain.value = 0;
      engOsc.connect(f);
      f.connect(engGain);
      engGain.connect(AC.destination);
      engOsc.start();
    } catch (e) {
      AC = null;
      engOsc = null;
      engGain = null;
    }
  }
  function beep(f, d, t, g) {
    if (!AC) return;
    try {
      const o = AC.createOscillator(),
        gn = AC.createGain();
      o.type = t || "square";
      o.frequency.value = f;
      gn.gain.value = g || 0.07;
      gn.gain.exponentialRampToValueAtTime(
        0.0008,
        AC.currentTime + (d || 0.12),
      );
      o.connect(gn);
      gn.connect(AC.destination);
      o.start();
      o.stop(AC.currentTime + (d || 0.12));
    } catch (e) {}
  }

  /* ================= track ================= */
  const TRACK = {
    x: [],
    y: [],
    seg: [],
    nx: [],
    ny: [],
    n: 0,
    fin: 0,
    haz: [],
    cps: [],
    pl: [null],
    deathY: 0,
    minY: 0,
    maxY: 0,
  };
  function buildTrack() {
    const PX = TRACK.x,
      PY = TRACK.y,
      SG = TRACK.seg;
    PX.length = PY.length = SG.length = 0;
    TRACK.haz.length = 0;
    TRACK.cps.length = 0;
    TRACK.pl.length = 1;
    let cx = -560,
      cy = 420;
    const STEP = 8;
    const push = (x, y, s) => {
      if (PX.length) SG.push(s | 0);
      PX.push(x);
      PY.push(y);
    };
    push(cx, cy, 0);
    const flat = (L) => {
      const n = Math.max(1, Math.round(L / STEP)),
        x0 = cx;
      for (let i = 1; i <= n; i++) push(x0 + (L * i) / n, cy, 0);
      cx = x0 + L;
    };
    const ramp = (L, rise) => {
      const n = Math.max(2, Math.round(L / STEP)),
        x0 = cx,
        y0 = cy;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        push(x0 + L * t, y0 + rise * smooth(t), 0);
      }
      cx = x0 + L;
      cy = y0 + rise;
    };
    const gap = (w, dy) => {
      push(cx + w, cy + dy, -1);
      cx += w;
      cy += dy;
    };
    const cp = () => TRACK.cps.push({ x: cx - 60, y: cy });
    const pad = (w, power) => {
      TRACK.haz.push({ t: "cat", x: cx, w, y: cy, power, used: 0, anim: 0 });
      flat(w);
    };
    const bridge = (np, lp) => {
      const x0 = cx,
        y0 = cy;
      for (let k = 0; k < np; k++) {
        const id = TRACK.pl.length;
        TRACK.pl.push({
          id,
          x0: x0 + k * lp,
          x1: x0 + (k + 1) * lp,
          y: y0,
          state: 0,
          fuse: 0,
          body: null,
          seed: Math.random(),
        });
        push(x0 + (k + 1) * lp, y0, id);
      }
      cx = x0 + np * lp;
      TRACK.haz.push({ t: "bridge", x: x0, w: np * lp, y: y0 });
    };
    const loop = (R, h) => {
      const x0 = cx,
        y0 = cy,
        n = Math.ceil((TAU * R) / STEP);
      TRACK.haz.push({ t: "loop", x: x0, y: y0, R, h });
      for (let i = 1; i <= n; i++) {
        const t = (TAU * i) / n;
        push(x0 + R * Math.sin(t), y0 - R + R * Math.cos(t) - (h * t) / TAU, 0);
      }
      cx = x0;
      cy = y0 - h;
    };
    // ---- level layout (validated by tests/verify.js) ----
    flat(640);
    cp(); // start, CP0 at x=80
    ramp(260, -44);
    ramp(240, 30);
    ramp(220, -52);
    ramp(260, 44);
    flat(140);
    ramp(300, -70);
    flat(60);
    ramp(320, 110);
    flat(120);
    cp(); // CP1
    ramp(150, -40);
    gap(96, 34);
    ramp(170, 30);
    flat(300); // ramp jump
    pad(80, 285);
    gap(150, 0);
    flat(300);
    cp(); // catapult over pit, CP2
    flat(200);
    bridge(11, 30);
    flat(260); // collapsing bridge
    ramp(240, -60);
    ramp(240, 40);
    ramp(200, -50);
    ramp(240, 70);
    flat(80);
    cp(); // CP3
    ramp(200, 36);
    flat(620);
    loop(72, 30);
    flat(360); // loop
    ramp(240, -70);
    flat(160);
    cp();
    pad(80, 300);
    gap(150, -40);
    ramp(200, -30);
    flat(200);
    ramp(260, -50);
    ramp(260, 60);
    flat(200);
    TRACK.fin = cx;
    flat(360);
    // ---- derived data ----
    const n = PX.length;
    TRACK.n = n;
    let mn = 1e9,
      mx = -1e9;
    for (let i = 0; i < n; i++) {
      if (PY[i] < mn) mn = PY[i];
      if (PY[i] > mx) mx = PY[i];
    }
    TRACK.minY = mn;
    TRACK.maxY = mx;
    TRACK.deathY = mx + 420;
    const sn = (i) => {
      const dx = PX[i + 1] - PX[i],
        dy = PY[i + 1] - PY[i],
        L = hyp(dx, dy) || 1;
      return [dy / L, -dx / L];
    };
    TRACK.nx = new Array(n).fill(0);
    TRACK.ny = new Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      let ax = 0,
        ay = 0;
      for (const j of [i - 1, i]) {
        if (j >= 0 && j < n - 1 && SG[j] !== -1) {
          const [a, b] = sn(j);
          ax += a;
          ay += b;
        }
      }
      const L = hyp(ax, ay);
      if (L > 1e-6) {
        TRACK.nx[i] = ax / L;
        TRACK.ny[i] = ay / L;
      }
    }
  }
  const segSolid = (i) => {
    const s = TRACK.seg[i];
    return s === 0 ? true : s < 0 ? false : TRACK.pl[s].state < 2;
  };
  const Q = { d: 1e9, nx: 0, ny: -1, si: 0, ok: 0 };
  const QW = 26;
  function qg(px, py, si) {
    const PX = TRACK.x,
      PY = TRACK.y,
      ns = TRACK.n - 1;
    let i0 = si - QW,
      i1 = si + QW;
    if (i0 < 0) i0 = 0;
    if (i1 > ns - 1) i1 = ns - 1;
    let best = 1e18,
      bi = -1,
      bt = 0,
      bqx = 0,
      bqy = 0;
    for (let i = i0; i <= i1; i++) {
      if (!segSolid(i)) continue;
      const ax = PX[i],
        ay = PY[i],
        abx = PX[i + 1] - ax,
        aby = PY[i + 1] - ay,
        l2 = abx * abx + aby * aby || 1;
      let t = ((px - ax) * abx + (py - ay) * aby) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + abx * t,
        qy = ay + aby * t,
        dx = px - qx,
        dy = py - qy,
        d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        bi = i;
        bt = t;
        bqx = qx;
        bqy = qy;
      }
    }
    if (bi < 0) {
      Q.ok = 0;
      Q.d = 1e9;
      Q.nx = 0;
      Q.ny = -1;
      Q.si = si;
      return Q;
    }
    const abx = PX[bi + 1] - PX[bi],
      aby = PY[bi + 1] - PY[bi],
      L = hyp(abx, aby) || 1;
    const side = (px - bqx) * (aby / L) + (py - bqy) * (-abx / L),
      dist = Math.sqrt(best);
    let nx = TRACK.nx[bi] + (TRACK.nx[bi + 1] - TRACK.nx[bi]) * bt,
      ny = TRACK.ny[bi] + (TRACK.ny[bi + 1] - TRACK.ny[bi]) * bt;
    const nl = hyp(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    Q.ok = 1;
    Q.d = side >= 0 ? dist : -dist;
    Q.nx = nx;
    Q.ny = ny;
    Q.si = bi;
    return Q;
  }
  function groundAt(x, hint) {
    const PX = TRACK.x,
      PY = TRACK.y;
    let best = 1e9,
      by = 0,
      bi = 0;
    for (let i = 0; i < TRACK.n - 1; i++) {
      if (!segSolid(i)) continue;
      const x0 = PX[i],
        x1 = PX[i + 1];
      if (x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && x0 !== x1) {
        const t = (x - x0) / (x1 - x0),
          y = PY[i] + t * (PY[i + 1] - PY[i]);
        if (Math.abs(y - hint) < best) {
          best = Math.abs(y - hint);
          by = y;
          bi = i;
        }
      }
    }
    return { y: by, i: bi };
  }

  /* ================= rigid bodies & joints ================= */
  const mkBody = (m, I) => ({
    x: 0,
    y: 0,
    a: 0,
    vx: 0,
    vy: 0,
    w: 0,
    m,
    im: 1 / m,
    I,
    iI: 1 / I,
    px: 0,
    py: 0,
    pa: 0,
  });
  const B = {
    ch: mkBody(M_CH, I_CH),
    fw: mkBody(M_W, I_W),
    rw: mkBody(M_W, I_W),
    alive: 1,
    hopT: 0,
    otT: 1,
    otOn: 0,
    otLock: 0,
    air: 0,
    rc: 0,
    fc: 0,
    safe: 0,
    crashT: 0,
    fin: 0,
    cp: 0,
    cpTime: 0,
    tookCp: 0,
    stuckT: 0,
    invT: 0,
    lastImpact: 0,
    planks: [],
    ragdoll: null,
  };
  const mkJoint = (wh, lax, lay, ux, uy, s0, lo, hi, k, c) => ({
    wh,
    lax,
    lay,
    ux,
    uy,
    s0,
    lo,
    hi,
    k,
    c,
    jSpring: 0,
    jPerp: 0,
    jLo: 0,
    jHi: 0,
    rAx: 0,
    rAy: 0,
    axx: 0,
    axy: 0,
    ayx: 0,
    ayy: 0,
    sAx: 0,
    sAy: 0,
    mAx: 0,
    mAxial: 0,
    mPerp: 0,
    C: 0,
    gamma: 0,
    bias: 0,
    perpC: 0,
    s: 0,
    ext: 0,
  });
  const FORK_A = (27 * PI) / 180,
    SWING_A = -0.17;
  const J = {
    f: mkJoint(
      B.fw,
      13,
      2,
      Math.sin(FORK_A),
      Math.cos(FORK_A),
      26.94,
      26.94 - 10,
      26.94 + 6,
      420,
      120,
    ),
    r: mkJoint(
      B.rw,
      -14,
      3,
      SWING_A,
      Math.sqrt(1 - SWING_A * SWING_A),
      23.34,
      23.34 - 9,
      23.34 + 6,
      440,
      130,
    ),
  };
  // contact shapes: 0 rear wheel, 1 front wheel, 2 head, 3 belly, 4 tail, 5 nose
  const CT = [
    { b: B.rw, kind: 0, lx: 0, ly: 0, r: WR, mu: MU_W },
    { b: B.fw, kind: 0, lx: 0, ly: 0, r: WR, mu: MU_W },
    { b: B.ch, kind: 1, lx: 4, ly: -27, r: 5.5, mu: MU_C, head: 1 },
    { b: B.ch, kind: 1, lx: 0, ly: 11, r: 4, mu: MU_C },
    { b: B.ch, kind: 1, lx: -25, ly: -4, r: 3, mu: MU_C },
    { b: B.ch, kind: 1, lx: 25, ly: -6, r: 3, mu: MU_C },
  ].map((c) =>
    Object.assign(c, {
      jn: 0,
      jt: 0,
      on: 0,
      nx: 0,
      ny: -1,
      rcx: 0,
      rcy: 0,
      mN: 0,
      mT: 0,
      sep: 9,
      vn0: 0,
      si: 0,
      seg: 0,
    }),
  );

  function applyImp(b, jx, jy, rx, ry) {
    b.vx += jx * b.im;
    b.vy += jy * b.im;
    b.w += (rx * jy - ry * jx) * b.iI;
  }

  function prepJoint(j, h) {
    const ch = B.ch,
      wh = j.wh,
      ca = Math.cos(ch.a),
      sa = Math.sin(ch.a);
    j.rAx = ca * j.lax - sa * j.lay;
    j.rAy = sa * j.lax + ca * j.lay;
    j.axx = ca * j.ux - sa * j.uy;
    j.axy = sa * j.ux + ca * j.uy;
    j.ayx = -j.axy;
    j.ayy = j.axx;
    const dx = wh.x - ch.x,
      dy = wh.y - ch.y,
      ddx = dx - j.rAx,
      ddy = dy - j.rAy;
    j.sAx = dx * j.axy - dy * j.axx;
    j.sAy = dx * j.ayy - dy * j.ayx;
    const invX = ch.im + wh.im + ch.iI * j.sAx * j.sAx;
    j.mAx = 1 / invX;
    j.s = ddx * j.axx + ddy * j.axy;
    j.ext = j.s;
    j.C = j.s - (j.s0 - B.hopT * HOP_COMP);
    j.gamma = 1 / (h * (j.c + h * j.k));
    j.bias = j.C * h * j.k * j.gamma;
    j.mAxial = 1 / (invX + j.gamma);
    j.mPerp = 1 / (ch.im + wh.im + ch.iI * j.sAy * j.sAy);
    j.perpC = ddx * j.ayx + ddy * j.ayy;
  }
  function jointImp(j, lam, ax, ay, sA) {
    const ch = B.ch,
      wh = j.wh;
    ch.vx -= ch.im * lam * ax;
    ch.vy -= ch.im * lam * ay;
    ch.w -= ch.iI * lam * sA;
    wh.vx += wh.im * lam * ax;
    wh.vy += wh.im * lam * ay;
  }
  function warmJoint(j) {
    jointImp(j, j.jSpring + j.jLo - j.jHi, j.axx, j.axy, j.sAx);
    jointImp(j, j.jPerp, j.ayx, j.ayy, j.sAy);
  }
  function solveJoint(j, h) {
    const ch = B.ch,
      wh = j.wh;
    // spring / damper (soft constraint)
    let cd = (wh.vx - ch.vx) * j.axx + (wh.vy - ch.vy) * j.axy - j.sAx * ch.w;
    let lam = -j.mAxial * (cd + j.bias + j.gamma * j.jSpring);
    j.jSpring += lam;
    jointImp(j, lam, j.axx, j.axy, j.sAx);
    // lower travel limit (bump stop, compression)
    let Clo = j.s - j.lo;
    cd = (wh.vx - ch.vx) * j.axx + (wh.vy - ch.vy) * j.axy - j.sAx * ch.w;
    lam = -j.mAx * (cd + (Clo > 0 ? Clo / h : (BETA * Clo) / h));
    let nw = Math.max(j.jLo + lam, 0);
    lam = nw - j.jLo;
    j.jLo = nw;
    jointImp(j, lam, j.axx, j.axy, j.sAx);
    // upper travel limit (droop)
    let Chi = j.hi - j.s;
    cd = -((wh.vx - ch.vx) * j.axx + (wh.vy - ch.vy) * j.axy - j.sAx * ch.w);
    lam = -j.mAx * (cd + (Chi > 0 ? Chi / h : (BETA * Chi) / h));
    nw = Math.max(j.jHi + lam, 0);
    lam = nw - j.jHi;
    j.jHi = nw;
    jointImp(j, -lam, j.axx, j.axy, j.sAx);
    // keep wheel on the suspension axis
    cd = (wh.vx - ch.vx) * j.ayx + (wh.vy - ch.vy) * j.ayy - j.sAy * ch.w;
    lam = -j.mPerp * (cd + (0.25 * j.perpC) / h);
    j.jPerp += lam;
    jointImp(j, lam, j.ayx, j.ayy, j.sAy);
  }

  function buildContacts() {
    for (const c of CT) {
      const b = c.b;
      let px, py;
      if (c.kind) {
        const ca = Math.cos(b.a),
          sa = Math.sin(b.a);
        px = b.x + ca * c.lx - sa * c.ly;
        py = b.y + sa * c.lx + ca * c.ly;
      } else {
        px = b.x;
        py = b.y;
      }
      const q = qg(px, py, c.si);
      c.si = q.si;
      const sep = q.d - c.r;
      if (!q.ok || sep > 2.5) {
        if (c.on) {
          c.on = 0;
          c.jn = 0;
          c.jt = 0;
        }
        continue;
      }
      if (!c.on) {
        c.jn = 0;
        c.jt = 0;
      }
      c.on = 1;
      c.nx = q.nx;
      c.ny = q.ny;
      c.sep = sep;
      c.seg = q.si;
      c.rcx = px - b.x - q.nx * c.r;
      c.rcy = py - b.y - q.ny * c.r;
      const rn = c.rcx * q.ny - c.rcy * q.nx,
        tx = -q.ny,
        ty = q.nx,
        rt = c.rcx * ty - c.rcy * tx;
      c.mN = 1 / (b.im + b.iI * rn * rn);
      c.mT = 1 / (b.im + b.iI * rt * rt);
      c.vn0 = (b.vx - b.w * c.rcy) * q.nx + (b.vy + b.w * c.rcx) * q.ny;
    }
  }
  function warmContacts() {
    for (const c of CT) {
      if (!c.on) continue;
      const tx = -c.ny,
        ty = c.nx;
      applyImp(
        c.b,
        c.nx * c.jn + tx * c.jt,
        c.ny * c.jn + ty * c.jt,
        c.rcx,
        c.rcy,
      );
    }
  }
  function solveContacts(h) {
    for (const c of CT) {
      if (!c.on) continue;
      const b = c.b,
        nx = c.nx,
        ny = c.ny,
        tx = -ny,
        ty = nx;
      let vx = b.vx - b.w * c.rcy,
        vy = b.vy + b.w * c.rcx;
      const vn = vx * nx + vy * ny;
      const target =
        c.sep > 0
          ? -c.sep / h
          : Math.min((BETA * Math.max(-c.sep - SLOP, 0)) / h, MAXPUSH);
      let lam = (target - vn) * c.mN;
      const nw = Math.max(c.jn + lam, 0);
      lam = nw - c.jn;
      c.jn = nw;
      applyImp(b, nx * lam, ny * lam, c.rcx, c.rcy);
      vx = b.vx - b.w * c.rcy;
      vy = b.vy + b.w * c.rcx;
      const vt = vx * tx + vy * ty;
      lam = -vt * c.mT;
      let mu = c.mu;
      if (c.kind === 0) {
        const st = Math.abs(nx),
          ct = Math.max(Math.abs(ny), 1e-4);
        if (coasting) mu = st > MU_S * ct ? MU_K : MU_S;
        else if (braking) mu = MU_W;
      }
      const mx = mu * c.jn,
        nt = clamp(c.jt + lam, -mx, mx);
      lam = nt - c.jt;
      c.jt = nt;
      applyImp(b, tx * lam, ty * lam, c.rcx, c.rcy);
    }
  }

  /* ================= bike setup ================= */
  function resetBike(cpIdx) {
    const cps = TRACK.cps;
    cpIdx = clamp(cpIdx | 0, 0, cps.length - 1);
    const cp = cps[cpIdx],
      g = groundAt(cp.x, cp.y);
    const dx = TRACK.x[g.i + 1] - TRACK.x[g.i],
      dy = TRACK.y[g.i + 1] - TRACK.y[g.i];
    const ang = Math.atan2(dy, dx),
      ca = Math.cos(ang),
      sa = Math.sin(ang);
    const nx = sa,
      ny = -ca; // normal (up)
    const gx = cp.x,
      gy = g.y;
    const rest = (j) => [j.lax + j.ux * j.s0, j.lay + j.uy * j.s0];
    const [fx, fy] = rest(J.f),
      [rx, ry] = rest(J.r);
    // chassis centre so that the lower wheel just touches the ground
    const chx = gx + nx * (WR + 26) * 1,
      chy = gy + ny * (WR + 26);
    const place = (b, lx, ly, x, y, a) => {
      b.a = a;
      b.x = x + ca * lx - sa * ly;
      b.y = y + sa * lx + ca * ly;
      b.vx = b.vy = b.w = 0;
      b.px = b.x;
      b.py = b.y;
      b.pa = b.a;
    };
    B.ch.a = ang;
    B.ch.x = chx;
    B.ch.y = chy;
    B.ch.vx = B.ch.vy = B.ch.w = 0;
    B.ch.px = chx;
    B.ch.py = chy;
    B.ch.pa = ang;
    place(B.fw, fx, fy, chx, chy, 0);
    place(B.rw, rx, ry, chx, chy, 0);
    for (const j of [J.f, J.r]) {
      j.jSpring = j.jPerp = j.jLo = j.jHi = 0;
    }
    for (const c of CT) {
      c.jn = c.jt = 0;
      c.on = 0;
      c.si = g.i;
    }
    B.alive = 1;
    B.hopT = 0;
    B.otT = 1;
    B.otOn = 0;
    B.otLock = 0;
    B.air = 0;
    B.rc = B.fc = 0;
    B.safe = 0.6;
    B.crashT = 0;
    B.fin = 0;
    B.stuckT = 0;
    B.invT = 0;
    B.ragdoll = null;
    B.planks.length = 0;
    B.cp = cpIdx;
    for (const z of TRACK.haz) {
      if (z.t === "cat") {
        z.used = 0;
        z.anim = 0;
      }
    }
    for (let i = 1; i < TRACK.pl.length; i++) {
      const p = TRACK.pl[i];
      p.state = 0;
      p.fuse = 0;
      p.body = null;
    }
    rider.reset();
    cam.x = chx;
    cam.y = chy - 36;
    cam.z = 1;
    settleBike();
  }

  /* ================= rider (articulated skeleton, procedural + IK) ================= */
  const LT = 19,
    LH = 10.5,
    LU = 12,
    LF = 12,
    LTH = 12.5,
    LSH = 12.5;
  const SEAT = [-7, -9],
    GRIP = [16.5, -14.5],
    PEG = [-2, 5];
  const rider = {
    phi: 0.3,
    phiV: 0,
    drop: 0,
    dropV: 0,
    stand: 0,
    head: 0,
    headV: 0,
    fx: 0,
    fup: 1,
    pvx: 0,
    pvy: 0,
    P: [0, 0],
    Cst: [0, 0],
    H: [0, 0],
    EL: [0, 0],
    KN: [0, 0],
    FT: [0, 0],
    EL2: [0, 0],
    KN2: [0, 0],
    FT2: [0, 0],
    reset() {
      this.phi = 0.3;
      this.phiV = 0;
      this.drop = 0;
      this.dropV = 0;
      this.stand = 0;
      this.head = 0;
      this.headV = 0;
      this.fx = 0;
      this.fup = 1;
      this.pvx = B.ch.vx;
      this.pvy = B.ch.vy;
      this.pose();
    },
    spring(cur, vel, tgt, om, h) {
      // critically-damped spring toward tgt
      const x = cur - tgt,
        a = vel + om * x,
        e = Math.exp(-om * h);
      return [tgt + (x + a * h) * e, (vel - om * a * h) * e];
    },
    update(h, c) {
      const ch = B.ch;
      // specific force in the chassis frame (what the rider actually "feels")
      const ax = (ch.vx - this.pvx) / h,
        ay = (ch.vy - this.pvy) / h - G;
      this.pvx = ch.vx;
      this.pvy = ch.vy;
      const ca = Math.cos(ch.a),
        sa = Math.sin(ch.a);
      const fx = ax * ca + ay * sa,
        fup = ax * sa - ay * ca;
      const k = 1 - Math.exp(-h / 0.07);
      this.fx += (fx - this.fx) * k;
      this.fup += (fup - this.fup) * k;
      const nx = clamp(this.fx / (0.5 * G), -1, 1),
        nu = clamp(this.fup / G, -0.2, 3);
      const comp =
        (1 -
          (J.f.s - J.f.lo) / (J.f.s0 - J.f.lo) +
          1 -
          (J.r.s - J.r.lo) / (J.r.s0 - J.r.lo)) *
        0.5;
      const airT = B.air ? 1 : 0;
      // torso: lean back on throttle/wheelie, tuck forward on downhills, brace on drops
      const downhill = clamp(wrapPI(ch.a), -1.2, 1.2);
      let tgt =
        0.34 -
        0.62 * nx -
        0.28 * wrapPI(ch.a) +
        0.34 * c.lean +
        0.22 * (c.brk ? 1 : 0) -
        0.55 * Math.max(0, downhill) -
        0.18 * airT;
      if (nu > 1.6) tgt += 0.12;
      tgt = clamp(tgt, -0.72, 1.05);
      [this.phi, this.phiV] = this.spring(this.phi, this.phiV, tgt, 15, h);
      // hips absorb load (knees / elbows bend under heavy drops), float up when weightless
      let dt = clamp((nu - 1) * 3.2, -3, 7) + comp * 3.5 + (nu > 1.8 ? 4 : 0);
      [this.drop, this.dropV] = this.spring(this.drop, this.dropV, dt, 20, h);
      const st = B.air || nu < 0.45 ? 1 : c.hop ? 0.6 : 0;
      this.stand += (st - this.stand) * (1 - Math.exp(-h / 0.12));
      // head lags the torso a little (neck)
      [this.head, this.headV] = this.spring(
        this.head,
        this.headV,
        -0.35 * this.phiV * 0.1 - 0.25 * nx * 0.3,
        18,
        h,
      );
      this.pose();
    },
    ik(x0, y0, x1, y1, l1, l2, sign) {
      let dx = x1 - x0,
        dy = y1 - y0,
        d = hyp(dx, dy) || 1e-3;
      const reach = Math.min(
        d,
        l1 + l2 - 0.01,
        Math.max(Math.abs(l1 - l2) + 0.01, d),
      );
      const a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach),
        hh = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
      const ux = dx / d,
        uy = dy / d;
      return [x0 + ux * a - uy * hh * sign, y0 + uy * a + ux * hh * sign];
    },
    pose() {
      const st = this.stand,
        dr = this.drop;
      const tuck = clamp(dr / 8, 0, 1);
      let px = SEAT[0] + st * 3.5 - tuck * 2,
        py = SEAT[1] - st * 7.5 + dr * 0.55;
      const phi = this.phi;
      let cx = px + LT * Math.sin(phi),
        cy = py - LT * Math.cos(phi);
      // hands must stay on the grips: if out of reach slide the whole upper body forward
      let gx = GRIP[0],
        gy = GRIP[1],
        dd = hyp(gx - cx, gy - cy);
      const maxR = LU + LF - 0.6;
      if (dd > maxR) {
        const e = dd - maxR,
          ux = (gx - cx) / dd,
          uy = (gy - cy) / dd;
        px += ux * e;
        py += uy * e;
        cx += ux * e;
        cy += uy * e;
      }
      this.P[0] = px;
      this.P[1] = py;
      this.Cst[0] = cx;
      this.Cst[1] = cy;
      const hp = phi + 0.16 + this.head;
      this.H[0] = cx + (LH - 1) * Math.sin(hp);
      this.H[1] = cy - (LH - 1) * Math.cos(hp);
      // arms (elbows bend down/back), legs (knees forward)
      cx += tuck * 1.8;
      cy += tuck * 2.4;
      let e = this.ik(cx, cy, GRIP[0], GRIP[1], LU, LF, 1);
      this.EL[0] = e[0];
      this.EL[1] = e[1];
      e = this.ik(px, py, PEG[0], PEG[1], LTH * 0.92, LSH * 0.92, -1);
      this.KN[0] = e[0];
      this.KN[1] = e[1];
      this.FT[0] = PEG[0];
      this.FT[1] = PEG[1];
      e = this.ik(cx, cy, GRIP[0] - 1.5, GRIP[1] + 1, LU, LF, 1);
      this.EL2[0] = e[0];
      this.EL2[1] = e[1];
      e = this.ik(px, py, PEG[0] + 3, PEG[1] - 0.5, LTH * 0.92, LSH * 0.92, -1);
      this.KN2[0] = e[0];
      this.KN2[1] = e[1];
      this.FT2[0] = PEG[0] + 3;
      this.FT2[1] = PEG[1] - 0.5;
    },
  };

  /* ================= crash / ragdoll (verlet skeleton) ================= */
  // nodes: 0 head,1 chest,2 pelvis,3 elbowL,4 handL,5 elbowR,6 handR,7 kneeL,8 footL,9 kneeR,10 footR
  const RG_LINKS = [
    [0, 1, 10.5],
    [1, 2, 19],
    [1, 3, 12],
    [3, 4, 12],
    [1, 5, 12],
    [5, 6, 12],
    [2, 7, 12.5],
    [7, 8, 12.5],
    [2, 9, 12.5],
    [9, 10, 12.5],
    [0, 2, 29],
    [3, 5, 22],
    [7, 9, 10],
    [1, 7, 27],
    [1, 9, 27],
    [2, 3, 26],
    [2, 5, 26],
  ];
  function spawnRagdoll() {
    const ch = B.ch,
      ca = Math.cos(ch.a),
      sa = Math.sin(ch.a);
    const pts = [
      rider.H,
      rider.Cst,
      rider.P,
      rider.EL,
      [GRIP[0], GRIP[1]],
      rider.EL2,
      [GRIP[0] - 1.5, GRIP[1] + 1],
      rider.KN,
      rider.FT,
      rider.KN2,
      rider.FT2,
    ];
    const rg = [];
    for (const p of pts) {
      const wx = ch.x + ca * p[0] - sa * p[1],
        wy = ch.y + sa * p[0] + ca * p[1];
      const vx = ch.vx - ch.w * (wy - ch.y) + (Math.random() - 0.5) * 60,
        vy = ch.vy + ch.w * (wx - ch.x) - 30 + (Math.random() - 0.5) * 40;
      rg.push({
        x: wx,
        y: wy,
        px: wx - vx * DT,
        py: wy - vy * DT,
        si: ch.si || 0,
        r: p === rider.H ? 5.5 : 2.6,
      });
    }
    B.ragdoll = rg;
  }
  function stepRagdoll(h) {
    const rg = B.ragdoll;
    if (!rg) return;
    for (const p of rg) {
      const vx = (p.x - p.px) * 0.997,
        vy = (p.y - p.py) * 0.997;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy + G * h * h;
    }
    for (let it = 0; it < 8; it++) {
      for (const [a, b, L] of RG_LINKS) {
        const p = rg[a],
          q = rg[b],
          dx = q.x - p.x,
          dy = q.y - p.y,
          d = hyp(dx, dy) || 1e-4,
          e = ((d - L) / d) * 0.5;
        p.x += dx * e;
        p.y += dy * e;
        q.x -= dx * e;
        q.y -= dy * e;
      }
      for (const p of rg) {
        const q = qg(p.x, p.y, p.si);
        p.si = q.si;
        const pen = p.r - q.d;
        if (q.ok && pen > 0 && pen < 40) {
          p.x += q.nx * pen;
          p.y += q.ny * pen;
          // friction: damp tangential motion
          const vx = p.x - p.px,
            vy = p.y - p.py,
            tx = -q.ny,
            ty = q.nx,
            vt = vx * tx + vy * ty;
          p.px += tx * vt * 0.25;
          p.py += ty * vt * 0.25;
        }
      }
    }
  }

  function crash(spd) {
    if (!B.alive) return;
    B.alive = 0;
    B.crashT = 0;
    shake = Math.min(1.3, spd / 380 + 0.35);
    spawnRagdoll();
    emit(B.ch.x, B.ch.y, 18, 120, 1);
    beep(48, 0.3, "sawtooth", 0.11);
    if (engGain && AC) engGain.gain.setTargetAtTime(0, AC.currentTime, 0.05);
  }

  /* ================= planks (collapsing bridge) ================= */
  function stepPlanks(h) {
    for (let i = 1; i < TRACK.pl.length; i++) {
      const p = TRACK.pl[i];
      if (p.state === 1) {
        p.fuse -= h;
        if (p.fuse <= 0) {
          p.state = 2;
          const hinge = p.id % 2 === 0 ? p.x0 : p.x1;
          const b = {
            x: (p.x0 + p.x1) / 2,
            y: p.y,
            a: 0,
            vx: (Math.random() - 0.5) * 18,
            vy: 8,
            w: (Math.random() - 0.5) * 1.2,
            hx: hinge,
            hy: p.y,
            len: (p.x1 - p.x0) * 0.5,
            hinged: 1,
            snap: 0,
          };
          p.body = b;
          B.planks.push(b);
          emit(b.x, b.y, 6, 60, 0);
          beep(70, 0.15, "square", 0.05);
          shake = Math.max(shake, 0.2);
        }
      }
    }
    for (const b of B.planks) {
      b.vy += G * h * 1.15;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.a += b.w * h;
      if (b.hinged) {
        b.snap += h;
        const dx = b.x - b.hx,
          dy = b.y - b.hy,
          d = hyp(dx, dy) || 1e-4;
        const t = b.len / d;
        b.x = b.hx + dx * t;
        b.y = b.hy + dy * t;
        const nx = dx / d,
          ny = dy / d,
          vt = b.vx * nx + b.vy * ny;
        b.vx -= nx * (vt - (d - b.len) * 8);
        b.vy -= ny * (vt - (d - b.len) * 8);
        b.w += (nx * b.vy - ny * b.vx) * h * 0.04;
        b.a = Math.atan2(b.y - b.hy, b.x - b.hx);
        if (b.snap > 1.15 || b.y > b.hy + 90) b.hinged = 0;
      }
    }
  }

  /* ================= main simulation step ================= */
  function slopeOf(c) {
    if (!c || !c.on) return { st: 0, ct: 1, tx: 1, ty: 0, nx: 0, ny: -1 };
    const nx = c.nx,
      ny = c.ny,
      tx = -ny,
      ty = nx;
    return { st: nx, ct: Math.max(Math.abs(ny), 1e-4), tx, ty, nx, ny };
  }
  function engineAndControls(h, c) {
    const ch = B.ch,
      fw = B.fw,
      rw = B.rw;
    ch.vy += G * h;
    fw.vy += G * h;
    rw.vy += G * h;
    const sp = hyp(ch.vx, ch.vy),
      fd = KD * sp * h * ch.im;
    ch.vx -= ch.vx * fd;
    ch.vy -= ch.vy * fd;
    // overtorque meter: drains while engaged, recharges otherwise, never exceeds 100 %
    if (c.ot && B.alive && !B.otLock && B.otT > 0) {
      B.otOn = 1;
      B.otT = Math.min(1, Math.max(0, B.otT - OT_DRAIN * h));
      if (B.otT <= 0) {
        B.otLock = 1;
        B.otOn = 0;
        B.otT = 0;
      }
    } else {
      B.otOn = 0;
      B.otT = Math.min(1, B.otT + OT_REGEN * h);
      if (B.otLock && B.otT >= OT_MIN) B.otLock = 0;
    }
    const wrel = rw.w - ch.w,
      mult = B.otOn ? OT_MULT : 1,
      w0 = B.otOn ? W0_OT : W0;
    const vf = ch.vx * Math.cos(ch.a) + ch.vy * Math.sin(ch.a);
    const reversing = c.brk > 0 && c.thr <= 0 && vf < 24;
    coasting = c.thr <= 0 && !reversing ? 1 : 0;
    braking = c.brk > 0 && !reversing ? 1 : 0;
    let tq = 0;
    // pitch relative to the ground under the bike (used by traction control + wheelie governor)
    let pr = 0;
    {
      const q =
        CT[0].on && CT[0].jn > 0
          ? CT[0]
          : CT[1].on && CT[1].jn > 0
            ? CT[1]
            : null;
      if (q) pr = wrapPI(ch.a - Math.asin(clamp(q.nx, -1, 1)));
    }
    const tcs = clamp(1 - (-pr - 0.35) / 0.4, 0, 1); // engine torque fades from 20deg, cut at 43deg nose-up
    const airThr = B.air ? 0.35 : 1;
    if (c.thr > 0)
      tq = T0 * mult * c.thr * tcs * airThr * Math.max(0, 1 - wrel / w0);
    else if (reversing) tq = -T0 * 0.45 * Math.max(0, 1 + wrel / (0.5 * W0));
    if (tq) {
      rw.w += rw.iI * tq * h;
      ch.w -= ch.iI * tq * h;
    }
    const brake = (wh, tau) => {
      if (tau <= 0) return;
      const rel = wh.w - ch.w,
        lim = tau * h,
        imp = clamp(-rel / (wh.iI + ch.iI), -lim, lim);
      wh.w += wh.iI * imp;
      ch.w -= ch.iI * imp;
    };
    brake(rw, braking ? BRAKE_R + ROLL_RES : ROLL_RES);
    brake(fw, braking ? BRAKE_F + ROLL_RES : ROLL_RES);
    // slope: a = g*sin(theta) - mu*g*cos(theta). If |sin| > mu_s*|cos|, gravity wins.
    if (coasting && B.alive) {
      const spd = hyp(ch.vx, ch.vy);
      for (const k of [0, 1]) {
        const q = CT[k];
        if (!(q.on && q.jn > 0)) continue;
        const sl = slopeOf(q),
          st = sl.st,
          ct = sl.ct,
          sgn = st >= 0 ? 1 : -1;
        if (Math.abs(st) > MU_S * ct) {
          const aT = G * (st - MU_K * ct * sgn);
          const kicker = spd < 18 ? 1 : 0.28;
          const imp = aT * h * kicker;
          q.b.vx += sl.tx * imp;
          q.b.vy += sl.ty * imp;
          ch.vx += sl.tx * imp * 0.55;
          ch.vy += sl.ty * imp * 0.55;
        }
      }
    }
    // wheelie / stoppie governor: the rider's weight brings the bike back before it can loop out
    if (CT[0].on && CT[0].jn > 0 && !(CT[1].on && CT[1].jn > 0) && pr < -0.3)
      ch.w += ch.iI * clamp((-pr - 0.3) * 160000, 0, 95000) * h;
    else if (
      CT[1].on &&
      CT[1].jn > 0 &&
      !(CT[0].on && CT[0].jn > 0) &&
      pr > 0.4
    )
      ch.w -= ch.iI * clamp((pr - 0.4) * 160000, 0, 95000) * h;
    // air assist: with no lean input the rider levels the bike with its flight path so it lands on its wheels
    if (B.air && c.lean === 0 && B.alive) {
      const spd = hyp(ch.vx, ch.vy);
      if (spd > 60) {
        const tv = clamp(Math.atan2(ch.vy, ch.vx), -0.9, 0.9),
          e = wrapPI(tv - ch.a);
        ch.w += ch.iI * clamp(16000 * e - 3000 * ch.w, -11000, 11000) * h;
      }
    }
    // pitch control (rider weight shift / air control)
    const air = B.air;
    ch.w += ch.iI * c.lean * (air ? LEAN_AIR : LEAN_GND) * h;
    ch.w *= 1 - (air ? AIR_DAMP : GND_ANG_DAMP) * h;
    // preload / hop
    if (c.hop && B.alive) B.hopT = Math.min(1, B.hopT + h * 2.4);
    else if (B.hopT > 0.16) {
      let nx = 0,
        ny = -1,
        n = 0;
      for (const k of [0, 1]) {
        const q = CT[k];
        if (q.on && q.sep < 1.5) {
          nx += q.nx;
          ny += q.ny;
          n++;
        }
      }
      if (n) {
        const l = hyp(nx, ny) || 1;
        nx /= l;
        ny /= l;
      } else {
        nx = 0;
        ny = -1;
      }
      const kick = B.hopT * HOP_KICK * (n ? 1 : 0.25);
      ch.vx += nx * kick;
      ch.vy += ny * kick;
      rw.vx += nx * kick * 0.4;
      rw.vy += ny * kick * 0.4;
      fw.vx += nx * kick * 0.4;
      fw.vy += ny * kick * 0.4;
      B.hopT = 0;
      beep(150, 0.07, "sine", 0.05);
    } else B.hopT = Math.max(0, B.hopT - h * 4);
  }

  function bindWheelSpin(wh, c, h) {
    if (!(c && c.on && c.jn > 0)) return;
    const tx = -c.ny,
      ty = c.nx;
    const vT = wh.vx * tx + wh.vy * ty;
    const slip = vT - wh.w * WR;
    if (coasting) {
      wh.w = vT / WR;
    } else {
      const k = braking ? 0.55 : 0.28;
      wh.w += (slip / WR) * k;
    }
  }
  function physics(h, c) {
    for (const b of [B.ch, B.fw, B.rw]) {
      b.px = b.x;
      b.py = b.y;
      b.pa = b.a;
    }
    engineAndControls(h, c);
    prepJoint(J.r, h);
    prepJoint(J.f, h);
    buildContacts();
    if (coasting) {
      bindWheelSpin(B.rw, CT[0], h);
      bindWheelSpin(B.fw, CT[1], h);
    }
    warmJoint(J.r);
    warmJoint(J.f);
    warmContacts();
    for (let it = 0; it < ITER; it++) {
      solveJoint(J.r, h);
      solveJoint(J.f, h);
      solveContacts(h);
    }
    bindWheelSpin(B.rw, CT[0], h);
    bindWheelSpin(B.fw, CT[1], h);
    for (const b of [B.ch, B.fw, B.rw]) {
      const sp = hyp(b.vx, b.vy);
      if (sp > 1500) {
        b.vx *= 1500 / sp;
        b.vy *= 1500 / sp;
      }
      const wm = b === B.ch ? 26 : 140;
      b.w = clamp(b.w, -wm, wm);
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.a += b.w * h;
    }
  }

  function step(h) {
    const c = B.alive ? inp : ZERO;
    const wasAir = B.air;
    physics(h, c);
    stepParticles(h);
    stepPlanks(h);
    const ch = B.ch;
    B.rc = CT[0].on && CT[0].jn > 0 ? 1 : 0;
    B.fc = CT[1].on && CT[1].jn > 0 ? 1 : 0;
    B.air = B.rc || B.fc ? 0 : 1;
    if (!B.alive) {
      stepRagdoll(h);
      B.crashT += h;
      return;
    }
    if (B.safe > 0) B.safe = Math.max(0, B.safe - h);
    rider.update(h, c);
    // ---- stuck detection: never leave the player in an impasse without telling them the way out ----
    if (hyp(ch.vx, ch.vy) < 6 && !B.fin) {
      B.stuckT += h;
      if (B.stuckT > 4 && !B.stuckHint) {
        B.stuckHint = 1;
        toast("STUCK? PRESS R TO RETRY FROM CHECKPOINT");
      }
    } else {
      B.stuckT = 0;
      B.stuckHint = 0;
    }
    // ---- crash detection ----
    let cr = 0;
    const head = CT[2];
    if (!B.safe) {
      if (head.on && head.sep < 0.8) cr = 1;
      for (let k = 3; k < 6; k++) {
        const q = CT[k];
        if (q.on && q.sep < 0.5 && q.vn0 < -300) cr = 1;
      }
      const bodyDown =
        (CT[3].on && CT[3].sep < 0.5) ||
        (CT[4].on && CT[4].sep < 0.5) ||
        (CT[5].on && CT[5].sep < 0.5);
      if (B.air && bodyDown && Math.cos(ch.a) < 0) B.invT += h;
      else B.invT = 0;
      if (B.invT > 0.5) cr = 1;
    }
    // landing feedback
    if (!B.air && wasAir) {
      const v = Math.max(Math.abs(CT[0].vn0), Math.abs(CT[1].vn0));
      if (v > 90) {
        shake = Math.max(shake, Math.min(0.6, v / 700));
        if (v > 200) beep(88, 0.09, "triangle", 0.06);
        emit(
          B.rw.x,
          B.rw.y + 8,
          Math.min(10, (v / 40) | 0),
          Math.min(120, v * 0.3),
          0,
        );
      }
      B.lastImpact = v;
    }
    // tyre dust / overtorque exhaust
    const spd = hyp(ch.vx, ch.vy);
    if (B.rc && spd > 40 && Math.random() < 0.2)
      emit(B.rw.x, B.rw.y + 9, 1, 20 + spd * 0.04, 0);
    if (
      B.rc &&
      Math.abs(
        B.rw.w * WR - (B.rw.vx * Math.cos(ch.a) + B.rw.vy * Math.sin(ch.a)),
      ) > 90 &&
      Math.random() < 0.6
    )
      emit(B.rw.x, B.rw.y + 9, 1, 50, 0);
    if (B.otOn) {
      const ca = Math.cos(ch.a),
        sa = Math.sin(ch.a);
      const ex = B.rw.x + ca * -10 - sa * 2,
        ey = B.rw.y + sa * -10 + ca * 2;
      if (((simT * 90) | 0) !== (((simT - h) * 90) | 0))
        emit(ex, ey, 2, 72, 1, -ca * 190, -sa * 190);
      shake = Math.max(shake, 0.22 + 0.28 * (1 - B.otT));
    }
    // ---- hazards ----
    for (const z of TRACK.haz) {
      if (z.t === "cat") {
        if (z.anim > 0) z.anim = Math.max(0, z.anim - h * 3);
        if (!z.used) {
          for (const k of [0, 1]) {
            const q = CT[k],
              wx = q.b.x;
            if (q.on && q.jn > 0 && wx > z.x && wx < z.x + z.w) {
              z.used = 1;
              z.anim = 1;
              for (const b of [B.ch, B.fw, B.rw]) {
                b.vx += q.nx * z.power * 0.35 + 40;
                b.vy += q.ny * z.power;
              }
              emit(z.x + z.w / 2, z.y, 8, 90, 0);
              beep(210, 0.1, "sawtooth", 0.04);
              shake = Math.max(shake, 0.35);
              break;
            }
          }
        } else if (ch.x > z.x + z.w + 320 || ch.x < z.x - 40) z.used = 0;
      }
    }
    for (const k of [0, 1]) {
      const q = CT[k];
      if (q.on && q.jn > 0) {
        const s = TRACK.seg[q.seg];
        if (s > 0) {
          const p = TRACK.pl[s];
          if (p.state === 0) {
            p.state = 1;
            p.fuse = FUSE;
          }
        }
      }
    }
    // ---- checkpoints & finish ----
    const cps = TRACK.cps;
    if (B.cp + 1 < cps.length && ch.x > cps[B.cp + 1].x) {
      B.cp++;
      B.cpTime = simT;
      toast("CHECKPOINT");
      beep(520, 0.09, "sine", 0.05);
    }
    if (ch.x > TRACK.fin && !B.fin) {
      B.fin = 1;
      running = 2;
      const t = simT;
      if (!best || t < best) {
        best = t;
        try {
          localStorage.setItem("tod_best", "" + best);
        } catch (e) {}
      }
      beep(440, 0.14, "sine", 0.07);
      beep(660, 0.18, "sine", 0.05);
      showMsg(
        "CLEAR",
        "Time " + t.toFixed(2) + "s   Best " + best.toFixed(2) + "s",
        "RUN AGAIN",
        0,
      );
    }
    if (
      cr ||
      ch.y > TRACK.deathY ||
      !Number.isFinite(ch.x) ||
      !Number.isFinite(ch.y)
    )
      crash(spd);
  }

  function settleBike() {
    // let the suspension sag under the bike's own weight before the run starts, so it never rolls or bounces on spawn
    const saveInp = Object.assign({}, inp);
    for (let i = 0; i < 360; i++) {
      physics(DT, ZERO);
    }
    for (const b of [B.ch, B.fw, B.rw]) {
      b.vx = b.vy = b.w = 0;
      b.px = b.x;
      b.py = b.y;
      b.pa = b.a;
    }
    for (const j of [J.f, J.r]) {
      j.jSpring = j.jPerp = j.jLo = j.jHi = 0;
    }
    for (const c of CT) {
      c.jn = c.jt = 0;
    }
    B.safe = 0.6;
    rider.reset();
    cam.x = B.ch.x;
    cam.y = B.ch.y - 36;
  }

  /* ================= UI helpers ================= */
  let toastT = 0;
  function toast(t) {
    const e = $("toast");
    if (!e) return;
    e.textContent = t;
    e.style.opacity = "1";
    toastT = e.textContent.length > 14 ? 3.2 : 1.4;
  }
  function showMsg(title, sub, b1, b2) {
    const m = $("msg");
    m.style.display = "flex";
    m.querySelector("h1").textContent = title;
    const ps = m.querySelectorAll("p");
    ps[ps.length - 1].textContent = sub;
    $("go").textContent = b1;
    const g2 = $("go2");
    if (g2) {
      g2.style.display = b2 ? "inline-block" : "none";
      if (b2) g2.textContent = b2;
    }
  }
  function hideMsg() {
    $("msg").style.display = "none";
  }

  /* ================= rendering ================= */
  function drawBG() {
    const g = X.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0B1220");
    g.addColorStop(0.55, "#132033");
    g.addColorStop(1, "#0F172A");
    X.fillStyle = g;
    X.fillRect(0, 0, W, H);
    // parallax ridges
    for (let l = 0; l < 3; l++) {
      const f = 0.06 + l * 0.07,
        base = H * (0.62 + l * 0.09),
        amp = 26 + l * 14;
      X.fillStyle =
        l === 0
          ? "rgba(56,189,248,.06)"
          : l === 1
            ? "rgba(56,189,248,.09)"
            : "rgba(34,197,94,.07)";
      X.beginPath();
      X.moveTo(0, H);
      for (let x = 0; x <= W; x += 20) {
        const wx = x / cam.z + cam.x * f * 0 + cam.x * f * 1.0;
        X.lineTo(
          x,
          base -
            Math.sin(wx * 0.006 + l * 2) * amp -
            Math.sin(wx * 0.017 + l) * amp * 0.35,
        );
      }
      X.lineTo(W, H);
      X.closePath();
      X.fill();
    }
  }
  function trackPath(x0, x1) {
    const PX = TRACK.x,
      PY = TRACK.y,
      ns = TRACK.n - 1;
    let pen = false;
    X.beginPath();
    for (let i = 0; i < ns; i++) {
      const xa = PX[i],
        xb = PX[i + 1];
      if (Math.max(xa, xb) < x0 || Math.min(xa, xb) > x1) {
        pen = false;
        continue;
      }
      if (!segSolid(i)) {
        pen = false;
        continue;
      }
      if (!pen) {
        X.moveTo(PX[i], PY[i]);
        pen = true;
      }
      X.lineTo(PX[i + 1], PY[i + 1]);
    }
  }
  function drawTerrain(x0, x1, tnow) {
    X.lineJoin = "round";
    X.lineCap = "round";
    // chasms under gaps / bridge
    for (let i = 0; i < TRACK.n - 1; i++) {
      if (
        TRACK.seg[i] === -1 &&
        Math.max(TRACK.x[i], TRACK.x[i + 1]) > x0 &&
        Math.min(TRACK.x[i], TRACK.x[i + 1]) < x1
      ) {
        const ax = TRACK.x[i],
          ay = TRACK.y[i],
          bx = TRACK.x[i + 1],
          by = TRACK.y[i + 1];
        const g = X.createLinearGradient(0, Math.min(ay, by), 0, TRACK.deathY);
        g.addColorStop(0, "#050a14");
        g.addColorStop(1, "#0B1220");
        X.fillStyle = g;
        X.fillRect(
          ax,
          Math.min(ay, by) + 2,
          bx - ax,
          TRACK.deathY - Math.min(ay, by),
        );
      }
    }
    for (const z of TRACK.haz) {
      if (z.t === "bridge" && z.x < x1 && z.x + z.w > x0) {
        const g = X.createLinearGradient(0, z.y, 0, TRACK.deathY);
        g.addColorStop(0, "#050a14");
        g.addColorStop(1, "#0B1220");
        X.fillStyle = g;
        X.fillRect(z.x, z.y + 3, z.w, TRACK.deathY - z.y);
      }
    }
    trackPath(x0, x1);
    X.strokeStyle = "#16332c";
    X.lineWidth = 52;
    X.stroke();
    X.strokeStyle = "#1d4a3c";
    X.lineWidth = 40;
    X.stroke();
    X.strokeStyle = "#22C55E";
    X.lineWidth = 3;
    X.stroke();
    // planks
    for (let i = 1; i < TRACK.pl.length; i++) {
      const p = TRACK.pl[i];
      if (p.x1 < x0 || p.x0 > x1) continue;
      if (p.state < 2) {
        const sag =
          p.state === 1
            ? Math.sin((FUSE - p.fuse) * 22 + p.seed * 6) * 1.2 +
              ((FUSE - p.fuse) / FUSE) * 4
            : 0;
        X.fillStyle = p.state === 1 ? "#B45309" : "#92400E";
        X.fillRect(p.x0 + 0.6, p.y - 4 + sag, p.x1 - p.x0 - 1.2, 8);
        X.fillStyle = "#F59E0B";
        X.fillRect(p.x0 + 0.6, p.y - 4 + sag, p.x1 - p.x0 - 1.2, 1.6);
        X.fillStyle = "#451A03";
        X.fillRect(p.x0 + 2, p.y + sag, 2, 2);
        X.fillRect(p.x1 - 4, p.y + sag, 2, 2);
      }
    }
    for (const b of B.planks) {
      X.save();
      X.translate(b.x, b.y);
      X.rotate(b.a);
      X.fillStyle = "#92400E";
      X.fillRect(-15, -4, 30, 8);
      X.fillStyle = "#F59E0B";
      X.fillRect(-15, -4, 30, 1.6);
      X.restore();
    }
    // bridge rails
    for (const z of TRACK.haz) {
      if (z.t === "bridge" && z.x < x1 && z.x + z.w > x0) {
        X.fillStyle = "#78350F";
        X.fillRect(z.x - 4, z.y - 22, 5, 26);
        X.fillRect(z.x + z.w - 1, z.y - 22, 5, 26);
      }
      if (z.t === "cat" && z.x < x1 && z.x + z.w > x0) {
        const k = z.anim,
          lift = k * 9;
        X.fillStyle = "#78350F";
        X.fillRect(z.x, z.y - 3, z.w, 3);
        X.fillStyle = "#F59E0B";
        X.fillRect(z.x + 3, z.y - 6 - lift, z.w - 6, 4);
        X.fillStyle = "#DC2626";
        for (let q = 0; q < 3; q++) {
          const cx = z.x + z.w * (0.2 + q * 0.3);
          X.beginPath();
          X.moveTo(cx, z.y - 16 - lift);
          X.lineTo(cx - 6, z.y - 7 - lift);
          X.lineTo(cx + 6, z.y - 7 - lift);
          X.fill();
        }
      }
    }
    // checkpoints & finish
    for (let i = 0; i < TRACK.cps.length; i++) {
      const c = TRACK.cps[i];
      if (c.x < x0 || c.x > x1) continue;
      const on = i <= B.cp;
      X.strokeStyle = "#94A3B8";
      X.lineWidth = 2;
      X.beginPath();
      X.moveTo(c.x, c.y);
      X.lineTo(c.x, c.y - 46);
      X.stroke();
      X.fillStyle = on ? "#22C55E" : "#64748B";
      X.beginPath();
      X.moveTo(c.x, c.y - 46);
      X.lineTo(c.x + 22, c.y - 40 + Math.sin(tnow * 4 + i) * 1.5);
      X.lineTo(c.x, c.y - 32);
      X.fill();
    }
    const fy = TRACK.y[TRACK.n - 1];
    const fg = groundAt(TRACK.fin, fy).y;
    if (TRACK.fin > x0 && TRACK.fin < x1) {
      X.fillStyle = "#38BDF8";
      X.fillRect(TRACK.fin, fg - 78, 5, 78);
      X.fillRect(TRACK.fin + 56, fg - 78, 5, 78);
      for (let q = 0; q < 8; q++)
        for (let r = 0; r < 2; r++) {
          X.fillStyle = (q + r) % 2 ? "#0F172A" : "#E2E8F0";
          X.fillRect(TRACK.fin + 5 + q * 6.4, fg - 78 + r * 6, 6.4, 6);
        }
    }
  }
  const ip = (b, k) => ({
    x: b.px + (b.x - b.px) * k,
    y: b.py + (b.y - b.py) * k,
    a: b.pa + (b.a - b.pa) * k,
  });
  function wheelGfx(lx, ly, wa, ca, col, blur) {
    X.save();
    X.translate(lx, ly);
    X.rotate(wa - ca);
    X.beginPath();
    X.arc(0, 0, WR - 1.5, 0, TAU);
    X.strokeStyle = "#0a0f1a";
    X.lineWidth = 4.4;
    X.stroke();
    X.beginPath();
    X.arc(0, 0, WR - 0.2, 0, TAU);
    X.strokeStyle = "#475569";
    X.lineWidth = 0.9;
    X.stroke();
    X.beginPath();
    X.arc(0, 0, WR - 5, 0, TAU);
    X.strokeStyle = col;
    X.lineWidth = 1.6;
    X.stroke();
    if (blur) {
      X.fillStyle = "rgba(148,163,184,.22)";
      X.beginPath();
      X.arc(0, 0, WR - 5, 0, TAU);
      X.fill();
      X.strokeStyle = "rgba(226,232,240,.5)";
      X.lineWidth = 1.2;
      X.beginPath();
      X.arc(0, 0, WR - 7, 0.3, 2.4);
      X.stroke();
    } else {
      X.strokeStyle = "#94A3B8";
      X.lineWidth = 1.2;
      X.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i * TAU) / 5;
        X.moveTo(0, 0);
        X.lineTo(Math.cos(a) * (WR - 5), Math.sin(a) * (WR - 5));
      }
      X.stroke();
    }
    X.fillStyle = "#DC2626";
    X.beginPath();
    X.arc(WR - 3.4, 0, 1.5, 0, TAU);
    X.fill(); // valve: rotation reference
    X.fillStyle = "#64748B";
    X.beginPath();
    X.arc(0, 0, 2, 0, TAU);
    X.fill();
    X.restore();
  }
  function limb(pts, w, col) {
    X.strokeStyle = col;
    X.lineWidth = w;
    X.lineCap = "round";
    X.lineJoin = "round";
    X.beginPath();
    X.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) X.lineTo(pts[i][0], pts[i][1]);
    X.stroke();
  }
  function drawBike(k) {
    const c = ip(B.ch, k),
      f = ip(B.fw, k),
      r = ip(B.rw, k);
    const ca = Math.cos(c.a),
      sa = Math.sin(c.a);
    const loc = (w) => [
      (w.x - c.x) * ca + (w.y - c.y) * sa,
      -(w.x - c.x) * sa + (w.y - c.y) * ca,
    ];
    const fl = loc(f),
      rl = loc(r);
    // rider was drawn from local coords -> everything below is in chassis space
    const drawRiderFar = () => {
      if (!B.alive) return;
      limb([rider.P, rider.KN2, rider.FT2], 4, "#1E3A8A");
      limb(
        [
          [rider.FT2[0], rider.FT2[1]],
          [rider.FT2[0] + 3.5, rider.FT2[1] + 0.5],
        ],
        3.4,
        "#0F172A",
      );
      limb(
        [rider.Cst, rider.EL2, [GRIP[0] - 1.5, GRIP[1] + 1]],
        3.2,
        "#7F1D1D",
      );
    };
    const drawRiderNear = () => {
      if (!B.alive) return;
      limb([rider.P, rider.KN, rider.FT], 4.4, "#1D4ED8");
      limb(
        [
          [rider.FT[0] - 1, rider.FT[1]],
          [rider.FT[0] + 4, rider.FT[1] + 0.5],
        ],
        3.6,
        "#0F172A",
      );
      limb([rider.P, rider.Cst], 5.6, "#DC2626");
      limb([rider.Cst, rider.EL, GRIP], 3.6, "#EF4444");
      X.fillStyle = "#F8FAFC";
      X.beginPath();
      X.arc(GRIP[0], GRIP[1], 2, 0, TAU);
      X.fill();
      const hx = rider.H[0],
        hy = rider.H[1];
      X.fillStyle = "#F8FAFC";
      X.beginPath();
      X.arc(hx, hy, 5.4, 0, TAU);
      X.fill();
      X.fillStyle = "#0F172A";
      X.beginPath();
      X.arc(hx + 2.6, hy + 0.4, 3, -0.9, 1.3);
      X.fill();
      X.fillStyle = "#DC2626";
      X.fillRect(hx - 5.4, hy - 1.2, 4, 1.6);
    };
    X.save();
    X.translate(c.x, c.y);
    X.rotate(c.a);
    const wa1 = r.a,
      wa2 = f.a,
      blur1 = Math.abs(B.rw.w) > 26,
      blur2 = Math.abs(B.fw.w) > 26;
    // swingarm + shock
    const piv = [-7, 8];
    limb([piv, rl], 4, "#475569");
    const mid = [
      piv[0] + (rl[0] - piv[0]) * 0.6,
      piv[1] + (rl[1] - piv[1]) * 0.6 - 2,
    ];
    X.strokeStyle = "#F59E0B";
    X.lineWidth = 2;
    X.beginPath();
    X.moveTo(-13, -4);
    {
      const dx = mid[0] + 13,
        dy = mid[1] + 4,
        L = hyp(dx, dy),
        n = 7;
      for (let i = 1; i <= n; i++) {
        const t = i / n,
          px = -13 + dx * t,
          py = -4 + dy * t,
          s = (i % 2 ? 1 : -1) * 3;
        X.lineTo(px - (dy / L) * s, py + (dx / L) * s);
      }
    }
    X.stroke();
    wheelGfx(rl[0], rl[1], wa1, c.a, B.otOn ? "#F97316" : "#CBD5E1", blur1);
    drawRiderFar();
    // exhaust
    X.strokeStyle = "#94A3B8";
    X.lineWidth = 3;
    X.beginPath();
    X.moveTo(4, 11);
    X.quadraticCurveTo(-8, 14, -24, 7);
    X.stroke();
    X.fillStyle = "#CBD5E1";
    X.fillRect(-28, 3, 10, 5);
    // engine block
    X.fillStyle = "#334155";
    X.fillRect(-7, -1, 17, 13);
    X.fillStyle = "#475569";
    X.fillRect(-4, -5, 10, 5);
    X.fillStyle = "#1E293B";
    X.fillRect(-5, 4, 13, 2);
    // frame tube
    limb(
      [
        [-14, 3],
        [-9, -7],
        [12, -11],
        [13, 2],
      ],
      2.4,
      "#64748B",
    );
    // seat + tank + tail
    X.fillStyle = "#0F172A";
    X.beginPath();
    X.moveTo(-23, -9);
    X.lineTo(-6, -8);
    X.lineTo(-5, -5);
    X.lineTo(-22, -5);
    X.closePath();
    X.fill();
    X.fillStyle = "#DC2626";
    X.beginPath();
    X.moveTo(-6, -10);
    X.lineTo(11, -13);
    X.lineTo(16, -7);
    X.lineTo(6, -3);
    X.lineTo(-7, -4);
    X.closePath();
    X.fill();
    X.fillStyle = "#F87171";
    X.fillRect(-3, -11, 10, 1.5);
    X.fillStyle = "#DC2626";
    X.beginPath();
    X.moveTo(-28, -8);
    X.lineTo(-22, -10);
    X.lineTo(-22, -5);
    X.closePath();
    X.fill();
    // front fork (telescopes with real suspension travel) + bars
    const T0 = [6.6, -10.5],
      ax = Math.sin(FORK_A),
      ay = Math.cos(FORK_A);
    limb([T0, fl], 3, "#CBD5E1");
    limb([[fl[0] - ax * 15, fl[1] - ay * 15], fl], 5, "#334155");
    limb([[T0[0] - 2, T0[1] - 2], [13, -16], GRIP], 2.6, "#94A3B8");
    X.fillStyle = "#FDE68A";
    X.fillRect(15, -11, 4, 4);
    drawRiderNear();
    wheelGfx(fl[0], fl[1], wa2, c.a, "#94A3B8", blur2);
    X.restore();
  }
  function drawRagdoll() {
    const rg = B.ragdoll;
    if (!rg) return;
    const seg = (a, b, w, col) => {
      X.strokeStyle = col;
      X.lineWidth = w;
      X.lineCap = "round";
      X.beginPath();
      X.moveTo(rg[a].x, rg[a].y);
      X.lineTo(rg[b].x, rg[b].y);
      X.stroke();
    };
    seg(1, 2, 5.6, "#DC2626");
    seg(1, 3, 3.4, "#EF4444");
    seg(3, 4, 3.4, "#EF4444");
    seg(1, 5, 3.4, "#EF4444");
    seg(5, 6, 3.4, "#EF4444");
    seg(2, 7, 4.4, "#1D4ED8");
    seg(7, 8, 4.4, "#1D4ED8");
    seg(2, 9, 4.4, "#1D4ED8");
    seg(9, 10, 4.4, "#1D4ED8");
    seg(0, 1, 3, "#F8FAFC");
    X.fillStyle = "#F8FAFC";
    X.beginPath();
    X.arc(rg[0].x, rg[0].y, 5.4, 0, TAU);
    X.fill();
    X.fillStyle = "#DC2626";
    X.beginPath();
    X.arc(rg[0].x + 2, rg[0].y - 1, 1.8, 0, TAU);
    X.fill();
  }
  function drawDust() {
    for (const p of dust) {
      if (p.a <= 0) continue;
      X.globalAlpha = Math.max(0, p.a) * (p.c ? 0.6 : 0.4);
      X.fillStyle = p.c
        ? p.a > 0.55
          ? "#FBBF24"
          : p.a > 0.3
            ? "#F97316"
            : "#64748B"
        : "#94A3B8";
      X.beginPath();
      X.arc(p.x, p.y, p.s, 0, TAU);
      X.fill();
    }
    X.globalAlpha = 1;
  }
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = C.clientWidth || window.innerWidth;
    H = C.clientHeight || window.innerHeight;
    C.width = (W * DPR) | 0;
    C.height = (H * DPR) | 0;
    X.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  function hud() {
    const sp = hyp(B.ch.vx, B.ch.vy) * 0.107;
    $("spd").textContent = sp.toFixed(0);
    $("dst").textContent = Math.max(0, (B.ch.x / 10) | 0);
    $("tim").textContent = simT.toFixed(2);
    $("bst").textContent = best ? best.toFixed(2) : "--";
    const otPct = Math.min(clamp(B.otT, 0, 1) * 100, 100),
      ready = otPct >= 99.5;
    $("bthr").style.width = clamp(inp.thr, 0, 1) * 100 + "%";
    $("bot").style.width = otPct + "%";
    $("bhop").style.width = clamp(B.hopT, 0, 1) * 100 + "%";
    $("bot").parentNode.classList.toggle("ready", ready);
    const otl = $("otl");
    if (otl) {
      otl.classList.toggle("ready", ready);
      otl.textContent = B.otLock
        ? "OT RECHARGING"
        : ready
          ? "OT READY"
          : "Overtorque";
    }
  }

  /* ================= main loop ================= */
  let lastNow = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!lastNow) lastNow = now;
    let dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    readInput();
    if (running === 1) {
      acc += dt;
      let n = 0;
      while (acc >= DT && n < MAXSTEPS) {
        step(DT);
        acc -= DT;
        n++;
        if (B.alive && !B.fin) simT += DT;
      }
      if (n === MAXSTEPS) acc = 0;
      if (!B.alive && B.crashT > 0.9 && $("msg").style.display !== "flex")
        showMsg(
          "DOWN",
          "Physics won this round. Restart from the last checkpoint, or start over.",
          "RETRY",
          "RESTART",
        );
    } else if (running === 2 || running === 0 || running === 3) {
      stepParticles(dt);
      if (!B.alive) stepRagdoll(dt);
    }
    alpha = running === 1 ? acc / DT : 1;
    const ch = ip(B.ch, alpha),
      spd = hyp(B.ch.vx, B.ch.vy);
    const base = clamp(Math.min(W / 760, H / 440), 0.55, 1.5);
    const tz =
      base * clamp(1.06 - spd * 0.00034 - (B.otOn ? 0.22 : 0), 0.58, 1.12);
    const lookX = clamp(B.ch.vx * 0.28, -170, 170);
    const kx = 1 - Math.exp(-dt * 5.5),
      kz = 1 - Math.exp(-dt * 2.2);
    cam.x += (ch.x + lookX - cam.x) * kx;
    cam.y += (ch.y - 30 - cam.y) * kx;
    cam.z += (tz - cam.z) * kz;
    shake *= Math.exp(-dt * 9);
    const sx = (Math.random() - 0.5) * shake * 12,
      sy = (Math.random() - 0.5) * shake * 9;
    X.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBG();
    X.save();
    X.translate(W * 0.42 + sx, H * 0.58 + sy);
    X.scale(cam.z, cam.z);
    X.translate(-cam.x, -cam.y);
    const vw = W / cam.z;
    drawTerrain(cam.x - vw * 0.55 - 120, cam.x + vw * 0.7 + 120, now / 1000);
    drawDust();
    if (B.alive) drawBike(alpha);
    else {
      drawBike(alpha);
      drawRagdoll();
    }
    X.restore();
    if (toastT > 0) {
      toastT -= dt;
      if (toastT <= 0) {
        const e = $("toast");
        if (e) e.style.opacity = "0";
      }
    }
    if (engGain && AC) {
      if (running === 1 && B.alive) {
        engF = lerp(engF, 60 + Math.abs(B.rw.w) * 3.2 + inp.thr * 30, 0.15);
        engOsc.frequency.setTargetAtTime(engF, AC.currentTime, 0.05);
        engGain.gain.setTargetAtTime(
          0.02 + inp.thr * 0.045,
          AC.currentTime,
          0.08,
        );
      } else engGain.gain.setTargetAtTime(0, AC.currentTime, 0.06);
    }
    hud();
    if (inp.retry) {
      inp.retry = 0;
      if (running !== 0) startRun(B.alive && running === 1 ? "cp" : "cp");
    }
  }

  /* ================= game flow ================= */
  function startRun(mode) {
    // mode: 'cp' retry from last checkpoint, 'full' restart, undefined = resume/continue
    if (running === 3 && !mode) {
      running = 1;
      hideMsg();
      if (AC && AC.state === "suspended") AC.resume();
      return;
    }
    const keepTime = mode === "cp" && B.cp > 0 && running !== 2;
    const cpi =
      mode === "full" || running === 2 || mode === undefined ? 0 : B.cp;
    const tSave = keepTime ? B.cpTime : 0;
    resetBike(cpi);
    running = 1;
    simT = tSave;
    B.cpTime = tSave;
    acc = 0;
    inp.hop = 0;
    inp.ot = 0;
    inp.retry = 0;
    hideMsg();
    audioInit();
    if (AC && AC.state === "suspended") AC.resume();
  }
  function pause() {
    if (running !== 1) return;
    running = 3;
    if (engGain && AC) engGain.gain.setTargetAtTime(0, AC.currentTime, 0.05);
    showMsg("PAUSED", "Enter or ENGAGE to resume", "ENGAGE", 0);
  }
  function readInput() {
    inp.thr = keys.KeyW || keys.ArrowUp || touch.thr ? 1 : 0;
    inp.brk = keys.KeyS || keys.ArrowDown || touch.brk ? 1 : 0;
    inp.lean =
      (touch.leanR || keys.KeyD || keys.ArrowRight ? 1 : 0) -
      (touch.leanL || keys.KeyA || keys.ArrowLeft ? 1 : 0);
    inp.hop = (keys.Space && !hopLock) || touch.hop ? 1 : 0;
    inp.ot = keys.ShiftLeft || keys.ShiftRight || touch.ot ? 1 : 0;
    if (touch.retry) {
      inp.retry = 1;
      touch.retry = 0;
    }
    const gps = navigator.getGamepads && navigator.getGamepads();
    const gp = gps && gps[0];
    if (gp) {
      const ax = gp.axes[0] || 0,
        ay = gp.axes[1] || 0;
      if (Math.abs(ax) > 0.12) inp.lean = ax;
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0,
        lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      inp.thr = Math.max(inp.thr, rt, ay < -0.2 ? -ay : 0);
      inp.brk = Math.max(inp.brk, lt);
      if (gp.buttons[0] && gp.buttons[0].pressed) inp.hop = 1;
      if (gp.buttons[1] && gp.buttons[1].pressed) inp.ot = 1;
      if (gp.buttons[9] && gp.buttons[9].pressed) inp.retry = 1;
    }
  }
  function bind() {
    const GAME_KEYS = [
      "Space",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ];
    window.addEventListener(
      "keydown",
      (e) => {
        if (GAME_KEYS.indexOf(e.code) >= 0) e.preventDefault();
        keys[e.code] = 1;
        if (e.code === "Space") {
          if ($("msg").style.display !== "none") {
            hopLock = 1;
            startRun(running === 3 ? undefined : B.alive ? "full" : "cp");
            return;
          }
          if (running === 1 && !hopLock) inp.hop = 1;
          return;
        }
        if (e.code === "KeyR") inp.retry = 1;
        if (e.code === "Enter" && running !== 1)
          startRun(running === 3 ? undefined : B.alive ? "full" : "cp");
        if (e.code === "Escape") pause();
      },
      { passive: false },
    );
    window.addEventListener("keyup", (e) => {
      keys[e.code] = 0;
      if (e.code === "Space") {
        inp.hop = 0;
        hopLock = 0;
      }
    });
    window.addEventListener("blur", () => {
      for (const k in keys) keys[k] = 0;
      for (const k in touch) touch[k] = 0;
      pause();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pause();
    });
    document.querySelectorAll("#touch button").forEach((b) => {
      const k = b.dataset.k;
      const on = (e) => {
        e.preventDefault();
        try {
          b.setPointerCapture(e.pointerId);
        } catch (_) {}
        touch[k] = 1;
        b.classList.add("on");
      };
      const off = () => {
        touch[k] = 0;
        b.classList.remove("on");
      };
      b.addEventListener("pointerdown", on);
      b.addEventListener("pointerup", off);
      b.addEventListener("pointercancel", off);
      b.addEventListener("lostpointercapture", off);
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    });
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    $("go").onclick = () => {
      const t = $("go").textContent;
      if (t === "RETRY") startRun("cp");
      else if (t === "RUN AGAIN") startRun("full");
      else startRun(running === 3 ? undefined : "full");
    };
    const g2 = $("go2");
    if (g2) g2.onclick = () => startRun("full");
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", () => setTimeout(resize, 150));
    if (window.visualViewport)
      visualViewport.addEventListener("resize", resize);
  }

  try {
    const coarse =
      window.matchMedia &&
      (matchMedia("(pointer:coarse)").matches ||
        matchMedia("(hover:none)").matches);
    if (coarse || "ontouchstart" in window)
      document.body.classList.add("touch");
  } catch (e) {}
  buildTrack();
  resetBike(0);
  resize();
  bind();
  if (best) $("bst").textContent = best.toFixed(2);
  running = 0;
  requestAnimationFrame(frame);

  // test / automation hook (used by tests/verify.js and the Playwright suite)
  window.__TOD = {
    TRACK,
    B,
    J,
    CT,
    inp,
    rider,
    step,
    resetBike,
    qg,
    groundAt,
    physics,
    get running() {
      return running;
    },
    set running(v) {
      running = v;
    },
    get simT() {
      return simT;
    },
    set simT(v) {
      simT = v;
    },
    get best() {
      return best;
    },
    get coasting() {
      return coasting;
    },
    constants: { G, DT, WR, T0, W0, KD, OT_MULT, W0_OT, MU_S, MU_K, MU_W },
  };
})();
