import test from "node:test";
import assert from "node:assert";
import {
  overpass, lodgingQuery, MIRRORS, MIRROR_TIMEOUT_MS, queryMirror,
  findLodging, nearestTownQuery, _setOverpassInterval, OVERPASS_MIN_INTERVAL_MS,
} from "../js/places.js";
import { mapsUrl, bookingUrl } from "../js/ui.js";

// The global Overpass rate limiter defaults to 1500ms in production. In tests we
// run it at 0 so the pre-existing overpass()/findLodging() unit tests don't each
// wait out a real 1.5s between calls. The dedicated limiter test below opts back
// in (120ms) and restores 0.
_setOverpassInterval(0);

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

// ---------- findLodging: two-stage lookup ----------
// OSRM overnight stops land at the end of a driving leg — often a highway gap,
// not the town. Stage 1 (5km around the raw point) misses; stage 2 anchors on
// the nearest place node. Contract: 1 request when stage 1 hits, 3 when it
// doesn't (lodging, places, lodging@town), and anchorName names the town.
function querySpy(handler) {
  // handler: fn(body) -> Response-like. Records every query sent.
  const real = globalThis.fetch;
  const queries = [];
  globalThis.fetch = (url, opts) => {
    const body = new URLSearchParams(String(opts.body)).get("data");
    queries.push(body);
    return handler(body);
  };
  return {
    restore: () => { globalThis.fetch = real; },
    queries,
  };
}

test("findLodging: stage 1 hit -> ONE request, anchorName null", async (t) => {
  _setOverpassInterval(0); // no real waiting in the test
  t.after(() => _setOverpassInterval(0));
  const { restore, queries } = querySpy(() =>
    Promise.resolve(jsonResp([{ tags: { name: "Downtown Hotel" } }])),
  );
  t.after(restore);

  const { elements, anchorName } = await findLodging(35.0, -105.9);
  assert.strictEqual(elements[0].tags.name, "Downtown Hotel");
  assert.strictEqual(anchorName, null);
  assert.strictEqual(queries.length, 1, "stage 1 hit must not trigger the place lookup");
  assert.ok(queries[0].includes("around:5000,35,-105.9"), `got: ${queries[0]}`);
});

test("findLodging: stage 1 empty -> anchors on nearest place node, 3 requests", async (t) => {
  _setOverpassInterval(0);
  t.after(() => _setOverpassInterval(0));
  const { restore, queries } = querySpy((body) => {
    if (body.includes('"place"')) {
      // two candidates: the nearer one (8km) must win over the farther (15km)
      return Promise.resolve(jsonResp([
        { id: 1, tags: { name: "Far Town", place: "city" }, lat: 35.2, lon: -105.9 },
        { id: 2, tags: { name: "Near Town", place: "town" }, lat: 35.08, lon: -105.9 },
      ]));
    }
    if (body.includes("35.08,-105.9")) {
      // lodging around the NEAR town
      return Promise.resolve(jsonResp([{ tags: { name: "Near Town Inn" } }]));
    }
    // first call: lodging around the raw stop point -> empty
    return Promise.resolve(jsonResp([]));
  });
  t.after(restore);

  const { elements, anchorName } = await findLodging(35.0, -105.9);
  assert.deepStrictEqual(queries.length, 3, "stage 1 lodging + place lookup + stage 2 lodging");
  assert.strictEqual(anchorName, "Near Town", "must anchor on the NEAREST place node, not the first one returned");
  assert.strictEqual(elements[0].tags.name, "Near Town Inn");
  assert.ok(queries[2].includes("around:5000,35.08,-105.9"), `stage 2 must search around the nearest town's coords; got: ${queries[2]}`);
});

test("findLodging: stage 1 empty + no place node within 30km -> empty result, 2 requests", async (t) => {
  _setOverpassInterval(0);
  t.after(() => _setOverpassInterval(0));
  const { restore, queries } = querySpy((body) =>
    body.includes('"place"')
      ? Promise.resolve(jsonResp([]))
      : Promise.resolve(jsonResp([])),
  );
  t.after(restore);

  const { elements, anchorName } = await findLodging(34.99, -107.22);
  assert.deepStrictEqual(elements, []);
  assert.strictEqual(anchorName, null);
  assert.strictEqual(queries.length, 2, "no third request when there is no town to anchor on");
});

// ---------- global Overpass rate limiter ----------
test("overpass: consecutive requests are spaced >= OVERPASS_MIN_INTERVAL_MS (the 429 fix)", async (t) => {
  _setOverpassInterval(120); // 120ms so the test runs in ~360ms total
  t.after(() => _setOverpassInterval(0)); // restore the test-suite default, not production
  const real = globalThis.fetch;
  const fireTimes = [];
  globalThis.fetch = (url, opts) => {
    if (MIRRORS.includes(String(url))) fireTimes.push(Date.now());
    return Promise.resolve(jsonResp([{ tags: { name: "a" } }]));
  };
  t.after(() => { globalThis.fetch = real; });

  for (let i = 0; i < 3; i++) await overpass("q");

  // The limiter gates the moment the request FIRES, so measure fetch timestamps,
  // not call timestamps (the wait happens between one call returning and the
  // next request going out the door).
  assert.strictEqual(fireTimes.length, 3);
  for (let i = 1; i < fireTimes.length; i++) {
    const gap = fireTimes[i] - fireTimes[i - 1];
    assert.ok(gap >= 100, `gap ${i} was ${gap}ms, must be >= ~120ms`);
  }
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
