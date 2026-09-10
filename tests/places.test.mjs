import test from "node:test";
import assert from "node:assert";
import { overpass, lodgingQuery, MIRRORS } from "../js/places.js";
import { mapsUrl, bookingUrl } from "../js/ui.js";

// ---------- lodgingQuery ----------
test("lodgingQuery: searches both nodes AND ways (hotels are often mapped as ways)", () => {
  const q = lodgingQuery(33.45, -112.07);
  assert.ok(q.includes('node["tourism"'), "should query nodes");
  assert.ok(q.includes('way["tourism"'), "should query ways");
  assert.ok(q.includes("out center"), "should emit center coords for ways");
});

// ---------- overpass() mirror race ----------
const jsonResp = (elements) => ({ ok: true, status: 200, json: async () => ({ elements }) });

function stubFetch(behaviors) {
  const real = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    const i = MIRRORS.indexOf(String(url));
    assert.ok(i >= 0, `unexpected mirror ${url}`);
    return behaviors[i](opts);
  };
  return () => { globalThis.fetch = real; };
}

test("overpass: parallel race — fast mirror wins even when listed later", async (t) => {
  let slowAborted = false;
  const restore = stubFetch([
    // mirror 0: slow (800ms) — must be aborted once mirror 1 wins
    (opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener("abort", () => {
        slowAborted = true;
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
      setTimeout(() => resolve(jsonResp([{ tags: { name: "slow" } }])), 800);
    }),
    // mirror 1: fast (50ms)
    () => new Promise((resolve) => setTimeout(() => resolve(jsonResp([{ tags: { name: "fast" } }])), 50)),
    // rest: down
    ...MIRRORS.slice(2).map(() => () => new Promise((_, reject) => setTimeout(() => reject(new Error("down")), 100))),
  ]);
  t.after(restore);

  const t0 = Date.now();
  const els = await overpass("q");
  const dt = Date.now() - t0;

  assert.strictEqual(els[0].tags.name, "fast", "should return the fast mirror's data");
  assert.ok(dt < 400, `parallel race should resolve in <400ms, took ${dt}ms (sequential would be ~800ms)`);
  assert.ok(slowAborted, "losing mirror must be aborted once a winner lands");
});

test("overpass: first mirror down, second up — resolves with second's data quickly", async (t) => {
  const restore = stubFetch([
    () => Promise.reject(new Error("connection refused")),
    () => new Promise((resolve) => setTimeout(() => resolve(jsonResp([{ tags: { name: "second" } }])), 30)),
    ...MIRRORS.slice(2).map(() => () => new Promise((_, reject) => setTimeout(() => reject(new Error("down")), 100))),
  ]);
  t.after(restore);

  const t0 = Date.now();
  const els = await overpass("q");
  const dt = Date.now() - t0;
  assert.strictEqual(els[0].tags.name, "second");
  assert.ok(dt < 300, `should not wait for dead mirrors, took ${dt}ms`);
});

test("overpass: empty result waits for other mirrors (sparse mirror must not mask real data)", async (t) => {
  const restore = stubFetch([
    // mirror 0: fast but EMPTY (like osm.ch for downtown LA)
    () => new Promise((resolve) => setTimeout(() => resolve(jsonResp([])), 30)),
    // mirror 1: slow but has the real data
    () => new Promise((resolve) => setTimeout(() => resolve(jsonResp([{ tags: { name: "real" } }])), 800)),
    ...MIRRORS.slice(2).map(() => () => new Promise((_, reject) => setTimeout(() => reject(new Error("down")), 100))),
  ]);
  t.after(restore);

  const els = await overpass("q");
  assert.strictEqual(els.length, 1, "must not accept the sparse mirror's empty result");
  assert.strictEqual(els[0].tags.name, "real");
});

test("overpass: all mirrors agree on empty -> resolves empty after grace, not after full timeout", async (t) => {
  const restore = stubFetch(MIRRORS.map(() => () => new Promise((resolve) => setTimeout(() => resolve(jsonResp([])), 30))));
  t.after(restore);

  const t0 = Date.now();
  const els = await overpass("q");
  const dt = Date.now() - t0;
  assert.deepStrictEqual(els, []);
  assert.ok(dt < 3500, `empty-after-agreement must resolve within the grace window, took ${dt}ms`);
});

test("overpass: all mirrors fail -> rejects with friendly error", async (t) => {
  const restore = stubFetch(MIRRORS.map(() => () => Promise.reject(new Error("network down"))));
  t.after(restore);
  await assert.rejects(overpass("q"), /Map data service unavailable/);
});

// ---------- link builders ----------
test("mapsUrl: name+address resolves to the actual business", () => {
  const u = mapsUrl({ name: "Hotel San Carlos", address: "123 Main St, Phoenix, AZ", lat: 33.45, lon: -112.07 });
  assert.ok(u.startsWith("https://www.google.com/maps/search/?api=1&query="));
  assert.ok(u.includes(encodeURIComponent("Hotel San Carlos")));
  assert.ok(u.includes(encodeURIComponent("123 Main St")));
});

test("mapsUrl: name only when no address is known", () => {
  const u = mapsUrl({ name: "Motel X", lat: 33.45, lon: -112.07 });
  assert.ok(u.endsWith(encodeURIComponent("Motel X")));
});

test("bookingUrl: property's own website when OSM has one (the actual room listing)", () => {
  assert.strictEqual(
    bookingUrl({ name: "Hyatt", website: "https://phoenix.hyatt.com/en/hotel/home.html" }),
    "https://phoenix.hyatt.com/en/hotel/home.html",
  );
});

test("bookingUrl: web search for the property when no website (surfaces its listing pages)", () => {
  const u = bookingUrl({ name: "Motel X", address: "1 Main St, Phoenix" });
  assert.ok(u.startsWith("https://www.google.com/search?q="));
  assert.ok(u.includes(encodeURIComponent("Motel X")));
  assert.ok(u.includes(encodeURIComponent("1 Main St")));
});

test("bookingUrl: name-only search fallback when neither website nor address", () => {
  const u = bookingUrl({ name: "Motel X" });
  assert.ok(u.startsWith("https://www.google.com/search?q="));
  assert.ok(u.includes(encodeURIComponent("Motel X")));
  assert.ok(u.endsWith(encodeURIComponent("Motel X") + "%20booking"));
});
