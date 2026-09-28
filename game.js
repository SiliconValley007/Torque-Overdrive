(() => {
  "use strict";
  const S = window.TOSim,
    $ = (i) => document.getElementById(i),
    TAU = Math.PI * 2,
    clamp = S.clamp;
  const cv = $("c"),
    ctx = cv.getContext("2d", { alpha: false });
  /* ---------- save ---------- */
  let save = {
    coins: 0,
    best: 0,
    veh: 0,
    own: [1, 0, 0],
    up: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    mute: 0,
  };
  try {
    const s = JSON.parse(localStorage.getItem("tod2") || "null");
    if (s && s.up && s.own) save = Object.assign(save, s);
  } catch (e) {}
  const persist = () => {
    try {
      localStorage.setItem("tod2", JSON.stringify(save));
    } catch (e) {}
  };
  const UPN = [
    ["Engine Torque", "Climbing power & top speed"],
    ["Dual Suspension", "Stiffness & impact absorption"],
    ["Tire Grip", "Traction on steep slopes"],
    ["Fuel Tank", "Max fuel volume"],
  ];
  const MAXL = 8,
    cost = (l) => Math.round(25 * Math.pow(1.55, l));
  /* ---------- state ---------- */
  let sim,
    state = "menu",
    W = 1,
    H = 1,
    DPR = 1,
    qual = 1,
    k = 1,
    last = 0,
    acc = 0,
    ema = 16,
    slow = 0,
    shake = 0;
  const cam = { x: 0, y: 0, z: 1 },
    keys = {},
    tch = {},
    inp = { thr: 0, brk: 0, lean: 0, nit: 0, hop: 0 };
  const params = new URLSearchParams(location.search);
  function newRun(seedIn) {
    const seed =
      seedIn != null
        ? seedIn >>> 0
        : crypto.getRandomValues
          ? crypto.getRandomValues(new Uint32Array(1))[0]
          : (Math.random() * 4294967296) >>> 0;
    const bi = seed % S.BIOMES.length;
    sim = new S.Sim({ seed, biome: bi, veh: save.veh, up: save.up[save.veh] });
    sim.ev = onEv;
    cam.x = sim.x;
    cam.y = sim.y;
    buildBg();
    acc = 0;
  }
  /* ---------- particles (pooled) ---------- */
  const NP = 320,
    P = Array.from({ length: NP }, () => ({
      a: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      s: 1,
      l: 1,
      t: 0,
    }));
  let pi = 0;
  function emit(t, x, y, n, sp, vx, vy) {
    n = Math.ceil(n * qual);
    for (let i = 0; i < n; i++) {
      const p = P[pi++ % NP],
        a = Math.random() * TAU,
        s = (0.3 + Math.random()) * sp;
      p.a = 1;
      p.t = t;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s + (vx || 0);
      p.vy = Math.sin(a) * s + (vy || 0);
      p.s = 1.5 + Math.random() * 3;
      p.l = t === 2 ? 0.25 + Math.random() * 0.2 : 0.4 + Math.random() * 0.6;
    }
  }
  function stepP(h) {
    for (let i = 0; i < NP; i++) {
      const p = P[i];
      if (p.a <= 0) continue;
      p.x += p.vx * h;
      p.y += p.vy * h;
      p.vy += (p.t === 1 || p.t === 2 ? -25 : p.t === 3 ? 0 : 160) * h;
      p.vx *= 1 - 1.5 * h;
      p.a -= h / p.l;
      if (p.t === 1) p.s += h * 8;
    }
  }
  /* ---------- audio ---------- */
  let AC = null,
    eo = null,
    eg = null;
  function audio() {
    if (save.mute) return;
    try {
      if (!AC) {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        eo = AC.createOscillator();
        eg = AC.createGain();
        const f = AC.createBiquadFilter();
        eo.type = "sawtooth";
        f.type = "lowpass";
        f.frequency.value = 700;
        eg.gain.value = 0;
        eo.connect(f);
        f.connect(eg);
        eg.connect(AC.destination);
        eo.start();
      }
      if (AC.state === "suspended") AC.resume();
    } catch (e) {
      AC = null;
    }
  }
  function blip(f, d, t) {
    if (!AC || save.mute) return;
    try {
      const o = AC.createOscillator(),
        g = AC.createGain();
      o.type = t || "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.12, AC.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + d);
      o.connect(g);
      g.connect(AC.destination);
      o.start();
      o.stop(AC.currentTime + d);
    } catch (e) {}
  }
  function engineSnd() {
    if (!AC || !eg) return;
    const on =
      state === "run" && !save.mute && sim && !sim.crashed && sim.fuel > 0;
    const w = sim ? Math.abs(sim.wh[0].om) : 0;
    try {
      const n = sim && sim.nitOn ? 1 : 0;
      eo.frequency.setTargetAtTime(
        38 + w * 1.6 + sim.thrS * 25 + n * 40,
        AC.currentTime,
        0.05,
      );
      eg.gain.setTargetAtTime(
        on ? 0.03 + 0.03 * sim.thrS + n * 0.02 : 0,
        AC.currentTime,
        0.08,
      );
    } catch (e) {}
  }
  /* ---------- events ---------- */
  let toastT = 0;
  function toast(s) {
    const t = $("toast");
    t.textContent = s;
    t.style.opacity = 1;
    toastT = 1.4;
  }
  function onEv(t, x, y, v) {
    if (t === "coin") {
      emit(3, x, y, 6, 90);
      blip(v > 1 ? 1100 : 880, 0.12);
    } else if (t === "fuel") {
      emit(3, x, y, 12, 120);
      blip(500, 0.15);
      blip(750, 0.2);
      toast("FUEL +");
    } else if (t === "land") {
      emit(0, x, y + 8, 6, 60 + v * 0.15, 0, -30);
      shake = Math.max(shake, Math.min(6, v / 120));
    } else if (t === "thud") emit(4, x, y, 5, 80 + v * 0.1);
    else if (t === "flip") toast("FLIP x" + v + "  +" + 10 * v);
    else if (t === "mile")
      toast(sim.milestone * 500 + "m  BONUS +" + 25 * sim.milestone);
    else if (t === "hop") {
      emit(0, x, y + 10, 4 + v * 8, 40 + v * 50, 0, -80);
      shake = Math.max(shake, 1.5 * v);
      blip(180 + v * 80, 0.08);
    } else if (t === "crash") {
      emit(4, x, y, 30, 220);
      shake = 10;
      blip(90, 0.5, "sawtooth");
    } else if (t === "over") endRun();
  }
  /* ---------- input ---------- */
  const GK = {
    KeyW: "thr",
    ArrowUp: "thr",
    KeyS: "brk",
    ArrowDown: "brk",
    KeyA: "L",
    ArrowLeft: "L",
    KeyD: "R",
    ArrowRight: "R",
    ShiftLeft: "nit",
    ShiftRight: "nit",
    Space: "hop",
  };
  addEventListener("keydown", (e) => {
    const g = GK[e.code];
    if (g) {
      keys[g] = 1;
      e.preventDefault();
      audio();
    }
    if (e.repeat) return;
    if (e.code === "Escape" || e.code === "KeyP") {
      state === "run" ? pause() : state === "pause" && resume();
    } else if (e.code === "KeyR" && (state === "run" || state === "over"))
      start();
    else if (e.code === "Enter" && (state === "menu" || state === "over"))
      start();
  });
  addEventListener("keyup", (e) => {
    const g = GK[e.code];
    if (g) keys[g] = 0;
  });
  addEventListener("blur", () => {
    for (const q in keys) keys[q] = 0;
    for (const q in tch) tch[q] = 0;
    if (state === "run") pause();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "run") pause();
  });
  ["gesturestart", "contextmenu", "dblclick"].forEach((n) =>
    document.addEventListener(n, (e) => e.preventDefault()),
  );
  document.addEventListener(
    "touchmove",
    (e) => {
      if (!e.target.closest("#msg")) e.preventDefault();
    },
    { passive: false },
  );
  function setTouch() {
    document.body.classList.add("touch");
  }
  let reducedMotion = matchMedia("(prefers-reduced-motion:reduce)").matches;
  try {
    matchMedia("(prefers-reduced-motion:reduce)").addEventListener(
      "change",
      (e) => {
        reducedMotion = e.matches;
      },
    );
  } catch (e) {}
  if (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    matchMedia("(pointer:coarse)").matches
  )
    setTouch();
  addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "touch") setTouch();
      audio();
    },
    { passive: true },
  );
  document.querySelectorAll("#touch button").forEach((b) => {
    const key = b.dataset.k,
      ids = new Set(),
      sync = () => {
        tch[key] = ids.size ? 1 : 0;
        b.classList.toggle("on", !!ids.size);
      };
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try {
        b.setPointerCapture(e.pointerId);
      } catch (x) {}
      ids.add(e.pointerId);
      sync();
    });
    const up = (e) => {
      ids.delete(e.pointerId);
      sync();
    };
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((n) =>
      b.addEventListener(n, up),
    );
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  });
  function readInput() {
    const t = state === "run";
    inp.thr = t && (keys.thr || tch.G) ? 1 : 0;
    inp.brk = t && (keys.brk || tch.B) ? 1 : 0;
    inp.nit = t && (keys.nit || tch.N) ? 1 : 0;
    inp.hop = t && (keys.hop || tch.H) ? 1 : 0;
    inp.lean = t ? (keys.R || tch.R ? 1 : 0) - (keys.L || tch.L ? 1 : 0) : 0;
  }
  /* ---------- UI / menus ---------- */
  const box = $("box"),
    msg = $("msg");
  const playUI = () => {
    const on = state === "run";
    document.body.classList.toggle("playing", on);
    $("touch").setAttribute("aria-hidden", on ? "false" : "true");
    $("pb").setAttribute("aria-label", on ? "Pause" : "Resume");
  };
  const show = (h) => {
    box.innerHTML = h;
    msg.classList.add("on");
    playUI();
  };
  const hide = () => {
    msg.classList.remove("on");
    playUI();
  };
  const bn = () => S.BIOMES[sim.bi].name;
  const HINT =
    '<p class="t kb"><b>W/&#8593;</b> gas &nbsp;<b>S/&#8595;</b> brake/reverse &nbsp;<b>A/D or &#8592;/&#8594;</b> tilt &nbsp;<b>SHIFT</b> nitro &nbsp;<b>SPACE</b> hop &nbsp;<b>ESC</b> pause &nbsp;<b>R</b> restart</p>';
  function menu() {
    state = "menu";
    show(
      '<h1>TORQUE OVERDRIVE</h1><p class="t">Endless procedural hill climb. Collect coins &amp; fuel, upgrade, go further.</p>' +
        HINT +
        '<p class="t">Best: <b>' +
        Math.floor(save.best) +
        "m</b> &nbsp; Coins: <b>" +
        save.coins +
        '</b></p><button class="btn" data-a="start">DRIVE</button><button class="btn g" data-a="garage">GARAGE</button>',
    );
  }
  function pause() {
    if (state !== "run") return;
    state = "pause";
    show(
      '<h2>PAUSED</h2><p class="t">' +
        bn() +
        " &middot; seed " +
        sim.seed +
        " &middot; " +
        Math.floor(sim.dist) +
        'm</p><button class="btn" data-a="resume">RESUME</button><button class="btn g" data-a="garage">GARAGE / UPGRADES</button><button class="btn g" data-a="start">RESTART</button>',
    );
  }
  function resume() {
    state = "run";
    hide();
    last = performance.now();
  }
  function start() {
    audio();
    if (sim && !sim.banked && (state === "run" || state === "pause")) {
      save.coins += sim.coins;
      sim.banked = 1;
      persist();
    }
    newRun(params.has("seed") && !start.used ? +params.get("seed") : null);
    start.used = 1;
    state = "run";
    hide();
    last = performance.now();
    toast(bn().toUpperCase());
  }
  function endRun() {
    state = "over";
    save.coins += sim.coins;
    const nb = sim.dist > save.best;
    if (nb) save.best = sim.dist;
    persist();
    show(
      '<h1 style="font-size:clamp(22px,5vw,40px)">' +
        (sim.over === "out of fuel" ? "OUT OF FUEL" : "CRASHED") +
        '</h1><p class="t">Distance <b>' +
        Math.floor(sim.dist) +
        "m</b>" +
        (nb ? " &mdash; NEW BEST!" : "") +
        " &middot; Coins <b>+" +
        sim.coins +
        "</b> (wallet " +
        save.coins +
        ")<br>" +
        bn() +
        " &middot; seed " +
        sim.seed +
        '</p><button class="btn" data-a="start">RETRY</button><button class="btn g" data-a="garage">GARAGE</button>',
    );
    sim.banked = 1;
  }
  function garage(from) {
    const v = save.veh,
      d = S.VEHICLES[v],
      u = save.up[v],
      owned = save.own[v],
      mid = state === "pause";
    garage.from = garage.from || state;
    if (from) garage.from = from;
    const bar = (x, m) =>
      '<u style="width:' + clamp((x / m) * 100, 5, 100) + '%"></u>';
    let h =
      '<h2>GARAGE</h2><p class="t">Coins: <b style="color:#fbbf24">' +
      (save.coins + (mid && sim && !sim.banked ? sim.coins : 0)) +
      "</b></p>";
    h +=
      '<div class="veh"><button class="btn sm g" data-a="pv"' +
      (mid ? " disabled" : "") +
      '>&#9664;</button><div class="c">' +
      d.name +
      '<div class="st"><span>Mass</span>' +
      bar(d.mass, 20) +
      "<span>Torque</span>" +
      bar(d.torque * (d.drive[0] + d.drive[1]), 50000) +
      "<span>Wheelbase</span>" +
      bar(d.wb, 84) +
      "<span>Suspension</span>" +
      bar(d.ks, 2700) +
      "</div>" +
      (owned
        ? ""
        : '<button class="btn sm" data-a="buyv"' +
          (save.coins < d.price ? " disabled" : "") +
          ">UNLOCK " +
          d.price +
          "</button>") +
      '</div><button class="btn sm g" data-a="nv"' +
      (mid ? " disabled" : "") +
      ">&#9654;</button></div>";
    if (mid)
      h +=
        '<p class="t">Vehicle can be changed between runs. Upgrades apply live.</p>';
    for (let i = 0; i < 4; i++) {
      const c = cost(u[i]);
      h +=
        '<div class="row"><div class="n">' +
        UPN[i][0] +
        "<small>" +
        UPN[i][1] +
        '</small><div class="pips">' +
        Array.from(
          { length: MAXL },
          (_, j) => '<i class="' + (j < u[i] ? "on" : "") + '"></i>',
        ).join("") +
        '</div></div><button class="btn sm" data-a="up' +
        i +
        '"' +
        (!owned || u[i] >= MAXL || avail() < c ? " disabled" : "") +
        ">" +
        (u[i] >= MAXL ? "MAX" : c) +
        "</button></div>";
    }
    h +=
      '<button class="btn" data-a="gback">' +
      (garage.from === "pause"
        ? "BACK"
        : garage.from === "over"
          ? "BACK"
          : "BACK") +
      "</button>";
    show(h);
  }
  const avail = () =>
    save.coins + (state === "pause" && sim && !sim.banked ? sim.coins : 0);
  function spend(c) {
    if (state === "pause" && sim && !sim.banked) {
      const t = Math.min(sim.coins, c);
      sim.coins -= t;
      c -= t;
    }
    save.coins -= c;
  }
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const a = b.dataset.a;
    audio();
    if (a === "start") start();
    else if (a === "resume") resume();
    else if (a === "garage") {
      garage.from = state;
      garage();
    } else if (a === "gback") {
      const f = garage.from;
      garage.from = null;
      f === "pause"
        ? ((state = "run"), pause())
        : f === "over"
          ? endScreen()
          : menu();
    } else if (a === "pv" || a === "nv") {
      save.veh = (save.veh + (a === "nv" ? 1 : 2)) % 3;
      persist();
      garage();
    } else if (a === "buyv") {
      const d = S.VEHICLES[save.veh];
      if (save.coins >= d.price) {
        save.coins -= d.price;
        save.own[save.veh] = 1;
        persist();
        garage();
      }
    } else if (a.startsWith("up")) {
      const i = +a[2],
        u = save.up[save.veh],
        c = cost(u[i]);
      if (u[i] < MAXL && avail() >= c) {
        spend(c);
        u[i]++;
        if (sim && sim.veh === save.veh) {
          const f0 = sim.st.tank;
          sim.up = u.slice();
          sim.recalc();
          if (i === 3) sim.fuel += sim.st.tank - f0;
        }
        persist();
        garage();
      }
    }
  });
  function endScreen() {
    state = "over";
    endRun.replay = 1;
    const s = sim;
    show(
      '<h1 style="font-size:clamp(22px,5vw,40px)">' +
        (s.over === "out of fuel" ? "OUT OF FUEL" : "CRASHED") +
        '</h1><p class="t">Distance <b>' +
        Math.floor(s.dist) +
        "m</b> &middot; wallet <b>" +
        save.coins +
        '</b></p><button class="btn" data-a="start">RETRY</button><button class="btn g" data-a="garage">GARAGE</button>',
    );
  }
  $("pb").onclick = () => {
    audio();
    state === "run" ? pause() : state === "pause" && resume();
  };
  function syncMute() {
    $("mb").style.opacity = save.mute ? 0.4 : 1;
    $("mb").setAttribute("aria-pressed", save.mute ? "false" : "true");
  }
  $("mb").onclick = () => {
    save.mute = save.mute ? 0 : 1;
    persist();
    syncMute();
    if (!save.mute) audio();
  };
  syncMute();
  /* ---------- background ---------- */
  let sky = null,
    stars = [];
  function buildBg() {
    const b = sim.biome;
    sky = ctx.createLinearGradient(0, 0, 0, H * DPR);
    sky.addColorStop(0, b.sky[0]);
    sky.addColorStop(1, b.sky[1]);
    stars = [];
    if (b.stars)
      for (let i = 0; i < 70; i++)
        stars.push([
          Math.random(),
          Math.random() * 0.7,
          Math.random() * 1.5 + 0.5,
        ]);
  }
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2) * qual;
    const w = cv.clientWidth || innerWidth,
      h = cv.clientHeight || innerHeight;
    W = w;
    H = h;
    cv.width = Math.max(1, Math.round(w * DPR));
    cv.height = Math.max(1, Math.round(h * DPR));
    if (sim) buildBg();
  }
  addEventListener("resize", resize);
  addEventListener("orientationchange", () => setTimeout(resize, 200));
  if (window.visualViewport) visualViewport.addEventListener("resize", resize);
  function hills(off, par, amp, col, base, sc) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, H);
    const ox = cam.x * par,
      oy = cam.y * par * 0.3;
    for (let x = 0; x <= W + 20; x += 20) {
      const wx = x + ox;
      ctx.lineTo(
        x,
        H * base -
          oy * sc +
          Math.sin(wx * 0.004 + off) * amp +
          Math.sin(wx * 0.011 + off * 2) * amp * 0.4,
      );
    }
    ctx.lineTo(W, H);
    ctx.fill();
  }
  /* ---------- render ---------- */
  function wheelDraw(w, r, al) {
    const x = w.px + (w.x - w.px) * al,
      y = w.py + (w.y - w.py) * al,
      an = w.pang + (w.ang - w.pang) * al;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(an);
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#cbd5e1";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
    }
    ctx.stroke();
    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.arc(r * 0.42, 0, 1.8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#94a3b8";
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  const line = (a, b, c, d, col, w) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a, b);
    ctx.lineTo(c, d);
    ctx.stroke();
  };
  function bodyDraw(id, col, wl) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const d = sim.def;
    for (let i = 0; i < 2; i++) {
      const ax = ((i ? 1 : -1) * d.wb) / 2,
        ay0 = d.ay,
        bx = wl[i][0],
        by = wl[i][1];
      const dx = bx - ax,
        dy = by - ay0,
        L = Math.hypot(dx, dy) || 1,
        ux = dx / L,
        uy = dy / L,
        px = -uy,
        py = ux;
      const amp = 3.2 * clamp(sim.wh[i].s / d.susL, 0.35, 1.2);
      ctx.strokeStyle = "#64748b";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(ax, ay0);
      const n = 10;
      for (let k = 1; k < n; k++) {
        const t = k / n,
          s = (k % 2 ? 1 : -1) * amp;
        ctx.lineTo(ax + ux * L * t + px * s, ay0 + uy * L * t + py * s);
      }
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(ax, ay0);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    if (id === "bike") {
      line(-24, -2, 10, -4, "#1e293b", 6);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-6, -12);
      ctx.lineTo(14, -12);
      ctx.lineTo(18, -4);
      ctx.lineTo(-4, -2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.fillRect(-22, -12, 16, 5);
      ctx.fillStyle = "#475569";
      ctx.fillRect(-4, -2, 16, 10);
      line(17, -16, 24, 6, "#cbd5e1", 3);
      line(15, -17, 20, -17, "#111", 3);
    } else if (id === "jeep") {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-46, 0);
      ctx.lineTo(-46, -14);
      ctx.lineTo(-20, -16);
      ctx.lineTo(-14, -30);
      ctx.lineTo(8, -30);
      ctx.lineTo(14, -16);
      ctx.lineTo(46, -12);
      ctx.lineTo(46, 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#cfe8ff";
      ctx.beginPath();
      ctx.moveTo(-12, -28);
      ctx.lineTo(6, -28);
      ctx.lineTo(10, -17);
      ctx.lineTo(-14, -17);
      ctx.fill();
      line(-20, -34, 10, -34, "#111", 3);
    } else {
      line(-34, -2, 34, -4, "#1e293b", 7);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-40, -6);
      ctx.lineTo(-20, -18);
      ctx.lineTo(6, -12);
      ctx.lineTo(40, -4);
      ctx.lineTo(-10, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.fillRect(-18, -14, 18, 5);
      line(18, -16, 26, -8, "#cbd5e1", 3);
    }
  }
  const RP = {};
  function riderDraw(pz) {
    ctx.lineCap = "round";
    line(pz.hipX + 3, pz.hipY, pz.k.x + 2, pz.k.y, "#1e40af", 4.2);
    line(pz.k.x + 2, pz.k.y, pz.pegX + 2, pz.pegY, "#1e40af", 4.2);
    line(pz.hipX, pz.hipY, pz.k.x, pz.k.y, "#1d4ed8", 5);
    line(pz.k.x, pz.k.y, pz.pegX, pz.pegY, "#1d4ed8", 5);
    line(pz.hipX, pz.hipY, pz.shX, pz.shY, "#f8fafc", 8);
    line(pz.shX + 2, pz.shY + 1, pz.e.x + 1, pz.e.y, "#94a3b8", 3.4);
    line(pz.e.x + 1, pz.e.y, pz.gripX + 1, pz.gripY, "#94a3b8", 3.4);
    line(pz.shX, pz.shY, pz.e.x, pz.e.y, "#e2e8f0", 4);
    line(pz.e.x, pz.e.y, pz.gripX, pz.gripY, "#e2e8f0", 4);
    ctx.fillStyle = "#e11d48";
    ctx.beginPath();
    ctx.arc(pz.headX, pz.headY, 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.arc(pz.headX, pz.headY, 6.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(pz.headX + 1, pz.headY - 2.2, 6, 3.4);
  }
  function ragDraw() {
    const n = sim.rag;
    ctx.lineCap = "round";
    line(n[2].x, n[2].y, n[4].x, n[4].y, "#1d4ed8", 5);
    line(n[4].x, n[4].y, n[5].x, n[5].y, "#1d4ed8", 5);
    line(n[1].x, n[1].y, n[2].x, n[2].y, "#f8fafc", 8);
    line(n[1].x, n[1].y, n[3].x, n[3].y, "#e2e8f0", 4);
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.arc(n[0].x, n[0].y, 6.5, 0, TAU);
    ctx.fill();
  }
  function render(al, dt) {
    const b = sim.biome,
      d = sim.def,
      iw = 1 / Math.max(1, W);
    const cx = sim.px + (sim.x - sim.px) * al,
      cy = sim.py + (sim.y - sim.py) * al,
      ca = sim.pa + (sim.a - sim.pa) * al;
    /* camera */
    const fx = sim.crashed && sim.rag ? sim.rag[0].x : cx,
      fy = sim.crashed && sim.rag ? sim.rag[0].y : cy;
    const sp = Math.hypot(sim.vx, sim.vy),
      tz =
        1 -
        Math.min(0.28, (sp / 620) * 0.22) -
        (sim.nitOn ? 0.16 : 0) -
        (sim.air > 0.4 ? 0.1 : 0);
    const kk = 1 - Math.exp(-dt * 5);
    cam.z += (tz - cam.z) * (1 - Math.exp(-dt * 3));
    cam.x += (fx + clamp(sim.vx * 0.3, -160, 220) - cam.x) * kk;
    cam.y += (fy - 20 - cam.y) * (1 - Math.exp(-dt * 4));
    const S0 = Math.min(H / 500, W / 640) * cam.z;
    k = S0;
    const rm = reducedMotion;
    let sx = 0,
      sy = 0;
    const sh = (sim.nitOn ? 3 : 0) + shake;
    if (sh > 0.1 && !rm) {
      sx = (Math.random() - 0.5) * sh;
      sy = (Math.random() - 0.5) * sh;
    }
    shake *= 0.9;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    if (stars.length) {
      ctx.fillStyle = "#fff";
      for (const s of stars) ctx.fillRect(s[0] * W, s[1] * H, s[2], s[2]);
    }
    ctx.fillStyle = b.sun;
    ctx.beginPath();
    ctx.arc(W * 0.8, H * 0.2, Math.min(W, H) * 0.06, 0, TAU);
    ctx.fill();
    hills(1, 0.05, H * 0.08, b.far[0], 0.62, 0.3);
    hills(3, 0.12, H * 0.07, b.far[1], 0.72, 0.5);
    /* world */
    const ax = W * 0.36,
      ay = H * 0.58;
    ctx.setTransform(
      DPR * k,
      0,
      0,
      DPR * k,
      DPR * (ax - cam.x * k + sx),
      DPR * (ay - cam.y * k + sy),
    );
    const x0 = cam.x - ax / k - 40,
      x1 = cam.x + (W - ax) / k + 40,
      T = sim.T,
      DX = T.DX;
    const i0 = Math.max(0, Math.floor(x0 / DX)),
      i1 = Math.ceil(x1 / DX);
    T.extend(x1 + 500);
    const yb = cam.y + (H - ay) / k + 60;
    const gr = ctx.createLinearGradient(0, cam.y - 300, 0, cam.y + 600);
    gr.addColorStop(0, b.dirt[0]);
    gr.addColorStop(1, b.dirt[1]);
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(i0 * DX, yb);
    const step = Math.max(4, DX / 2);
    for (let x = i0 * DX; x <= i1 * DX; x += step) ctx.lineTo(x, T.crY(x));
    ctx.lineTo(i1 * DX, T.crY(i1 * DX));
    ctx.lineTo(i1 * DX, yb);
    ctx.fill();
    ctx.strokeStyle = b.top;
    ctx.lineWidth = 8;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let x = i0 * DX; x <= i1 * DX; x += step) {
      x === i0 * DX ? ctx.moveTo(x, T.crY(x) + 1) : ctx.lineTo(x, T.crY(x) + 1);
    }
    ctx.stroke();
    ctx.strokeStyle = b.deco;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = i0 - (i0 % 3); i <= i1; i += 3) {
      const h = ((i * 2654435761) >>> 0) % 100;
      if (h < 55) {
        const y = T.ys[i] + 12 + (h % 5) * 6;
        ctx.moveTo(i * DX, y);
        ctx.lineTo(i * DX + 6 + (h % 7), y);
      }
    }
    ctx.stroke();
    if (x0 < 120) {
      line(60, T.y(60), 60, T.y(60) - 46, "#fff", 3);
      ctx.fillStyle = "#dc2626";
      ctx.fillRect(60, T.y(60) - 46, 30, 14);
    }
    /* items */
    const it = T.items,
      tt = performance.now() / 300;
    for (let i = sim.iScan; i < it.length && it[i].x < x1 + 200; i++) {
      const o = it[i];
      if (!o.on || o.x < x0 - 200) continue;
      if (o.t === 1) {
        ctx.fillStyle = "#dc2626";
        ctx.fillRect(o.x - 8, o.y - 10, 16, 20);
        ctx.fillStyle = "#fff";
        ctx.fillRect(o.x - 5, o.y - 3, 10, 5);
        ctx.fillStyle = "#111";
        ctx.fillRect(o.x - 4, o.y - 14, 8, 4);
      } else {
        const w = Math.abs(Math.cos(tt + o.x * 0.05)),
          r = o.t === 2 ? 11 : 7;
        ctx.fillStyle = o.t === 2 ? "#f97316" : "#fbbf24";
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, Math.max(1.5, r * w), r, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "#b45309";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    /* vehicle */
    const R = d.wr,
      wl = [];
    for (let i = 0; i < 2; i++) {
      const w = sim.wh[i],
        wx = w.px + (w.x - w.px) * al - cx,
        wy = w.py + (w.y - w.py) * al - cy,
        c = Math.cos(-ca),
        s = Math.sin(-ca);
      wl.push([wx * c - wy * s, wx * s + wy * c]);
    }
    wheelDraw(sim.wh[0], R, al);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ca);
    bodyDraw(d.id, d.color, wl);
    if (!sim.crashed) riderDraw(S.riderPose(sim, RP));
    ctx.restore();
    wheelDraw(sim.wh[1], R, al);
    if (sim.crashed && sim.rag) ragDraw();
    /* particles */
    for (let i = 0; i < NP; i++) {
      const p = P[i];
      if (p.a <= 0) continue;
      const a = clamp(p.a, 0, 1);
      ctx.globalAlpha = a * (p.t === 1 ? 0.5 : 1);
      ctx.fillStyle =
        p.t === 2
          ? a > 0.55
            ? "#fde047"
            : "#f97316"
          : p.t === 3
            ? "#fde68a"
            : p.t === 4
              ? "#78716c"
              : p.t === 1
                ? "#cbd5e1"
                : b.top === "#ffffff"
                  ? "#e2f2ff"
                  : "#b8a37a";
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  /* ---------- HUD ---------- */
  const H_ = { d: $("dst"), c: $("cn"), s: $("spd"), f: $("bf"), n: $("bn") },
    hc = {};
  const fi = { f: H_.f.firstChild, n: H_.n.firstChild };
  function setT(el, key, v) {
    if (hc[key] !== v) {
      hc[key] = v;
      el.textContent = v;
    }
  }
  function hud() {
    setT(H_.d, "d", Math.floor(sim.dist) + "m");
    setT(H_.c, "c", String(sim.coins));
    setT(H_.s, "s", Math.round(sim.kmh) + " km/h");
    const f = sim.fuel / sim.st.tank;
    const fw = Math.round(f * 100) + "%";
    if (hc.fw !== fw) {
      hc.fw = fw;
      H_.f.firstElementChild.style.width = fw;
      H_.f.classList.toggle("low", f < 0.25);
    }
    const nw = Math.round(sim.nitro) + "%";
    if (hc.nw !== nw) {
      hc.nw = nw;
      H_.n.firstElementChild.style.width = nw;
    }
    H_.n.classList.toggle("hot", !!sim.nitOn);
  }
  /* ---------- main loop ---------- */
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!(dt > 0)) dt = 0.001;
    const t0 = performance.now();
    if (state === "run") {
      readInput();
      acc += dt;
      let n = 0;
      while (acc >= S.DT && n < 12) {
        sim.step(inp);
        acc -= S.DT;
        n++;
      }
      if (n === 12) acc = 0;
      stepP(dt);
      if (sim.thrS > 0.2 && sim.wh[0].gr && !sim.crashed) {
        if (Math.random() < (0.45 + sim.thrS * 0.4) * qual)
          emit(
            0,
            sim.wh[0].x,
            sim.wh[0].y + sim.def.wr,
            1 + (sim.thrS > 0.7 ? 1 : 0),
            48 + sim.kmh * 0.4,
            -sim.vx * 0.35,
            -24,
          );
      }
      if (sim.thrS > 0.15 && !sim.crashed) {
        const c = Math.cos(sim.a),
          s = Math.sin(sim.a),
          lx = -sim.def.wb / 2 - 22;
        if (Math.random() < 0.35 * qual)
          emit(
            1,
            sim.x + lx * c + 4 * s,
            sim.y + lx * s - 4 * c,
            1,
            18,
            -c * 80,
            -s * 80,
          );
      }
      if (sim.nitOn) {
        const c = Math.cos(sim.a),
          s = Math.sin(sim.a),
          lx = -sim.def.wb / 2 - 26;
        emit(
          2,
          sim.x + lx * c + 2 * s,
          sim.y + lx * s - 2 * c,
          3,
          55,
          -c * 260 + sim.vx * 0.3,
          -s * 260 + sim.vy * 0.3,
        );
        shake = Math.max(shake, 2.4);
      }
      if (sim.crashed && Math.random() < 0.3) emit(1, sim.x, sim.y - 10, 1, 25);
      if (toastT > 0 && (toastT -= dt) <= 0) $("toast").style.opacity = 0;
    } else if (sim) {
      stepP(dt);
      acc = 0;
    }
    if (sim) {
      render(state === "run" ? acc / S.DT : 1, dt);
      if (state === "run") hud();
      engineSnd();
      if (state === "pause") {
        /* frozen */
      }
    }
    /* adaptive quality: keep frame time under budget on slow devices */
    const ft = now - (frame.p || now);
    frame.p = now;
    if (ft > 0 && ft < 200) ema += (ft - ema) * 0.05;
    if (ema > 24 && qual > 0.55 && ++slow > 90) {
      qual = Math.max(0.55, qual * 0.8);
      slow = 0;
      ema = 16;
      resize();
    } else if (ema <= 24) slow = 0;
    frame.cost = performance.now() - t0;
    frame.ema = ema;
  }
  resize();
  newRun(params.has("seed") ? +params.get("seed") : null);
  menu();
  last = performance.now();
  requestAnimationFrame(frame);
  window.__tod = {
    get sim() {
      return sim;
    },
    get state() {
      return state;
    },
    frame,
    S,
    P,
  };
})();
