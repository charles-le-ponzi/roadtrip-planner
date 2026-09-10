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
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const OVERPASS_UA = 'roadtrip-planner/1.0 (https://github.com/charles-le-ponzi/roadtrip-planner)';
export async function overpass(query) {
  let lastErr;
  for (const m of MIRRORS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(m, { method: "POST", body: `data=${encodeURIComponent(query)}`, headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": OVERPASS_UA }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const j = await res.json();
      if (!j || !Array.isArray(j.elements)) throw new Error("Overpass: no elements");
      return j.elements;
    } catch (e) { lastErr = e; }
    finally { clearTimeout(t); }
  }
  const err = new Error("Map data service unavailable, try again");
  err.cause = lastErr;
  throw err;
}
export const nearestTownQuery = (lat, lon) =>
  `[out:json][timeout:25];node["place"~"city|town|village"](around:30000,${lat},${lon});out center;`;
export const lodgingQuery = (lat, lon) =>
  `[out:json][timeout:25];node["tourism"~"hotel|guest_house|camp_site|hostel|motel"](around:12000,${lat},${lon});out center;`;
