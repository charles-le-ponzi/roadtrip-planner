import test from "node:test";
import assert from "node:assert";
import { splitDays, pointAtStep, computeDays } from "../js/itinerary.js";
import { flattenRoute } from "../js/route.js";

test("flattenRoute: nested legs[].steps -> flat route.steps", () => {
  const route = {
    legs: [
      { steps: [{ duration: 100 }, { duration: 200 }] },
      { steps: [{ duration: 300 }] },
    ],
  };
  const flat = flattenRoute(route);
  assert.deepStrictEqual(flat.steps.map((s) => s.duration), [100, 200, 300]);
});
test("flattenRoute: single leg", () => {
  const flat = flattenRoute({ legs: [{ steps: [{ duration: 5 }] }] });
  assert.strictEqual(flat.steps.length, 1);
});

test("short trip = no splits", () => {
  assert.deepStrictEqual(splitDays({ steps: [{ duration: 1800 }, { duration: 1800 }] }, 3), []);
});
test("splits at budget boundary", () => {
  assert.deepStrictEqual(splitDays({ steps: [{ duration: 3600 }, { duration: 3600 }, { duration: 1800 }] }, 1), [0, 1]);
});
test("multiple splits", () => {
  assert.deepStrictEqual(splitDays({ steps: [{ duration: 3600 }, { duration: 3600 }, { duration: 3600 }] }, 1), [0, 1, 2]);
});
test("empty steps = no splits", () => {
  assert.deepStrictEqual(splitDays({ steps: [] }, 3), []);
});
test("single step over budget", () => {
  assert.deepStrictEqual(splitDays({ steps: [{ duration: 5000 }] }, 1), [0]);
});
test("pointAtStep returns step end coords", () => {
  const route = { steps: [{ geometry: { coordinates: [[0, 0], [1, 1]] } }] };
  assert.deepStrictEqual(pointAtStep(route, 0), [1, 1]);
});

// computeDays is the synchronous critical path (no network) — verify it produces
// the right day structure so the itinerary can render instantly after OSRM.
test("computeDays: single day (no splits) -> one non-overnight day", () => {
  const route = { steps: [{ duration: 1800, geometry: { coordinates: [[0, 0], [1, 1]] } }] };
  const days = computeDays(route, [], { lon: 1, lat: 1 });
  assert.strictEqual(days.length, 1);
  assert.strictEqual(days[0].isOvernight, false);
  assert.strictEqual(days[0].driveSeconds, 1800);
  assert.deepStrictEqual(days[0].stopLngLat, [1, 1]);
  assert.strictEqual(days[0].town, null); // filled in later, background
  assert.deepStrictEqual(days[0].lodging, []);
});
test("computeDays: multi-day -> overnight days carry stop point, final is destination", () => {
  const route = {
    steps: [
      { duration: 3600, geometry: { coordinates: [[0, 0], [1, 0]] } },
      { duration: 3600, geometry: { coordinates: [[1, 0], [2, 0]] } },
      { duration: 1800, geometry: { coordinates: [[2, 0], [3, 0]] } },
    ],
  };
  const to = { lon: 3, lat: 0 };
  const days = computeDays(route, splitDays(route, 1), to);
  assert.strictEqual(days.length, 3);
  assert.strictEqual(days[0].isOvernight, true);
  assert.deepStrictEqual(days[0].stopLngLat, [1, 0]); // end of day-1 leg
  assert.strictEqual(days[0].driveSeconds, 3600);
  assert.strictEqual(days[1].isOvernight, true);
  assert.deepStrictEqual(days[1].stopLngLat, [2, 0]);
  assert.strictEqual(days[2].isOvernight, false); // final day
  assert.deepStrictEqual(days[2].stopLngLat, [3, 0]); // destination
  assert.strictEqual(days[2].driveSeconds, 1800);
});
test("computeDays: drive seconds sum each leg correctly", () => {
  const route = {
    steps: [
      { duration: 100, geometry: { coordinates: [[0, 0], [1, 0]] } },
      { duration: 200, geometry: { coordinates: [[1, 0], [2, 0]] } },
      { duration: 50, geometry: { coordinates: [[2, 0], [3, 0]] } },
    ],
  };
  const days = computeDays(route, [1], { lon: 3, lat: 0 });
  assert.strictEqual(days[0].driveSeconds, 300); // 100 + 200
  assert.strictEqual(days[1].driveSeconds, 50);
});
