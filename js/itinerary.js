// PURE module — no DOM. Split OSRM steps into daily legs.
export function splitDays(route, hoursPerDay) {
  const budget = hoursPerDay * 3600;
  const dayEndIndices = [];
  let elapsed = 0;
  for (let i = 0; i < route.steps.length; i++) {
    elapsed += route.steps[i].duration;
    if (elapsed >= budget) { dayEndIndices.push(i); elapsed = 0; }
  }
  return dayEndIndices; // step indices marking each day's end
}
// Contract: caller must pass a valid stepIndex (0 <= stepIndex < route.steps.length).
export function pointAtStep(route, stepIndex) {
  const coords = route.steps[stepIndex].geometry.coordinates;
  return coords[coords.length - 1];
}
