(() => {
  "use strict";
  const S = window.TOSim,
    $ = (i) => document.getElementById(i),
    TAU = Math.PI * 2,
    clamp = S.clamp;
  const cv = $("c"),
    ctx = cv.getContext("2d", { alpha: false });
  if (!ctx) {
    const n = $("nocanvas");
    if (n) n.style.display = "flex";
    return;
  }
  /* ---------- save ---------- */
  const SAVE_KEY = "tod2";
  const DEF_BINDS = {
    thr: ["KeyW", "ArrowUp"],
    brk: ["KeyS", "ArrowDown"],
    L: ["KeyA", "ArrowLeft"],
    R: ["KeyD", "ArrowRight"],
    nit: ["ShiftLeft", "ShiftRight"],
    hop: ["Space"],
  };
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
    volM: 80,
    volS: 80,
    volMus: 40,
    qmode: 1,
    rm: 0,
    hap: 1,
    fps: 0,
    layout: "right",
    ctrlSize: "md",
    seenTut: 0,
    biomeBest: {},
    biomeCoins: {},
    stats: { runs: 0, dist: 0, coins: 0, flips: 0, crashes: 0, fuelouts: 0 },
    ach: {},
    binds: {},
  };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (s && typeof s === "object") {
      if (Array.isArray(s.up) && Array.isArray(s.own)) {
        save.coins = s.coins | 0;
        save.best = +s.best || 0;
        save.veh = s.veh | 0;
        save.own = [s.own[0] | 0, s.own[1] | 0, s.own[2] | 0];
        save.up = [0, 1, 2].map((i) =>
          Array.isArray(s.up[i])
            ? [s.up[i][0] | 0, s.up[i][1] | 0, s.up[i][2] | 0, s.up[i][3] | 0]
            : [0, 0, 0, 0],
        );
        save.mute = s.mute ? 1 : 0;
      }
      if (s.volM != null) save.volM = clamp(s.volM | 0, 0, 100);
      if (s.volS != null) save.volS = clamp(s.volS | 0, 0, 100);
      if (s.volMus != null) save.volMus = clamp(s.volMus | 0, 0, 100);
      if (s.qmode != null) save.qmode = clamp(s.qmode | 0, 0, 2);
      if (s.rm != null) save.rm = s.rm ? 1 : 0;
      if (s.hap != null) save.hap = s.hap ? 1 : 0;
      if (s.fps != null) save.fps = s.fps ? 1 : 0;
      if (s.layout === "left" || s.layout === "right") save.layout = s.layout;
      if (s.ctrlSize === "sm" || s.ctrlSize === "md" || s.ctrlSize === "lg")
        save.ctrlSize = s.ctrlSize;
      save.seenTut = s.seenTut ? 1 : 0;
      if (s.biomeBest && typeof s.biomeBest === "object") save.biomeBest = s.biomeBest;
      if (s.biomeCoins && typeof s.biomeCoins === "object") save.biomeCoins = s.biomeCoins;
      if (s.stats && typeof s.stats === "object")
        save.stats = Object.assign(save.stats, s.stats);
      if (s.ach && typeof s.ach === "object") save.ach = s.ach;
      if (s.binds && typeof s.binds === "object") save.binds = s.binds;
    }
  } catch (e) {}
  const persist = () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch (e) {}
  };
  function applyChrome() {
    document.body.classList.toggle("showfps", !!save.fps);
    document.body.classList.toggle("ctrl-left", save.layout === "left");
    document.body.classList.toggle("ctrl-lg", save.ctrlSize === "lg");
    document.body.classList.toggle("ctrl-sm", save.ctrlSize === "sm");
  }
  applyChrome();
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
    resetWind();
  }
  const NW = 28;
  const wX = new Float32Array(NW),
    wY = new Float32Array(NW),
    wL = new Float32Array(NW),
    wTh = new Float32Array(NW),
    wA = new Float32Array(NW),
    wZ = new Float32Array(NW),
    wPh = new Float32Array(NW);
  let windI = 0,
    windT = 0,
    windOn = 0,
    wxT = 0;
  function windRoll(i) {
    wL[i] = 40 + Math.random() * 100;
    wTh[i] = 0.8 + Math.random() * 1.2;
    wA[i] = 0.04 + Math.random() * 0.18;
    wZ[i] = 0.6 + Math.random() * 0.8;
    wPh[i] = Math.random() * TAU;
  }
  function windPlace(i, x0, y0, vw, vh, nx, ny, edge) {
    windRoll(i);
    const around = Math.random() < 0.62;
    let px = around ? sim.x + (Math.random() - 0.5) * vw * 0.55 : x0 + Math.random() * vw;
    let py = around ? sim.y + (Math.random() - 0.5) * vh * 0.55 : y0 + Math.random() * vh;
    if (edge) {
      if (Math.abs(nx) >= Math.abs(ny)) {
        px = nx >= 0 ? x0 + vw + 8 : x0 - 8;
        py = y0 + Math.random() * vh;
      } else {
        py = ny >= 0 ? y0 + vh + 8 : y0 - 8;
        px = x0 + Math.random() * vw;
      }
    }
    wX[i] = px;
    wY[i] = py;
  }
  function resetWind() {
    windI = 0;
    windT = 0;
    windOn = 0;
    wxT = 0;
    for (let i = 0; i < NW; i++) {
      wX[i] = 0;
      wY[i] = 0;
      windRoll(i);
    }
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
    masterG = null,
    sfxG = null,
    musG = null,
    engG = null,
    engOsc = null,
    engOsc2 = null,
    engFlt = null,
    musNodes = null,
    audioReady = 0;
  const vol = (n) => (save.mute ? 0 : clamp(n, 0, 100) / 100);
  function audio() {
    try {
      if (!AC) {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        masterG = AC.createGain();
        sfxG = AC.createGain();
        musG = AC.createGain();
        engG = AC.createGain();
        masterG.gain.value = vol(save.volM);
        sfxG.gain.value = vol(save.volS);
        musG.gain.value = vol(save.volMus) * 0.35;
        engG.gain.value = 0;
        sfxG.connect(masterG);
        musG.connect(masterG);
        engG.connect(masterG);
        masterG.connect(AC.destination);
        engOsc = AC.createOscillator();
        engOsc2 = AC.createOscillator();
        engFlt = AC.createBiquadFilter();
        engOsc.type = "sawtooth";
        engOsc2.type = "square";
        engFlt.type = "lowpass";
        engFlt.frequency.value = 700;
        engFlt.Q.value = 0.7;
        const eg2 = AC.createGain();
        eg2.gain.value = 0.18;
        engOsc.connect(engFlt);
        engOsc2.connect(eg2);
        eg2.connect(engFlt);
        engFlt.connect(engG);
        engOsc.start();
        engOsc2.start();
        startMusic();
        audioReady = 1;
      }
      if (AC.state === "suspended") AC.resume();
      applyVol();
    } catch (e) {
      AC = null;
    }
  }
  function applyVol() {
    if (!AC) return;
    try {
      const t = AC.currentTime;
      masterG.gain.setTargetAtTime(vol(save.volM), t, 0.04);
      sfxG.gain.setTargetAtTime(vol(save.volS), t, 0.04);
      musG.gain.setTargetAtTime(vol(save.volMus) * 0.35, t, 0.08);
    } catch (e) {}
  }
  function startMusic() {
    if (!AC || musNodes) return;
    try {
      const notes = [110, 138.59, 164.81, 146.83, 123.47, 164.81, 196, 174.61];
      const o = AC.createOscillator(),
        o2 = AC.createOscillator(),
        g = AC.createGain(),
        f = AC.createBiquadFilter();
      o.type = "triangle";
      o2.type = "sine";
      f.type = "lowpass";
      f.frequency.value = 420;
      g.gain.value = 0.07;
      o.connect(f);
      o2.connect(f);
      f.connect(g);
      g.connect(musG);
      o.start();
      o2.start();
      let i = 0;
      const tick = () => {
        if (!AC || AC.state !== "running") return;
        const n = notes[i++ % notes.length];
        try {
          o.frequency.setTargetAtTime(n, AC.currentTime, 0.04);
          o2.frequency.setTargetAtTime(n * 1.5, AC.currentTime, 0.06);
        } catch (e) {}
      };
      tick();
      musNodes = { o, o2, g, id: setInterval(tick, 520) };
    } catch (e) {}
  }
  function blip(f, d, t, g0) {
    if (!AC || save.mute) return;
    try {
      const o = AC.createOscillator(),
        g = AC.createGain();
      o.type = t || "sine";
      o.frequency.value = f;
      const a = (g0 || 0.12) * vol(save.volS);
      g.gain.setValueAtTime(Math.max(0.0001, a), AC.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + d);
      o.connect(g);
      g.connect(sfxG);
      o.start();
      o.stop(AC.currentTime + d + 0.02);
    } catch (e) {}
  }
  function noiseBurst(d, f0, q, amp) {
    if (!AC || save.mute) return;
    try {
      const n = AC.createBuffer(1, AC.sampleRate * d, AC.sampleRate);
      const ch = n.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      const src = AC.createBufferSource(),
        bp = AC.createBiquadFilter(),
        g = AC.createGain();
      src.buffer = n;
      bp.type = "bandpass";
      bp.frequency.value = f0;
      bp.Q.value = q;
      g.gain.setValueAtTime(amp, AC.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + d);
      src.connect(bp);
      bp.connect(g);
      g.connect(sfxG);
      src.start();
      src.stop(AC.currentTime + d + 0.02);
    } catch (e) {}
  }
  function sfxCoin(v) {
    blip(v > 1 ? 1100 : 880, 0.1, "square", 0.1);
    blip(v > 1 ? 1480 : 1320, 0.14, "sine", 0.08);
  }
  function sfxFuel() {
    blip(500, 0.12, "sine", 0.1);
    blip(750, 0.18, "triangle", 0.1);
  }
  function sfxLand(v) {
    noiseBurst(0.12 + Math.min(0.18, v / 1400), 180, 0.6, 0.18);
  }
  function sfxNitro() {
    noiseBurst(0.22, 420, 0.8, 0.12);
    blip(90, 0.2, "sawtooth", 0.06);
  }
  function sfxCrash() {
    noiseBurst(0.45, 90, 0.4, 0.28);
    blip(70, 0.5, "sawtooth", 0.14);
  }
  function engineSnd() {
    if (!AC || !engG) return;
    const on =
      state === "run" && !save.mute && sim && !sim.crashed && sim.fuel > 0;
    const w = sim ? Math.abs(sim.wh[0].om) : 0;
    try {
      const n = sim && sim.nitOn ? 1 : 0;
      const rpm = 42 + w * 1.55 + (sim ? sim.thrS * 28 : 0) + n * 48;
      engOsc.frequency.setTargetAtTime(rpm, AC.currentTime, 0.05);
      engOsc2.frequency.setTargetAtTime(rpm * 0.5, AC.currentTime, 0.06);
      engFlt.frequency.setTargetAtTime(480 + w * 8 + n * 280, AC.currentTime, 0.08);
      engG.gain.setTargetAtTime(
        on ? (0.028 + 0.032 * (sim ? sim.thrS : 0) + n * 0.022) * vol(save.volS) : 0,
        AC.currentTime,
        0.08,
      );
    } catch (e) {}
  }
  function hap(ms, str) {
    if (!save.hap) return;
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
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
      sfxCoin(v);
    } else if (t === "fuel") {
      emit(3, x, y, 12, 120);
      sfxFuel();
      toast("FUEL +");
    } else if (t === "land") {
      emit(0, x, y + 8, 6, 60 + v * 0.15, 0, -30);
      shake = Math.max(shake, Math.min(6, v / 120));
      if (v > 80) {
        sfxLand(v);
        hap(v > 200 ? 40 : 18);
      }
    } else if (t === "thud") emit(4, x, y, 5, 80 + v * 0.1);
    else if (t === "flip") {
      toast("FLIP x" + v + "  +" + 10 * v);
      save.stats.flips = (save.stats.flips | 0) + v;
      unlockAch("flip", "STUNT RIDER");
    } else if (t === "mile")
      toast(sim.milestone * 500 + "m  BONUS +" + 25 * sim.milestone);
    else if (t === "hop") {
      emit(0, x, y + 10, 4 + v * 8, 40 + v * 50, 0, -80);
      shake = Math.max(shake, 1.5 * v);
      blip(180 + v * 80, 0.08);
    } else if (t === "crash") {
      emit(4, x, y, 30, 220);
      shake = 10;
      sfxCrash();
      hap(80);
    } else if (t === "over") endRun();
  }
  function unlockAch(id, label) {
    if (save.ach[id]) return;
    save.ach[id] = 1;
    persist();
    toast("ACHIEVEMENT  " + label);
  }
  /* ---------- input ---------- */
  let waitBind = null;
  function bindMap() {
    const m = {};
    const src = save.binds && Object.keys(save.binds).length ? save.binds : DEF_BINDS;
    for (const act in DEF_BINDS) {
      const codes = src[act] && src[act].length ? src[act] : DEF_BINDS[act];
      for (const c of codes) m[c] = act;
    }
    return m;
  }
  let GK = bindMap();
  addEventListener("keydown", (e) => {
    if (waitBind) {
      e.preventDefault();
      if (e.code !== "Escape") {
        const nb = Object.assign({}, save.binds && Object.keys(save.binds).length ? save.binds : DEF_BINDS);
        nb[waitBind] = [e.code];
        save.binds = nb;
        persist();
        GK = bindMap();
      }
      waitBind = null;
      settings();
      return;
    }
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")) return;
    const g = GK[e.code];
    if (g) {
      keys[g] = 1;
      e.preventDefault();
      audio();
    }
    if (e.repeat) return;
    if (e.code === "Escape" || e.code === "KeyP") {
      if (state === "settings") settingsBack();
      else if (state === "run") pause();
      else if (state === "pause") resume();
    } else if (e.code === "KeyR" && (state === "run" || state === "over"))
      start();
    else if (e.code === "Enter" && (state === "menu" || state === "over"))
      start();
    else if (e.code === "KeyF") toggleFs();
  });
  addEventListener("keyup", (e) => {
    const g = GK[e.code];
    if (g) keys[g] = 0;
  });
  addEventListener("blur", () => {
    for (const q in keys) keys[q] = 0;
    for (const q in tch) tch[q] = 0;
    padDig = { thr: 0, brk: 0, L: 0, R: 0, nit: 0, hop: 0 };
    if (state === "run") pause();
    if (AC && AC.state === "running")
      try {
        AC.suspend();
      } catch (e) {}
  });
  addEventListener("focus", () => {
    if (AC && AC.state === "suspended" && !save.mute)
      try {
        AC.resume();
      } catch (e) {}
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (state === "run") pause();
      if (AC && AC.state === "running")
        try {
          AC.suspend();
        } catch (e) {}
    }
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
  document.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );
  function setTouch() {
    document.body.classList.add("touch");
  }
  let padDig = { thr: 0, brk: 0, L: 0, R: 0, nit: 0, hop: 0 },
    padAx = { thr: 0, brk: 0, lean: 0 },
    padNavT = 0,
    lastNitOn = 0;
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
  function pollPad() {
    padDig.thr = padDig.brk = padDig.L = padDig.R = padDig.nit = padDig.hop = 0;
    padAx.thr = padAx.brk = padAx.lean = 0;
    let pads;
    try {
      pads = navigator.getGamepads ? navigator.getGamepads() : null;
    } catch (e) {
      return;
    }
    if (!pads) return;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p) continue;
      const b = p.buttons,
        ax = p.axes;
      const press = (n) => b[n] && (b[n].pressed || b[n].value > 0.5);
      if (press(7) || press(0)) padDig.thr = 1;
      if (press(6) || press(1)) padDig.brk = 1;
      if (press(5) || press(2)) padDig.nit = 1;
      if (press(4) || press(3)) padDig.hop = 1;
      if (press(14) || (ax[0] || 0) < -0.45) padDig.L = 1;
      if (press(15) || (ax[0] || 0) > 0.45) padDig.R = 1;
      padAx.thr = Math.max(padAx.thr, b[7] ? b[7].value : 0);
      padAx.brk = Math.max(padAx.brk, b[6] ? b[6].value : 0);
      padAx.lean = clamp((ax[0] || 0) + (ax[2] || 0) * 0.35, -1, 1);
      const now = performance.now();
      if (now - padNavT > 220) {
        if (press(9) || press(8)) {
          padNavT = now;
          if (state === "run") pause();
          else if (state === "pause") resume();
        } else if (press(0) && (state === "menu" || state === "over")) {
          padNavT = now;
          start();
        }
      }
    }
  }
  function readInput() {
    pollPad();
    const t = state === "run";
    inp.thr = t && (keys.thr || tch.G || padDig.thr || padAx.thr > 0.15) ? 1 : 0;
    inp.brk = t && (keys.brk || tch.B || padDig.brk || padAx.brk > 0.15) ? 1 : 0;
    inp.nit = t && (keys.nit || tch.N || padDig.nit) ? 1 : 0;
    inp.hop = t && (keys.hop || tch.H || padDig.hop) ? 1 : 0;
    let lean = t ? (keys.R || tch.R || padDig.R ? 1 : 0) - (keys.L || tch.L || padDig.L ? 1 : 0) : 0;
    if (t && Math.abs(padAx.lean) > 0.18) lean = padAx.lean;
    inp.lean = lean;
    if (inp.nit && !lastNitOn && sim && sim.nitro > 2) {
      sfxNitro();
      hap(12);
    }
    lastNitOn = inp.nit;
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
  let uiFrom = "menu";
  function menu() {
    state = "menu";
    uiFrom = "menu";
    const bb = biomeLine();
    show(
      '<h1>TORQUE OVERDRIVE</h1><p class="t">Endless procedural hill climb. Collect coins &amp; fuel, upgrade, go further.</p>' +
        HINT +
        '<p class="t">Best: <b>' +
        Math.floor(save.best) +
        "m</b> &nbsp; Coins: <b>" +
        save.coins +
        "</b>" +
        (bb ? "<br>" + bb : "") +
        '</p><button class="btn" data-a="start">DRIVE</button><button class="btn g" data-a="garage">GARAGE</button><button class="btn g" data-a="settings">SETTINGS</button><button class="btn g" data-a="stats">STATS</button>',
    );
    if (!save.seenTut) {
      tutorial();
      return;
    }
  }
  function biomeLine() {
    const parts = [];
    for (const b of S.BIOMES) {
      const d = save.biomeBest[b.id];
      if (d) parts.push(b.name.split(" ")[0] + " " + Math.floor(d) + "m");
    }
    return parts.length ? parts.join(" · ") : "";
  }
  function pause() {
    if (state !== "run" && state !== "pause" && state !== "settings") return;
    state = "pause";
    uiFrom = "pause";
    show(
      '<h2>PAUSED</h2><p class="t">' +
        bn() +
        " &middot; seed " +
        sim.seed +
        " &middot; " +
        Math.floor(sim.dist) +
        'm</p><button class="btn" data-a="resume">RESUME</button><button class="btn g" data-a="garage">GARAGE / UPGRADES</button><button class="btn g" data-a="settings">SETTINGS</button><button class="btn g" data-a="start">RESTART</button>',
    );
  }
  function resume() {
    if (state !== "pause" && state !== "settings") return;
    state = "run";
    hide();
    last = performance.now();
  }
  function start() {
    audio();
    if (sim && !sim.banked && (state === "run" || state === "pause" || state === "settings")) {
      save.coins += sim.coins;
      sim.banked = 1;
      persist();
    }
    const seedQ = params.has("seed") ? +params.get("seed") : NaN;
    newRun(!start.used && isFinite(seedQ) ? seedQ >>> 0 : null);
    start.used = 1;
    for (const q in keys) keys[q] = 0;
    for (const q in tch) tch[q] = 0;
    lastNitOn = 0;
    acc = 0;
    state = "run";
    hide();
    last = performance.now();
    toast(bn().toUpperCase());
  }
  function recordRun() {
    const id = sim.biome.id;
    const d = sim.dist,
      c = sim.coins;
    if (!(save.biomeBest[id] > d)) save.biomeBest[id] = d;
    save.biomeCoins[id] = (save.biomeCoins[id] | 0) + c;
    save.stats.runs = (save.stats.runs | 0) + 1;
    save.stats.dist = (save.stats.dist || 0) + d;
    save.stats.coins = (save.stats.coins | 0) + c;
    if (sim.over === "out of fuel") save.stats.fuelouts = (save.stats.fuelouts | 0) + 1;
    else save.stats.crashes = (save.stats.crashes | 0) + 1;
    if (d >= 500) unlockAch("d500", "500m CLUB");
    if (d >= 2000) unlockAch("d2k", "LONG HAUL");
    if (save.stats.runs >= 10) unlockAch("r10", "REGULAR");
    if (save.coins + c >= 500) unlockAch("rich", "COIN HOARDER");
  }
  function shareScore() {
    const txt =
      "TORQUE OVERDRIVE — " +
      Math.floor(sim.dist) +
      "m on " +
      bn() +
      " (seed " +
      sim.seed +
      ")";
    const url = location.href.split("?")[0] + "?seed=" + sim.seed;
    if (navigator.share) {
      navigator.share({ title: "Torque Overdrive", text: txt, url }).catch(() => copyScore(txt + " " + url));
    } else copyScore(txt + " " + url);
  }
  function copyScore(s) {
    const done = () => toast("COPIED");
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(s).then(done).catch(() => fallbackCopy(s));
    else fallbackCopy(s);
  }
  function fallbackCopy(s) {
    try {
      const ta = document.createElement("textarea");
      ta.value = s;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast("COPIED");
    } catch (e) {
      toast(s);
    }
  }
  function endRun() {
    if (state === "over") return;
    state = "over";
    uiFrom = "over";
    if (!sim.banked) {
      recordRun();
      save.coins += sim.coins;
      const nb = sim.dist > save.best;
      if (nb) save.best = sim.dist;
      persist();
      sim.banked = 1;
      showOver(nb);
    } else showOver(false);
  }
  function showOver(nb) {
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
        " &middot; best here <b>" +
        Math.floor(save.biomeBest[sim.biome.id] || sim.dist) +
        "m</b></p><button class=\"btn\" data-a=\"start\">RETRY</button><button class=\"btn g\" data-a=\"garage\">GARAGE</button><button class=\"btn g\" data-a=\"share\">SHARE</button><button class=\"btn g\" data-a=\"settings\">SETTINGS</button>",
    );
  }
  function garage(from) {
    const v = save.veh,
      d = S.VEHICLES[v],
      u = save.up[v],
      owned = save.own[v],
      mid = garage.from === "pause" || state === "pause";
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
  function goBack(from) {
    from === "pause"
      ? ((state = "pause"), pause())
      : from === "over"
        ? ((state = "over"), showOver(false))
        : menu();
  }
  function togCls(on) {
    return 'class="tog' + (on ? " on" : "") + '"';
  }
  function settings() {
    uiFrom = state === "settings" ? uiFrom : state;
    state = "settings";
    const src = save.binds && Object.keys(save.binds).length ? save.binds : DEF_BINDS;
    const btxt = (a) => (src[a] && src[a][0]) || DEF_BINDS[a][0];
    show(
      '<h2>SETTINGS</h2>' +
        '<div class="setrow"><label>Master</label><input type="range" min="0" max="100" value="' +
        save.volM +
        '" data-v="volM" aria-label="Master volume"></div>' +
        '<div class="setrow"><label>SFX</label><input type="range" min="0" max="100" value="' +
        save.volS +
        '" data-v="volS" aria-label="SFX volume"></div>' +
        '<div class="setrow"><label>Music</label><input type="range" min="0" max="100" value="' +
        save.volMus +
        '" data-v="volMus" aria-label="Music volume"></div>' +
        '<div class="setrow"><label>Mute</label><button type="button" ' +
        togCls(save.mute) +
        ' data-a="mute" aria-pressed="' +
        !!save.mute +
        '"></button></div>' +
        '<div class="setrow"><label>Quality</label><select data-v="qmode" aria-label="Quality"><option value="0"' +
        (save.qmode === 0 ? " selected" : "") +
        '>Low</option><option value="1"' +
        (save.qmode === 1 ? " selected" : "") +
        '>Med</option><option value="2"' +
        (save.qmode === 2 ? " selected" : "") +
        ">High</option></select></div>" +
        '<div class="setrow"><label>Reduced motion</label><button type="button" ' +
        togCls(save.rm) +
        ' data-a="rm"></button></div>' +
        '<div class="setrow"><label>Haptics</label><button type="button" ' +
        togCls(save.hap) +
        ' data-a="hap"></button></div>' +
        '<div class="setrow"><label>Show FPS</label><button type="button" ' +
        togCls(save.fps) +
        ' data-a="fps"></button></div>' +
        '<div class="setrow"><label>Controls</label><select data-v="layout" aria-label="Control layout"><option value="right"' +
        (save.layout === "right" ? " selected" : "") +
        '>Throttle right</option><option value="left"' +
        (save.layout === "left" ? " selected" : "") +
        ">Throttle left</option></select></div>" +
        '<div class="setrow"><label>Button size</label><select data-v="ctrlSize" aria-label="Control size"><option value="sm"' +
        (save.ctrlSize === "sm" ? " selected" : "") +
        '>Small</option><option value="md"' +
        (save.ctrlSize === "md" ? " selected" : "") +
        '>Medium</option><option value="lg"' +
        (save.ctrlSize === "lg" ? " selected" : "") +
        ">Large</option></select></div>" +
        '<div class="setrow"><label>Gas</label><button class="bind btn sm g" data-a="bind-thr">' +
        btxt("thr") +
        "</button></div>" +
        '<div class="setrow"><label>Brake</label><button class="bind btn sm g" data-a="bind-brk">' +
        btxt("brk") +
        "</button></div>" +
        '<div class="setrow"><label>Nitro</label><button class="bind btn sm g" data-a="bind-nit">' +
        btxt("nit") +
        "</button></div>" +
        '<div class="setrow"><label>Hop</label><button class="bind btn sm g" data-a="bind-hop">' +
        btxt("hop") +
        '</button></div><button class="btn" data-a="sback">BACK</button>',
    );
  }
  function settingsBack() {
    const f = uiFrom;
    applyChrome();
    applyQual();
    persist();
    if (f === "pause") {
      state = "pause";
      pause();
    } else if (f === "over") {
      state = "over";
      showOver(false);
    } else menu();
  }
  function stats() {
    uiFrom = state === "stats" ? uiFrom : state;
    state = "stats";
    const st = save.stats;
    let bio = "";
    for (const b of S.BIOMES) {
      const d = save.biomeBest[b.id] || 0,
        c = save.biomeCoins[b.id] || 0;
      bio +=
        "<div class=\"row\"><div class=\"n\">" +
        b.name +
        "<small>Best " +
        Math.floor(d) +
        "m · coins " +
        c +
        "</small></div></div>";
    }
    const achs = Object.keys(save.ach);
    show(
      "<h2>STATS</h2><p class=\"t\">Runs <b>" +
        (st.runs | 0) +
        "</b> · Distance <b>" +
        Math.floor(st.dist || 0) +
        "m</b> · Coins earned <b>" +
        (st.coins | 0) +
        "</b><br>Flips <b>" +
        (st.flips | 0) +
        "</b> · Crashes <b>" +
        (st.crashes | 0) +
        "</b> · Fuel-outs <b>" +
        (st.fuelouts | 0) +
        "</b></p>" +
        bio +
        "<p class=\"t\">Achievements: <b>" +
        (achs.length ? achs.join(", ") : "none yet") +
        '</b></p><button class="btn" data-a="sback">BACK</button>',
    );
  }
  function tutorial() {
    save.seenTut = 1;
    persist();
    show(
      '<h2>HOW TO RIDE</h2><p class="t">Hold <b>GAS</b> to climb. <b>BRAKE</b> to reverse. <b>TILT</b> in air. <b>NITRO</b> dumps extra torque. Hold <b>HOP</b> to preload, release to bunny-hop. Grab fuel every ~2 km or you stall. Coins buy garage upgrades.</p>' +
        HINT +
        '<button class="btn" data-a="tutok">GOT IT</button>',
    );
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
      goBack(f);
    } else if (a === "settings") settings();
    else if (a === "stats") stats();
    else if (a === "sback") settingsBack();
    else if (a === "share") shareScore();
    else if (a === "tutok") menu();
    else if (a === "mute") {
      save.mute = save.mute ? 0 : 1;
      persist();
      applyVol();
      syncMute();
      settings();
    } else if (a === "rm") {
      save.rm = save.rm ? 0 : 1;
      persist();
      settings();
    } else if (a === "hap") {
      save.hap = save.hap ? 0 : 1;
      persist();
      settings();
    } else if (a === "fps") {
      save.fps = save.fps ? 0 : 1;
      applyChrome();
      persist();
      settings();
    } else if (a && a.startsWith("bind-")) {
      waitBind = a.slice(5);
      b.textContent = "press key…";
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
    } else if (a && a.startsWith("up")) {
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
  box.addEventListener("input", (e) => {
    const el = e.target,
      v = el.dataset.v;
    if (!v) return;
    if (el.tagName === "SELECT") {
      if (v === "qmode") save.qmode = +el.value;
      else save[v] = el.value;
      applyChrome();
      applyQual();
      persist();
    } else if (el.type === "range") {
      save[v] = +el.value;
      applyVol();
      persist();
    }
  });
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
    applyVol();
    if (!save.mute) audio();
  };
  syncMute();
  $("sb").onclick = () => {
    audio();
    if (state === "run") pause();
    settings();
  };
  function toggleFs() {
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      } else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } catch (e) {}
  }
  $("fs").onclick = () => {
    audio();
    toggleFs();
  };
  const oriEl = $("ori"),
    oriOk = $("oriok");
  function checkOri() {
    if (!oriEl) return;
    const tall = innerHeight > innerWidth * 1.15 && innerWidth < 820;
    if (tall && !checkOri.dismissed) oriEl.classList.add("on");
    else oriEl.classList.remove("on");
  }
  if (oriOk)
    oriOk.onclick = () => {
      checkOri.dismissed = 1;
      oriEl.classList.remove("on");
    };
  addEventListener("orientationchange", () => setTimeout(checkOri, 250));
  checkOri();
  const QMUL = [0.55, 0.82, 1];
  function applyQual() {
    const base = QMUL[save.qmode] || 0.82;
    qual = Math.min(qual, 1);
    if (save.qmode === 2) qual = Math.max(qual, 0.9);
    else if (save.qmode === 0) qual = Math.min(qual, 0.55);
    else qual = Math.min(Math.max(qual, 0.7), 0.9);
    qual = Math.min(qual, base + 0.15);
    if (save.qmode === 0) qual = 0.55;
    if (save.qmode === 2 && ema < 20) qual = 1;
    resize();
  }
  /* ---------- background ---------- */
  let sky = null,
    stars = [];
  const clouds = [];
  function buildBg() {
    const b = sim.biome;
    const tod = ((sim.seed >>> 8) % 100) / 100;
    const night = b.stars || tod > 0.78 || tod < 0.12;
    const dusk = !night && (tod > 0.62 || tod < 0.22);
    sky = ctx.createLinearGradient(0, 0, 0, H);
    if (night) {
      sky.addColorStop(0, b.stars ? b.sky[0] : "#0b1220");
      sky.addColorStop(1, b.stars ? b.sky[1] : "#1e293b");
    } else if (dusk) {
      sky.addColorStop(0, "#f97316");
      sky.addColorStop(0.45, b.sky[0]);
      sky.addColorStop(1, b.sky[1]);
    } else {
      sky.addColorStop(0, b.sky[0]);
      sky.addColorStop(1, b.sky[1]);
    }
    sim._tod = { night, dusk, rain: b.id === "mud" || ((sim.seed >>> 3) % 7) === 0 && b.id === "hills", snow: b.id === "arctic" };
    stars = [];
    if (b.stars || night)
      for (let i = 0; i < 90; i++)
        stars.push([
          Math.random(),
          Math.random() * 0.7,
          Math.random() * 1.5 + 0.5,
        ]);
    clouds.length = 0;
    if (!night && !b.stars)
      for (let i = 0; i < 6; i++)
        clouds.push({
          x: Math.random(),
          y: 0.08 + Math.random() * 0.28,
          s: 0.4 + Math.random() * 0.8,
          p: 0.03 + Math.random() * 0.05,
        });
  }
  function resize() {
    const cap = save.qmode === 2 ? 2 : save.qmode === 0 ? 1.15 : 1.6;
    DPR = Math.min(window.devicePixelRatio || 1, cap) * Math.min(qual, 1);
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
    const rm = reducedMotion || !!save.rm;
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
    if (clouds.length && qual > 0.6) {
      ctx.fillStyle = sim._tod && sim._tod.dusk ? "rgba(255,220,180,.18)" : "rgba(255,255,255,.16)";
      for (const c of clouds) {
        const cx = ((c.x * W + cam.x * c.p) % (W + 160)) - 80;
        ctx.beginPath();
        ctx.ellipse(cx, c.y * H, 48 * c.s, 16 * c.s, 0, 0, TAU);
        ctx.ellipse(cx + 28 * c.s, c.y * H + 4, 36 * c.s, 14 * c.s, 0, 0, TAU);
        ctx.fill();
      }
    }
    hills(1, 0.04, H * 0.09, b.far[0], 0.58, 0.22);
    hills(2.2, 0.08, H * 0.08, b.far[0], 0.64, 0.35);
    hills(3, 0.14, H * 0.07, b.far[1], 0.74, 0.5);
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
    if (qual > 0.5) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = "#000";
      for (let i = 0; i < 2; i++) {
        const w = sim.wh[i],
          wx = w.px + (w.x - w.px) * al,
          wy = w.py + (w.y - w.py) * al,
          gy = T.y(wx);
        ctx.beginPath();
        ctx.ellipse(wx, gy + 2, R * 1.15, R * 0.32, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
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
    const spd = Math.hypot(sim.vx, sim.vy);
    const wdt = state === "run" ? dt : 0;
    let wTgt = 0;
    if (!rm && qual > 0.55) {
      let t = clamp((spd - 180) / 720, 0, 1);
      t = t * t * (3 - 2 * t);
      if (sim.nitOn) t = t + (1 - t) * 0.45;
      if (sim.air > 0.25 && sim.vy > 30) t = t + (1 - t) * 0.28;
      wTgt = t;
    }
    if (wdt) {
      windI += (wTgt - windI) * Math.min(1, wdt * 4.2);
      if (windI < 0.008 && wTgt <= 0) windI = 0;
    }
    if (windI > 0 && !rm && qual > 0.55) {
      const ax0 = cam.x - ax / k,
        ay0 = cam.y - ay / k,
        vw = W / k,
        vh = H / k,
        x0 = ax0 - 40,
        y0 = ay0 - 40,
        x1 = ax0 + vw + 40,
        y1 = ay0 + vh + 40;
      const inv = spd > 1 ? 1 / spd : 0,
        nx = sim.vx * inv,
        ny = sim.vy * inv;
      const nW = Math.max(10, (NW * clamp(qual, 0.55, 1) + 0.5) | 0);
      if (!windOn) {
        for (let i = 0; i < nW; i++) windPlace(i, ax0, ay0, vw, vh, nx, ny, 0);
        windOn = 1;
      }
      windT += wdt;
      ctx.strokeStyle = "#fff";
      ctx.lineCap = "round";
      for (let i = 0; i < nW; i++) {
        if (wdt) {
          wX[i] -= sim.vx * wdt * wZ[i] * 0.9;
          wY[i] -= sim.vy * wdt * wZ[i] * 0.9;
        }
        if (wX[i] < x0 || wX[i] > x1 || wY[i] < y0 || wY[i] > y1)
          windPlace(i, ax0, ay0, vw, vh, nx, ny, 1);
        const wob = Math.sin(windT * 7 + wPh[i]) * 3,
          px = -ny,
          py = nx,
          hx = wX[i] + px * wob,
          hy = wY[i] + py * wob,
          len = wL[i],
          tx = hx + nx * len,
          ty = hy + ny * len,
          mx = (hx + tx) * 0.5,
          my = (hy + ty) * 0.5,
          a = windI * wA[i];
        ctx.lineWidth = wTh[i];
        ctx.globalAlpha = a * 0.28;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(mx, my);
        ctx.stroke();
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(hx, hy);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const tw = sim._tod;
    if (tw && (tw.rain || tw.snow) && qual > 0.55 && !rm) {
      ctx.strokeStyle = tw.snow ? "rgba(255,255,255,.55)" : "rgba(180,210,255,.35)";
      ctx.lineWidth = tw.snow ? 1.6 : 1;
      ctx.beginPath();
      const n = tw.snow ? 40 : 55;
      wxT += wdt;
      const tnow = wxT * (tw.snow ? 40 : 180);
      for (let i = 0; i < n; i++) {
        const rx = cam.x + ((i * 97 + tnow) % (W / k + 80)) - 40,
          ry = cam.y - 80 + ((i * 53 + tnow * (tw.snow ? 0.6 : 2.2)) % (H / k + 120));
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + (tw.snow ? 1 : 4), ry + (tw.snow ? 3 : 10));
      }
      ctx.stroke();
    }
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
      H_.f.firstElementChild.style.transform = "scaleX(" + f + ")";
      H_.f.classList.toggle("low", f < 0.25);
    }
    const nw = Math.round(sim.nitro) + "%";
    if (hc.nw !== nw) {
      hc.nw = nw;
      H_.n.firstElementChild.style.transform = "scaleX(" + sim.nitro / 100 + ")";
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
    const ft = now - (frame.p || now);
    frame.p = now;
    if (ft > 0 && ft < 200) ema += (ft - ema) * 0.05;
    const qMin = save.qmode === 0 ? 0.55 : save.qmode === 2 ? 0.75 : 0.55;
    if (save.qmode !== 2 && ema > 24 && qual > qMin && ++slow > 90) {
      qual = Math.max(qMin, qual * 0.8);
      slow = 0;
      ema = 16;
      resize();
    } else if (ema <= 24) slow = 0;
    if (save.fps) {
      const fpsEl = $("fps");
      if (fpsEl && now - (hud.ft || 0) > 400) {
        hud.ft = now;
        fpsEl.textContent = Math.round(1000 / Math.max(ema, 1)) + " fps";
      }
    }
    frame.cost = performance.now() - t0;
    frame.ema = ema;
  }
  if ("serviceWorker" in navigator) {
    addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
    let hadSW = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadSW) toast("Update ready – reload");
      hadSW = true;
    });
  }
  applyQual();
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
    get save() {
      return save;
    },
    get wind() {
      return { x: wX, y: wY, i: windI, n: NW, L: wL };
    },
    frame,
    S,
    P,
  };
})();
