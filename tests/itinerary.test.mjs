import test from "node:test";
import assert from "node:assert";
import { splitDays, pointAtStep } from "../js/itinerary.js";

test("short trip = no splits", () => {
  assert.deepStrictEqual(splitDays({ steps: [{ duration: 1800 }, { duration: 1800 }] }, 3), []);
});
test("splits at budget boundary", () => {
  assert.deepStrictEqual(splitDays({ steps: [{ duration: 3600 }, { duration: 3600 }, { duration: 1800 }] }, 1), [0, 1]);
});
test("multiple splits", () => {
  assert.deepStrictEqual(splitDays({ steps: [{ duration: 3600 }, { duration: 3600 }, { duration: 3600 }] }, 1), [0, 1, 2]);
});
test("pointAtStep returns step end coords", () => {
  const route = { steps: [{ geometry: { coordinates: [[0, 0], [1, 1]] } }] };
  assert.deepStrictEqual(pointAtStep(route, 0), [1, 1]);
});
