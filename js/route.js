// OSRM nests steps under legs[]; downstream code expects a flat route.steps.
// Pure — exported for testing.
export function flattenRoute(route) {
  route.steps = route.legs.flatMap((leg) => leg.steps);
  return route;
}

const OSRM = "https://router.project-osrm.org";
export async function fetchRoute(from, to) {
  const url = `${OSRM}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) throw new Error("No route found");
  return flattenRoute(data.routes[0]); // { distance, duration, geometry, steps }
}
