// PURE module — no DOM. Split OSRM steps into daily legs.
export function splitDays(route, hoursPerDay) {
  const budget = hoursPerDay * 3600;
  const legs = [];
  let elapsed = 0;
  for (let i = 0; i < route.steps.length; i++) {
    elapsed += route.steps[i].duration;
    if (elapsed >= budget) { legs.push(i); elapsed = 0; }
  }
  return legs; // index of last step completed each day
}
export function pointAtStep(route, stepIndex) {
  const coords = route.steps[stepIndex].geometry.coordinates;
  return coords[coords.length - 1];
}
