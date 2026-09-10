import test from "node:test";
import assert from "node:assert";
import { overpass, lodgingQuery, MIRRORS, MIRROR_TIMEOUT_MS, queryMirror } from "../js/places.js";
import { mapsUrl, bookingUrl } from "../js/ui.js";

// ---------- lodgingQuery ----------
test("lodgingQuery: 5km radius, nodes AND ways (smaller set = faster + lighter on mirrors)", () => {
  const q = lodgingQuery(33.45, -112.07);
  assert.ok(q.includes("around:5000,"), "should search a 5km radius");
  assert.ok(!q.includes("around:12000,"), "the old 12km radius is gone");
  assert.ok(q.includes('node["tourism"'), "should query nodes");
  assert.ok(q.includes('way["tourism"'), "should query ways");
  assert.ok(q.includes("out center"), "should emit center coords for ways");
});

// ---------- overpass() single primary + fallback ----------
// The old 3-way parallel race tripled our request load per stop and got
// multi-stop trips rate-limited (429). Contract now: ONE request at a time,
// fallback only when the primary fails.
const jsonResp = (elements) => ({ ok: true, status: 200, json: async () => ({ elements }) });

function stubFetch(behaviors) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (url, opts) => {
    const i = MIRRORS.indexOf(String(url));
    assert.ok(i >= 0, `unexpected mirror ${url}`);
    calls.push(i);
    return behaviors[i](opts);
  };
  return { restore: () => { globalThis.fetch = real; }, calls };
}

test("overpass: primary answers -> exactly ONE request, no fallback fired", async (t) => {
  const { restore, calls } = stubFetch([
    () => Promise.resolve(jsonResp([{ tags: { name: "primary" } }])),
    () => Promise.reject(new Error("fallback must not be called")),
  ]);
  t.after(restore);

  const els = await overpass("q");
  assert.strictEqual(els[0].tags.name, "primary");
  assert.deepStrictEqual(calls, [0], "no parallel race: fallback must not fire when primary works");
});

test("overpass: primary down -> falls back to second mirror", async (t) => {
  const { restore, calls } = stubFetch([
    () => Promise.reject(new Error("connection refused")),
    () => Promise.resolve(jsonResp([{ tags: { name: "fallback" } }])),
  ]);
  t.after(restore);

  const els = await overpass("q");
  assert.strictEqual(els[0].tags.name, "fallback");
  assert.deepStrictEqual(calls, [0, 1]);
});

test("overpass: primary rate-limited (429) -> treated as failure, fallback used", async (t) => {
  const { restore, calls } = stubFetch([
    () => Promise.resolve({ ok: false, status: 429, json: async () => ({}) }),
    () => Promise.resolve(jsonResp([{ tags: { name: "fallback" } }])),
  ]);
  t.after(restore);

  const els = await overpass("q");
  assert.strictEqual(els[0].tags.name, "fallback");
  assert.deepStrictEqual(calls, [0, 1]);
});

test("overpass: empty result from primary is returned as-is (single source of truth, no grace window)", async (t) => {
  const { restore, calls } = stubFetch([
    () => Promise.resolve(jsonResp([])),
    () => Promise.reject(new Error("fallback must not be called")),
  ]);
  t.after(restore);

  const els = await overpass("q");
  assert.deepStrictEqual(els, []);
  assert.deepStrictEqual(calls, [0]);
});

test("overpass: all mirrors fail -> rejects with friendly error", async (t) => {
  const { restore } = stubFetch(MIRRORS.map(() => () => Promise.reject(new Error("network down"))));
  t.after(restore);
  await assert.rejects(overpass("q"), /Map data service unavailable/);
});

test("overpass: a slow-but-healthy response inside the timeout is NOT aborted — the 'rate limited' regression", async (t) => {
  // mail.ru routinely takes 6–15s for the lodging query. The old 10s timeout
  // aborted these healthy responses and the app showed "Map data service
  // unavailable" — which users read as rate-limiting.
  assert.ok(MIRROR_TIMEOUT_MS >= 15000, `MIRROR_TIMEOUT_MS must cover slow-but-healthy responses, got ${MIRROR_TIMEOUT_MS}ms`);
  // Behavioral half: a response that lands well inside the (injected) timeout
  // must be accepted, not aborted.
  const { restore } = stubFetch([
    (opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      setTimeout(() => resolve(jsonResp([{ tags: { name: "slow-but-healthy" } }])), 2000);
    }),
  ]);
  t.after(restore);

  const els = await queryMirror(MIRRORS[0], "q", 5000);
  assert.strictEqual(els[0].tags.name, "slow-but-healthy", "a slow response inside the timeout must be accepted, not aborted");
});

test("overpass: a mirror that truly hangs past the timeout is aborted (abort path, fast via injected timeout)", async (t) => {
  const { restore } = stubFetch([
    (opts) => new Promise((_, reject) => {
      opts.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  ]);
  t.after(restore);

  const t0 = Date.now();
  await assert.rejects(queryMirror(MIRRORS[0], "q", 50), /aborted|AbortError/);
  assert.ok(Date.now() - t0 < 2000, "must abort via the injected 50ms timeout, not wait out 30s");
});

// ---------- link builders ----------
// Contract: Maps -> Google Maps of the lodging's address (the exact place).
// Booking -> the lodging's own website when OSM has one; otherwise Google
// Maps for that specific lodging (its listing/website is on the place page).
// No more generic web searches — they were the "confusing links" complaint.
test("mapsUrl: points at Google Maps with the lodging's address", () => {
  const u = mapsUrl({ name: "Hotel San Carlos", address: "123 Main St, Phoenix, AZ", lat: 33.45, lon: -112.07 });
  assert.ok(u.startsWith("https://www.google.com/maps/search/?api=1&query="));
  assert.ok(u.includes(encodeURIComponent("123 Main St")));
  assert.ok(u.includes(encodeURIComponent("Hotel San Carlos")));
});

test("mapsUrl: name only when no address is known", () => {
  const u = mapsUrl({ name: "Motel X", lat: 33.45, lon: -112.07 });
  assert.ok(u.endsWith(encodeURIComponent("Motel X")));
});

test("bookingUrl: the lodging's own website when OSM has one", () => {
  assert.strictEqual(
    bookingUrl({ name: "Hyatt", website: "https://phoenix.hyatt.com/en/hotel/home.html" }),
    "https://phoenix.hyatt.com/en/hotel/home.html",
  );
});

test("bookingUrl: no website -> Google Maps for that specific lodging (NOT a web search)", () => {
  const u = bookingUrl({ name: "Motel X", address: "1 Main St, Phoenix" });
  assert.ok(u.startsWith("https://www.google.com/maps/search/?api=1&query="),
    "must be a Google Maps link, not google.com/search");
  assert.ok(u.includes(encodeURIComponent("Motel X")));
  assert.ok(u.includes(encodeURIComponent("1 Main St")));
});

test("bookingUrl: name-only fallback when neither website nor address", () => {
  const u = bookingUrl({ name: "Motel X" });
  assert.ok(u.startsWith("https://www.google.com/maps/search/?api=1&query="));
  assert.ok(u.endsWith(encodeURIComponent("Motel X")));
});
