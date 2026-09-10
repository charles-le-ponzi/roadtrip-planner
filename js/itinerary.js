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

// PURE: derive per-day drive time + overnight stop point from a routed trip.
// No network, no DOM — this is the only work in the critical path besides the
// OSRM call, so it runs in microseconds and the itinerary can render instantly.
// Town names and lodging are filled in later (background) by the caller.
export function computeDays(route, dayEndIndices, to) {
  const totalDays = dayEndIndices.length + 1;
  const days = [];
  let legStart = 0;
  for (let d = 0; d < totalDays; d++) {
    const isFinal = d === totalDays - 1;
    const legEnd = isFinal ? route.steps.length - 1 : dayEndIndices[d];
    let driveSeconds = 0;
    for (let j = legStart; j <= legEnd; j++) driveSeconds += route.steps[j].duration;
    legStart = legEnd + 1;

    if (isFinal) {
      days.push({ day: d + 1, town: null, driveSeconds, lodging: [], isOvernight: false, stopLngLat: [to.lon, to.lat] });
      continue;
    }

    const [lng, lat] = pointAtStep(route, dayEndIndices[d]);
    days.push({ day: d + 1, town: null, driveSeconds, lodging: [], isOvernight: true, stopLngLat: [lng, lat] });
  }
  return days;
}
