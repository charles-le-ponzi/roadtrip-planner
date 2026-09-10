// Tight end-to-end loop: run the EXACT findLodging() through the real
// overpass() the way app.js does it, N times. This is the user's actual
// symptom path. No hand-typed query strings.
//
// Stops include the real overnight points from a Phoenix->Santa Fe OSRM route
// (diagnose.mjs), including the remote I-40 gap stop that previously returned
// ZERO lodging with the old single-stage 5km query.
import { findLodging } from '../js/places.js';

const stops = [
  ['Phoenix (urban)', 33.45, -112.07],
  ['Tucson (urban)', 32.22, -110.97],
  ['Albuquerque (urban)', 35.08, -106.65],
  ['I-40 gap near Gloriette (remote — old code: 0 lodging)', 34.9907, -107.2202],
];

const RUNS = parseInt(process.argv[2] || '1', 10);
const t0 = Date.now();
let ok = 0, fail = 0, found = 0;
for (let run = 1; run <= RUNS; run++) {
  for (const [name, lat, lon] of stops) {
    const s = Date.now();
    try {
      const { elements, anchorName } = await findLodging(lat, lon);
      const named = elements.filter((e) => e.tags?.name).length;
      const anchor = anchorName ? ` [anchored on ${anchorName}]` : '';
      console.log(`run${run} ${name}: OK ${elements.length} elems (${named} named)${anchor} in ${Date.now() - s}ms`);
      if (elements.length) found++;
      ok++;
    } catch (e) {
      console.log(`run${run} ${name}: FAIL ${e.message} (cause: ${e.cause?.message ?? e.cause}) in ${Date.now() - s}ms`);
      fail++;
    }
    await new Promise((r) => setTimeout(r, 1100)); // app.js Nominatim pacing between stops
  }
}
console.log(`\nTOTAL: ${ok} ok, ${fail} fail, ${found}/${RUNS * stops.length} stops with lodging, ${Date.now() - t0}ms for ${RUNS} run(s) x ${stops.length} stops`);
