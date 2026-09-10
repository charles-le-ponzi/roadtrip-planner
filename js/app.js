// app.js — orchestration (Task 9)
import { attachAutocomplete, renderItinerary, updateDayTown, updateDayLodging, updateDayLodgingError } from './ui.js';
import { fetchRoute } from './route.js';
import { overpass, lodgingQuery, reverseGeocode } from './places.js';
import { splitDays, computeDays } from './itinerary.js';
import { initMap, drawRoute, addStopMarker, addDestinationMarker, setMarkerLabel, setupMarkerScaling } from './map.js';

const ROUTE_TIMEOUT_MS = 15000;
const NOMINATIM_SPACING_MS = 1100; // Nominatim policy: max 1 req/s
const OVERPASS_SPACING_MS = 500;
const TOAST_MS = 4000;

let currentPlanId = 0; // invalidates in-flight enrichments when a new trip is planned

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Map ----------
const map = initMap(document.getElementById('map'));
const mapReady = new Promise((resolve) => map.once('load', resolve));
// Scale markers with zoom so lodge/stop dots don't dwarf a continent-wide view.
// Binds once; markers added later pick up the current scale automatically.
setupMarkerScaling(map);

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
  return `Something went wrong: ${msg}`;
}

// ---------- Day building ----------
// Background: fill in town names (Nominatim reverse, fast) and lodging
// (Overpass, slow/rate-limited) for each overnight day, updating the DOM as
// each result lands. Never blocks the route/itinerary from rendering.
async function enrichDays(days, planId) {
  const overnights = days.filter((d) => d.isOvernight);
  for (const day of overnights) {
    if (planId !== currentPlanId) return; // a newer trip superseded this one
    const [lng, lat] = day.stopLngLat;

    // Town first (fast), lodging second (slow) — but both update the card live.
    await sleep(NOMINATIM_SPACING_MS);
    if (planId !== currentPlanId) return;
    try {
      const town = await reverseGeocode(lat, lng);
      if (planId !== currentPlanId) return;
      if (town) {
        day.town = town;
        updateDayTown(day.day, town.name);
        const marker = stopMarkers.get(day.day);
        if (marker) setMarkerLabel(marker, town.name);
      }
    } catch { /* no town found — card keeps "No overnight stop found" */ }

    await sleep(OVERPASS_SPACING_MS);
    if (planId !== currentPlanId) return;
    try {
      const lodgEls = await overpass(lodgingQuery(lat, lng));
      if (planId !== currentPlanId) return;
      const lodging = lodgEls
        .map((el) => {
          const tags = el.tags ?? {};
          // US-style: "1701 Wynkoop Street, Denver" (number first, then street).
          const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(', ');
          return {
            name: tags.name ?? 'Unnamed lodging',
            address: address || undefined,
            website: tags.website || tags.url || undefined,
            lat: el.lat ?? el.center?.lat,
            lon: el.lon ?? el.center?.lon,
          };
        })
        .filter((l) => l.lat != null && l.lon != null)
        // Prefer named properties: "Unnamed lodging" sinks to the bottom and is
        // dropped once 6 named ones fill the list.
        .sort((a, b) => (a.name === 'Unnamed lodging' ? 1 : 0) - (b.name === 'Unnamed lodging' ? 1 : 0))
        .slice(0, 6);
      day.lodging = lodging;
      updateDayLodging(day.day, lodging, day.town?.name);
    } catch {
      // Honest error state — without this the card spins on "Finding lodging…"
      // forever (the old comment claimed it kept "No lodging found nearby",
      // but the placeholder was never replaced on failure).
      updateDayLodgingError(day.day, 'Couldn’t load lodging — check connection and re-plan');
    }
  }
}

// ---------- Plan handler ----------
const planBtn = document.getElementById('plan-btn');
const itineraryEl = document.getElementById('itinerary');
const stopMarkers = new Map(); // day number -> maplibregl.Marker (overnight stops)

async function planTrip() {
  const from = document.getElementById('from-input')._place;
  const to = document.getElementById('to-input')._place;
  if (!from || !to) { toast('Pick both destinations first'); return; }

  const planId = ++currentPlanId; // invalidates any in-flight enrichment
  stopMarkers.clear();

  planBtn.disabled = true;
  showLoadingSkeleton(itineraryEl);

  try {
    const hoursPerDay = clampHours(parseInt(hoursSlider.value, 10) || 4);
    const route = await fetchRouteWithTimeout(from, to);
    if (planId !== currentPlanId) return; // superseded
    const dayEndIndices = splitDays(route, hoursPerDay);
    const days = computeDays(route, dayEndIndices, to); // sync — no network

    // Render the route + itinerary immediately. Towns/lodging stream in after.
    await mapReady;
    drawRoute(map, route.geometry);
    addDestinationMarker(map, [from.lon, from.lat], from.name);
    addDestinationMarker(map, [to.lon, to.lat], to.name);
    for (const day of days) {
      if (day.isOvernight) {
        stopMarkers.set(day.day, addStopMarker(map, day.stopLngLat, 'Overnight stop'));
      }
    }

    renderItinerary(itineraryEl, days);
    itineraryEl.hidden = false;
    itineraryEl.classList.add('open');
    planBtn.disabled = false; // unblock as soon as the trip is visible

    // Stream towns + lodging into the cards in the background. Fire-and-forget:
    // it never blocks the trip from showing, and any failure is non-fatal.
    enrichDays(days, planId).catch(() => {});
  } catch (e) {
    if (planId !== currentPlanId) return;
    itineraryEl.replaceChildren(); // clear the loading skeleton on failure
    itineraryEl.classList.remove('open');
    itineraryEl.hidden = true;
    planBtn.disabled = false;
    console.error('Plan trip failed:', e);
    toast(friendlyRouteError(e));
  }
}

planBtn.addEventListener('click', planTrip);

// ---------- Itinerary close (mobile drawer) ----------
const closeBtn = document.getElementById('itinerary-close');
closeBtn.addEventListener('click', () => {
  itineraryEl.classList.remove('open');
});
