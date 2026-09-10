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
// network). We send ONE request at a time — the old 3-way parallel race
// tripled our request load per stop and got multi-stop trips rate-limited
// (429). Fallbacks only fire when the primary fails.
export const MIRRORS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
const OVERPASS_UA = 'roadtrip-planner/1.0 (https://github.com/charles-le-ponzi/roadtrip-planner)';
// Public mirrors are slow under load: mail.ru routinely takes 6–15s for the
// lodging query (measured 2026-09-10). The old 10s timeout aborted healthy
// slow responses and masked them as "Map data service unavailable" — the
// "rate limited" symptom. 30s matches the [timeout:25] in the query itself.
export const MIRROR_TIMEOUT_MS = 30000;

async function queryMirror(mirror, query, timeoutMs = MIRROR_TIMEOUT_MS) {
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
