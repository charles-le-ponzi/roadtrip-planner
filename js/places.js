// places.js — Nominatim + Overpass wrappers
export async function searchPlaces(q) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`);
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json(); // [{ display_name, lat, lon, ... }]
}
// Task 6 adds: overpass(query) with mirror failover, nearestTownQuery, lodgingQuery
