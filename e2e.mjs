#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = "/sub";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain",
};

function serve() {
  const srv = http.createServer((req, res) => {
    let u = decodeURIComponent((req.url || "/").split("?")[0]);
    if (!u.startsWith(PREFIX)) {
      res.writeHead(404);
      res.end("not under /sub");
      return;
    }
    let rel = u.slice(PREFIX.length) || "/";
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(ROOT, rel.replace(/^\/+/, "")));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("404");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

async function loadPlaywright() {
  const tries = [
    "playwright",
    "/usr/local/lib/node_modules/playwright/index.mjs",
    pathToFileURL(path.join(ROOT, "node_modules/playwright/index.mjs")).href,
  ];
  for (const p of tries) {
    try {
      return await import(p);
    } catch {}
  }
  return null;
}

const seed = {
  coins: 2000,
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
  seenTut: 1,
  biomeBest: {},
  biomeCoins: {},
  stats: { runs: 0, dist: 0, coins: 0, flips: 0, crashes: 0, fuelouts: 0 },
  ach: {},
  binds: {},
};

async function runSuite(browser, origin, opts) {
  const errors = [];
  const failed = [];
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  await context.addInitScript((payload) => {
    if (payload.blockLS) {
      const boom = () => {
        throw new Error("blocked");
      };
      const ls = { getItem: boom, setItem: boom, removeItem: boom, clear: boom };
      Object.defineProperty(window, "localStorage", { get: () => ls });
    } else if (!localStorage.getItem("tod2")) {
      localStorage.setItem("tod2", payload.seed);
    }
    if (payload.blockAC) {
      const T = function () {
        throw new Error("blocked");
      };
      window.AudioContext = T;
      window.webkitAudioContext = T;
    }
  }, {
    seed: JSON.stringify(seed),
    blockLS: !!opts.blockLS,
    blockAC: !!opts.blockAC,
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("requestfailed", (req) => {
    failed.push(req.url() + " " + (req.failure() && req.failure().errorText));
  });
  page.on("response", (res) => {
    if (res.status() === 404) failed.push("404 " + res.url());
  });
  const url = origin + PREFIX + "/";
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => window.__tod && window.__tod.state, { timeout: 15000 });
  if (opts.light) {
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__tod.state === "run" || window.__tod.state === "menu", { timeout: 5000 });
    await context.close();
    return { errors, failed };
  }
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__tod.state === "run", { timeout: 8000 });
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(4000);
  await page.keyboard.up("KeyW");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__tod.state === "pause", { timeout: 5000 });
  await page.click('[data-a="resume"]');
  await page.waitForFunction(() => window.__tod.state === "run", { timeout: 5000 });
  await page.evaluate(() => {
    window.__tod.sim.crash("crash");
  });
  await page.waitForFunction(() => window.__tod.state === "over", { timeout: 8000 });
  await page.click('[data-a="garage"]');
  await page.waitForSelector('[data-a="nv"]');
  await page.click('[data-a="nv"]');
  await page.waitForSelector('[data-a="buyv"]');
  await page.click('[data-a="buyv"]');
  await page.waitForFunction(() => window.__tod.save.own[1] === 1, { timeout: 5000 });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__tod && window.__tod.save, { timeout: 10000 });
  const own = await page.evaluate(() => window.__tod.save.own[1]);
  if (own !== 1) errors.push("save did not persist garage buy");
  await page.click('[data-a="settings"]');
  await page.waitForSelector('[data-a="mute"]');
  await page.click('[data-a="mute"]');
  await page.click('[data-a="fps"]');
  await page.click('[data-a="bind-thr"]');
  await page.keyboard.press("KeyQ");
  await page.waitForFunction(() => {
    const b = window.__tod.save.binds;
    return b && b.thr && b.thr[0] === "KeyQ";
  }, { timeout: 5000 });
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return;
    await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__tod && window.__tod.state, { timeout: 15000 });
  await context.setOffline(true);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__tod && window.__tod.state, { timeout: 15000 });
  await context.setOffline(false);
  await context.close();
  return { errors, failed };
}

function failOrSkip(msg) {
  if (process.env.CI) {
    console.error(msg);
    process.exit(1);
  }
  console.log("e2e skip (" + msg + ")");
  process.exit(0);
}

const pw = await loadPlaywright();
if (!pw) failOrSkip("playwright not installed");

const { srv, port } = await serve();
const origin = "http://127.0.0.1:" + port;
let browser;
try {
  const launch = { headless: true };
  if (process.env.CHROME) launch.executablePath = process.env.CHROME;
  try {
    browser = await pw.chromium.launch(launch);
  } catch (e) {
    srv.close();
    failOrSkip("browser missing: " + (e && e.message));
  }
  const a = await runSuite(browser, origin, {});
  const b = await runSuite(browser, origin, { blockLS: 1, light: 1 });
  const c = await runSuite(browser, origin, { blockAC: 1, light: 1 });
  const bad = [...a.errors, ...b.errors, ...c.errors].filter(Boolean);
  const net = [...a.failed, ...b.failed, ...c.failed].filter((u) => !/favicon/.test(u));
  if (bad.length || net.length) {
    console.log("e2e FAIL");
    bad.forEach((x) => console.log("ERR", x));
    net.forEach((x) => console.log("NET", x));
    process.exit(1);
  }
  console.log("e2e ok");
} finally {
  if (browser) await browser.close();
  srv.close();
}
