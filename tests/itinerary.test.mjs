import test from "node:test";
import assert from "node:assert";
import { splitDays, pointAtStep } from "../js/itinerary.js";
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
