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
// Overpass mirrors, primary first (measured 2026-09-10 from the user's
// network: mail.ru 1.3–4.3s and correct, overpass-api.de ~2s, kumi 504 under
// load). We send ONE request at a time through a global rate limiter
// (OVERPASS_MIN_INTERVAL_MS) — the old 3-way parallel race tripled our request
// load per stop and got multi-stop trips rate-limited (429). Fallbacks only
// fire when the primary fails; the limiter spaces EVERY request (mirror
// retries included) so a single stop can never burst.
//
// NOTE: overpass.osm.ch was tested and REMOVED — it answered a Phoenix lodging
// query with 0 elements while mail.ru/overpass-api.de returned 55. A mirror
// that silently returns wrong (empty) data is worse than a down mirror, so it
// must never be in the fallback chain.
export const MIRRORS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const OVERPASS_UA = 'roadtrip-planner/1.0 (https://github.com/charles-le-ponzi/roadtrip-planner)';
// Public mirrors are slow under load: mail.ru routinely takes 6–15s for the
// lodging query (measured 2026-09-10). The old 10s timeout aborted healthy
// slow responses and masked them as "Map data service unavailable" — the
// "rate limited" symptom. 30s matches the [timeout:25] in the query itself.
export const MIRROR_TIMEOUT_MS = 30000;

// Global Overpass rate limiter: at most one request per OVERPASS_MIN_INTERVAL_MS
// across the whole app, regardless of code path (mirror retries, the two-stage
// lodging fallback, multiple stops). Per-stop spacing alone can't stop the 429s
// because a single stop can fire several requests when the primary 504s and the
// fallback escalates — this makes the ceiling global and hard.
export const OVERPASS_MIN_INTERVAL_MS = 1500;
let minIntervalMs = OVERPASS_MIN_INTERVAL_MS;
let lastOverpassAt = 0;
// Test hook: shrink the interval so a unit test can exercise the spacing in
// milliseconds instead of waiting out the real 1.5s.
export function _setOverpassInterval(ms) { minIntervalMs = ms; lastOverpassAt = 0; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttleOverpass() {
  const wait = lastOverpassAt + minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastOverpassAt = Date.now();
}

async function queryMirror(mirror, query, timeoutMs = MIRROR_TIMEOUT_MS) {
  await throttleOverpass();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(mirror, {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": OVERPASS_UA },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const j = await res.json();
    if (!j || !Array.isArray(j.elements)) throw new Error("Overpass: no elements");
    return j.elements;
  } finally {
    clearTimeout(t);
  }
}
// Exported for tests: lets a unit test exercise the abort path in milliseconds
// instead of waiting out the real 30s timeout.
export { queryMirror };

// Sequential primary-then-fallback: at most one in-flight Overpass request at
// a time, so a 4-stop trip sends 4 requests instead of 12. An empty result
// from the primary is returned as-is — with a single source of truth there is
// no second mirror to cross-check against.
export async function overpass(query) {
  let lastErr;
  for (const mirror of MIRRORS) {
    try {
      return await queryMirror(mirror, query);
    } catch (e) {
      lastErr = e;
    }
  }
  const err = new Error("Map data service unavailable, try again");
  err.cause = lastErr;
  throw err;
}
export const nearestTownQuery = (lat, lon) =>
  `[out:json][timeout:25];node["place"~"city|town|village"](around:30000,${lat},${lon});out center;`;
// Hotels are often mapped as ways, not nodes — query both, or most of the
// lodging in a town is invisible. 5km radius: plenty for an overnight stop,
// and a smaller result set means a faster, lighter response from the mirror.
export const lodgingQuery = (lat, lon) =>
  `[out:json][timeout:25];(node["tourism"~"hotel|guest_house|camp_site|hostel|motel"](around:5000,${lat},${lon});way["tourism"~"hotel|guest_house|camp_site|hostel|motel"](around:5000,${lat},${lon}););out center;`;

// Two-stage lodging lookup. OSRM overnight stops land at the END of a driving
// leg — frequently a highway interchange or rural gap, not the town. A 5km
// circle around that raw point finds nothing even when the nearest town
// (5–15km away) is full of hotels. So:
//   stage 1: lodging within 5km of the raw stop point (fast, the common case
//            where the stop is already in/near the town).
//   stage 2: if stage 1 is empty, find the nearest place node (city/town/
//            village) within 30km and search lodging around THAT.
// Returns { elements, anchorName } where anchorName is the town the lodging
// was actually found around (null when stage 1 hit) — the caller can use it to
// label the card. Each stage is one Overpass request, spaced by the global
// limiter, so a stop costs 1–2 requests, never a burst.
export async function findLodging(lat, lon) {
  const stage1 = await overpass(lodgingQuery(lat, lon));
  if (stage1.length) return { elements: stage1, anchorName: null };

  const places = await overpass(nearestTownQuery(lat, lon));
  if (!places.length) return { elements: [], anchorName: null };
  const nearest = places
    .map((p) => ({ p, d: haversineKm({ lat, lon }, p) }))
    .sort((a, b) => a.d - b.d)[0];
  const elements = await overpass(lodgingQuery(nearest.p.lat, nearest.p.lon));
  return { elements, anchorName: nearest.p.tags?.name ?? null };
}

// Great-circle distance in km. Good enough for ordering place nodes by
// proximity; we never need survey-grade precision here.
function haversineKm(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR;
  const dLon = (b.lon - a.lon) * toR;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
