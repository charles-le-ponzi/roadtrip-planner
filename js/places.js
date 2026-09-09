// places.js — Nominatim + Overpass wrappers
export async function searchPlaces(q) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`);
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json(); // [{ display_name, lat, lon, ... }]
}
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
export async function overpass(query) {
  let lastErr;
  for (const m of MIRRORS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(m, { method: "POST", body: `data=${encodeURIComponent(query)}`, headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ctrl.signal });
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
