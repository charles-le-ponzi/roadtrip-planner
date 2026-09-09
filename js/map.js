// map.js — MapLibre route rendering, animated draw-on, pulsing glass markers.
//
// Relies on the global `maplibregl` loaded from the CDN in index.html
// (script tag with defer). All globals are referenced inside functions only,
// so importing this module is always safe, even before the CDN script runs.

const ROUTE_SOURCE = 'route';
const ROUTE_LAYER = 'route-line';
const ROUTE_LINE_WIDTH = 4; // passed directly into the layer paint below
const DRAW_DURATION_MS = 1500;

// Respect the user's OS-level animation preference: skip fly/draw-on animations.
const REDUCED_MOTION =
  typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

const markers = []; // every maplibregl.Marker added by this module
let drawRafId = 0; // active draw-on animation frame
let drawCancel = null; // aborts the active draw-on (removes listeners)
let pendingMoveEnd = null; // moveend handler armed by drawRoute

function cancelDraw() {
  if (drawRafId) cancelAnimationFrame(drawRafId);
  drawRafId = 0;
  if (drawCancel) {
    drawCancel();
    drawCancel = null;
  }
}

/**
 * Remove the route source/layer and all stop/destination markers.
 * Idempotent; safe to call when nothing is drawn yet.
 */
export function clearRoute(map) {
  cancelDraw();
  if (pendingMoveEnd) {
    map.off('moveend', pendingMoveEnd);
    pendingMoveEnd = null;
  }
  if (map.getLayer(ROUTE_LAYER)) map.removeLayer(ROUTE_LAYER);
  if (map.getSource(ROUTE_SOURCE)) map.removeSource(ROUTE_SOURCE);
  for (const m of markers.splice(0)) m.remove();
}

export function initMap(el) {
  return new maplibregl.Map({
    container: el,
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [-100, 40],
    zoom: 3,
  });
}

/**
 * Draw the trip route (a GeoJSON LineString geometry), fit the camera to it,
 * then animate the line drawing itself on. Safe to call repeatedly:
 * any previous route source/layer and markers are removed first.
 */
export function drawRoute(map, geometry) {
  if (!geometry || geometry.type !== 'LineString') {
    throw new Error('drawRoute expects a GeoJSON LineString geometry');
  }

  // Re-planning a trip: wipe the previous route + markers before re-adding.
  clearRoute(map);

  map.addSource(ROUTE_SOURCE, { type: 'geojson', data: { type: 'Feature', geometry } });
  map.addLayer({
    id: ROUTE_LAYER,
    type: 'line',
    source: ROUTE_SOURCE,
    paint: {
      'line-color': '#7c6cff',
      'line-width': ROUTE_LINE_WIDTH,
      'line-opacity': .9,
    },
  });

  const b = new maplibregl.LngLatBounds();
  geometry.coordinates.forEach((c) => b.extend(c));

  // MapLibre's fitBounds returns the map (NOT a Promise like Mapbox GL JS),
  // so wait for the 'moveend' event to know when the camera is at rest. A
  // safety timeout covers the degenerate case where the bounds are already
  // in view and no moveend fires.
  let settled = false;
  const beginDrawOn = () => {
    if (settled) return;
    settled = true;
    if (pendingMoveEnd) {
      map.off('moveend', pendingMoveEnd);
      pendingMoveEnd = null;
    }
    if (!map.getLayer(ROUTE_LAYER)) return; // route cleared mid-flight
    if (REDUCED_MOTION) finalizeRouteLine(map);
    else animateDrawOn(map, geometry.coordinates);
  };
  pendingMoveEnd = beginDrawOn;
  map.once('moveend', beginDrawOn);
  map.fitBounds(b, { padding: 40, duration: REDUCED_MOTION ? 0 : 1200 });
  setTimeout(beginDrawOn, REDUCED_MOTION ? 50 : 1400);
}

/** Total line length in "line units" (multiples of line-width), at the current camera. */
function lineLengthInLineUnits(map, coordinates) {
  let px = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const a = map.project(coordinates[i - 1]);
    const b = map.project(coordinates[i]);
    px += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return px / ROUTE_LINE_WIDTH;
}

/** Restore the route line to its plain, fully-drawn state. */
function finalizeRouteLine(map) {
  if (!map.getLayer(ROUTE_LAYER)) return;
  map.setPaintProperty(ROUTE_LAYER, 'line-dasharray', null);
  map.setPaintProperty(ROUTE_LAYER, 'line-dashoffset', null);
}

/**
 * Animated draw-on: the line is a single dash exactly as long as the route;
 * animating line-dashoffset from `dash` to 0 slides that dash in from the
 * start, so the line appears to draw itself. If the user moves the camera
 * mid-animation the pixel math goes stale, so we cancel and show the full line.
 */
function animateDrawOn(map, coordinates) {
  if (!map.getLayer(ROUTE_LAYER)) return;

  const total = lineLengthInLineUnits(map, coordinates);
  if (!(total > 0.5)) {
    finalizeRouteLine(map); // degenerate line: nothing to animate
    return;
  }

  const dash = total + 0.01;
  map.setPaintProperty(ROUTE_LAYER, 'line-dasharray', [dash, dash]);
  map.setPaintProperty(ROUTE_LAYER, 'line-dashoffset', dash);

  const onMove = () => {
    cancelDraw();
    finalizeRouteLine(map);
  };
  map.on('move', onMove);
  drawCancel = () => map.off('move', onMove);

  const start = performance.now();
  const frame = (now) => {
    if (!map.getLayer(ROUTE_LAYER)) {
      cancelDraw();
      return;
    }
    const t = Math.min(1, (now - start) / DRAW_DURATION_MS);
    const eased = 1 - (1 - t) ** 3; // easeOutCubic
    map.setPaintProperty(ROUTE_LAYER, 'line-dashoffset', dash * (1 - eased));
    if (t < 1) {
      drawRafId = requestAnimationFrame(frame);
    } else {
      drawRafId = 0;
      cancelDraw();
      finalizeRouteLine(map);
    }
  };
  drawRafId = requestAnimationFrame(frame);
}

/**
 * Shared marker factory: a small pulsing glass dot (CSS in styles.css)
 * with a tooltip showing the label.
 */
function addPulseMarker(map, lngLat, label, variant) {
  const el = document.createElement('div');
  el.className = `map-marker map-marker--${variant}`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);

  const ring = document.createElement('span');
  ring.className = 'map-marker__ring';
  const dot = document.createElement('span');
  dot.className = 'map-marker__dot';
  el.append(ring, dot);

  const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat(lngLat)
    .setPopup(
      new maplibregl.Popup({ offset: 14, closeButton: false, className: 'map-marker-tip' })
        .setText(label),
    )
    .addTo(map);
  markers.push(marker);
  return marker;
}

/** Waypoint marker (accent color, pulsing). */
export function addStopMarker(map, lngLat, label) {
  return addPulseMarker(map, lngLat, label, 'stop');
}

/** From/to endpoint marker (aqua color, pulsing). */
export function addDestinationMarker(map, lngLat, label) {
  return addPulseMarker(map, lngLat, label, 'destination');
}
