// Tight end-to-end loop: run the EXACT lodgingQuery() through the real
// overpass() the way app.js does it, N times. This is the user's actual
// symptom path. No hand-typed query strings.
import { overpass, lodgingQuery } from '../js/places.js';

const stops = [
  ['Phoenix', 33.45, -112.07],
  ['Tucson', 32.22, -110.97],
  ['Albuquerque', 35.08, -106.65],
];

console.log('=== EXACT QUERY (from lodgingQuery) ===');
console.log(lodgingQuery(33.45, -112.07));
console.log('======================================\n');

const RUNS = parseInt(process.argv[2] || '1', 10);
const t0 = Date.now();
let ok = 0, fail = 0;
for (let run = 1; run <= RUNS; run++) {
  for (const [name, lat, lon] of stops) {
    const s = Date.now();
    try {
      const els = await overpass(lodgingQuery(lat, lon));
      const named = els.filter((e) => e.tags?.name).length;
      console.log(`run${run} ${name}: OK ${els.length} elems (${named} named) in ${Date.now() - s}ms`);
      ok++;
    } catch (e) {
      console.log(`run${run} ${name}: FAIL ${e.message} (cause: ${e.cause?.message ?? e.cause}) in ${Date.now() - s}ms`);
      fail++;
    }
    await new Promise((r) => setTimeout(r, 1100)); // app.js pacing
  }
}
console.log(`\nTOTAL: ${ok} ok, ${fail} fail, ${Date.now() - t0}ms for ${RUNS} run(s) x ${stops.length} stops`);
