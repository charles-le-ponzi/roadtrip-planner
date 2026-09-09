// app.js — orchestration (Task 9)
import { attachAutocomplete, renderItinerary } from './ui.js';
import { fetchRoute } from './route.js';
import { overpass, nearestTownQuery, lodgingQuery } from './places.js';
import { splitDays, pointAtStep } from './itinerary.js';
import { initMap, drawRoute, addStopMarker, addDestinationMarker } from './map.js';

const ROUTE_TIMEOUT_MS = 15000;
const OVERPASS_SPACING_MS = 500;
const TOAST_MS = 4000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Map ----------
const map = initMap(document.getElementById('map'));
const mapReady = new Promise((resolve) => map.once('load', resolve));

// ---------- Autocomplete ----------
for (const id of ['from-input', 'to-input']) {
  const inputEl = document.getElementById(id);
  const dropdownEl = document.createElement('ul');
  dropdownEl.className = 'glass ac-dropdown';
  dropdownEl.hidden = true;
  document.body.appendChild(dropdownEl);
  attachAutocomplete(inputEl, dropdownEl);
}

// ---------- Hours slider ----------
const hoursSlider = document.getElementById('hours-slider');
const hoursLabel = document.getElementById('hours-label');
const clampHours = (v) => Math.min(12, Math.max(1, v));
function syncHoursLabel() {
  const h = clampHours(parseInt(hoursSlider.value, 10) || 4);
  hoursLabel.textContent = `${h} h/day`;
}
hoursSlider.addEventListener('input', syncHoursLabel);
syncHoursLabel();

// ---------- Toast ----------
let toastEl = null;
let toastTimer = null;
function toast(message) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'glass toast';
    toastEl.setAttribute('role', 'status');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, TOAST_MS);
}

// ---------- Loading skeleton ----------
function showLoadingSkeleton(itineraryEl) {
  itineraryEl.replaceChildren();
  for (let i = 0; i < 3; i++) {
    const card = document.createElement('div');
    card.className = 'itinerary-card';
    for (const h of [18, 12, 12]) {
      const bar = document.createElement('div');
      bar.className = 'shimmer';
      bar.style.height = `${h}px`;
      bar.style.marginBottom = '10px';
      card.appendChild(bar);
    }
    itineraryEl.appendChild(card);
  }
  itineraryEl.hidden = false;
  itineraryEl.classList.add('open');
}

// ---------- Route fetching with timeout ----------
async function fetchRouteWithTimeout(from, to) {
  let timer;
  const timeout = new Promise((_, reject) =>
    (timer = setTimeout(() => reject(new Error('Route request timed out')), ROUTE_TIMEOUT_MS)),
  );
  try {
    return await Promise.race([fetchRoute(from, to), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function friendlyRouteError(e) {
  const msg = e?.message ?? String(e);
  if (/timed out|timeout/i.test(msg)) return 'Routing service is unavailable, try again';
  if (/OSRM 400/.test(msg) || /no route found/i.test(msg)) return "Couldn't find a route between those points";
  if (/OSRM 5\d\d/.test(msg)) return 'Routing service is unavailable, try again';
  return 'Routing service is unavailable, try again';
}

// ---------- Day building ----------
async function buildDays(route, dayEndIndices, to) {
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

    await sleep(OVERPASS_SPACING_MS);
    let town = null;
    try {
      const townEls = await overpass(nearestTownQuery(lat, lng));
      let best = Infinity;
      for (const el of townEls) {
        const tlat = el.lat ?? el.center?.lat;
        const tlon = el.lon ?? el.center?.lon;
        if (tlat == null || tlon == null) continue;
        const dist = Math.hypot(tlat - lat, tlon - lng);
        if (dist < best) { best = dist; town = { name: el.tags?.name ?? 'Unknown', lat: tlat, lon: tlon }; }
      }
    } catch { /* no town found */ }

    await sleep(OVERPASS_SPACING_MS);
    let lodging = [];
    try {
      const lodgEls = await overpass(lodgingQuery(lat, lng));
      lodging = lodgEls
        .map((el) => ({ name: el.tags?.name ?? 'Unnamed lodging', lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon }))
        .filter((l) => l.lat != null && l.lon != null)
        .slice(0, 6);
    } catch { /* no lodging found */ }

    days.push({ day: d + 1, town, driveSeconds, lodging, isOvernight: true, stopLngLat: [lng, lat] });
  }
  return days;
}

// ---------- Plan handler ----------
const planBtn = document.getElementById('plan-btn');
const itineraryEl = document.getElementById('itinerary');

async function planTrip() {
  const from = document.getElementById('from-input')._place;
  const to = document.getElementById('to-input')._place;
  if (!from || !to) { toast('Pick both destinations first'); return; }

  planBtn.disabled = true;
  showLoadingSkeleton(itineraryEl);

  try {
    const hoursPerDay = clampHours(parseInt(hoursSlider.value, 10) || 4);
    const route = await fetchRouteWithTimeout(from, to);
    const dayEndIndices = splitDays(route, hoursPerDay);
    const days = await buildDays(route, dayEndIndices, to);

    await mapReady;
    drawRoute(map, route.geometry);
    addDestinationMarker(map, [from.lon, from.lat], from.name);
    addDestinationMarker(map, [to.lon, to.lat], to.name);
    for (const day of days) {
      if (day.isOvernight) {
        addStopMarker(map, day.stopLngLat, day.town ? day.town.name : 'Overnight stop');
      }
    }

    renderItinerary(itineraryEl, days);
    itineraryEl.hidden = false;
    itineraryEl.classList.add('open');
  } catch (e) {
    toast(friendlyRouteError(e));
  } finally {
    planBtn.disabled = false;
  }
}

planBtn.addEventListener('click', planTrip);
