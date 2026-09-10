// places.js — Nominatim + Overpass wrappers
// Nominatim's usage policy asks for a descriptive User-Agent; browsers send
// their own, but we set one explicitly so the app works from any client.
const NOMINATIM_UA = 'roadtrip-planner/1.0 (https://github.com/charles-le-ponzi/roadtrip-planner)';

export async function searchPlaces(q) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
    { headers: { 'User-Agent': NOMINATIM_UA } },
  );
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json(); // [{ display_name, lat, lon, ... }]
}

// Fast nearest-town lookup via Nominatim reverse geocode (~0.5 s, no rate-limit
// issues like Overpass). Returns { name, lat, lon } or null if nothing named.
export async function reverseGeocode(lat, lon) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=12`,
    { headers: { 'User-Agent': NOMINATIM_UA } },
  );
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const d = await res.json();
  if (!d || !d.name) return null;
  return { name: d.name, lat: Number(d.lat), lon: Number(d.lon) };
}
// Overpass mirrors, fastest-first (measured 2026-09-10 from the user's
// network). mail.ru is the workhorse (0.6–2.6s with full data). kumi/api.de
// are fallbacks — frequently slow or down, but the race makes that free.
// NOTE: overpass.osm.ch and overpass.private.coffee were removed: both return
// 0 elements for downtown LA (225 hotels on mail.ru) — sparse/broken datasets
// for this query, so they'd mask real results in a race.
export const MIRRORS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
const OVERPASS_UA = 'roadtrip-planner/1.0 (https://github.com/charles-le-ponzi/roadtrip-planner)';
const MIRROR_TIMEOUT_MS = 10000;
// If the first success comes back EMPTY, hold this long for the other mirrors:
// a sparse mirror must not mask real data that a slower mirror is still
// computing. (Verified: mirrors disagree on emptiness for the same area.)
const EMPTY_GRACE_MS = 2000;
export async function overpass(query) {
  const controllers = MIRRORS.map(() => new AbortController());
  let lastErr;
  const attempts = MIRRORS.map((m, i) => {
    const ctrl = controllers[i];
    const t = setTimeout(() => ctrl.abort(), MIRROR_TIMEOUT_MS);
    return fetch(m, { method: "POST", body: `data=${encodeURIComponent(query)}`, headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": OVERPASS_UA }, signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Overpass ${res.status}`);
        const j = await res.json();
        if (!j || !Array.isArray(j.elements)) throw new Error("Overpass: no elements");
        return j.elements;
      })
      .finally(() => clearTimeout(t));
  });
  const elements = await new Promise((resolve, reject) => {
    let pending = MIRRORS.length;
    let settled = false;
    let gotEmpty = null; // first empty success, held in case a later mirror has data
    let emptyGrace = null;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      if (emptyGrace) clearTimeout(emptyGrace);
      resolve(v);
    };
    attempts.forEach((p) => {
      p.then(
        (v) => {
          if (settled) return; // race already won — ignore late arrivals
          pending--;
          if (v.length > 0) { finish(v); return; } // non-empty wins immediately
          if (!gotEmpty) {
            gotEmpty = v;
            emptyGrace = setTimeout(() => { if (pending > 0) finish(gotEmpty); }, EMPTY_GRACE_MS);
          }
          if (pending === 0) finish(gotEmpty); // all mirrors settled, accept empty
        },
        (e) => {
          if (settled) return; // race already won — ignore late failures
          pending--;
          lastErr = e;
          if (pending === 0) {
            if (gotEmpty) finish(gotEmpty);
            else {
              const err = new Error("Map data service unavailable, try again");
              err.cause = lastErr;
              reject(err);
            }
          }
        },
      );
    });
  });
  controllers.forEach((c) => c.abort()); // stop the losing mirrors
  return elements;
}
export const nearestTownQuery = (lat, lon) =>
  `[out:json][timeout:25];node["place"~"city|town|village"](around:30000,${lat},${lon});out center;`;
// Hotels are often mapped as ways, not nodes — query both, or most of the
// lodging in a town is invisible (downtown LA: 59 nodes vs 417 node+way).
export const lodgingQuery = (lat, lon) =>
  `[out:json][timeout:25];(node["tourism"~"hotel|guest_house|camp_site|hostel|motel"](around:12000,${lat},${lon});way["tourism"~"hotel|guest_house|camp_site|hostel|motel"](around:12000,${lat},${lon}););out center;`;
