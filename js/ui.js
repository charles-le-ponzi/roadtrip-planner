// ui.js — shared UI helpers (autocomplete, etc.)
import { searchPlaces } from './places.js';

const DEBOUNCE_MS = 400; // Nominatim policy: max 1 req/s
const BLUR_GRACE_MS = 150; // let dropdown clicks register before hiding

export function attachAutocomplete(inputEl, dropdownEl) {
  let timer = null;
  let hideTimer = null;
  let reqSeq = 0;

  const show = () => { dropdownEl.hidden = false; };
  const hide = () => { dropdownEl.hidden = true; dropdownEl.replaceChildren(); };

  const positionDropdown = () => {
    const r = inputEl.getBoundingClientRect();
    const h = dropdownEl.offsetHeight || 246;
    if (r.bottom + h + 6 > window.innerHeight && r.top - h - 6 > 0) {
      dropdownEl.style.top = `${r.top - h - 6}px`; // flip upward
    } else {
      dropdownEl.style.top = `${Math.max(6, Math.min(r.bottom + 6, window.innerHeight - h - 6))}px`; // clamp
    }
    dropdownEl.style.left = `${r.left}px`;
    dropdownEl.style.width = `${r.width}px`;
  };

  const render = (results) => {
    dropdownEl.replaceChildren();
    if (!results.length) { hide(); return; }
    for (const r of results) {
      const item = document.createElement('li');
      item.className = 'ac-item';
      item.textContent = r.display_name;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // prevent blur race before click resolves
        const place = { lat: Number(r.lat), lon: Number(r.lon), name: r.display_name };
        inputEl.value = place.name;
        inputEl.dataset.place = JSON.stringify(place);
        inputEl._place = place;
        hide();
      });
      dropdownEl.appendChild(item);
    }
    positionDropdown();
    show();
  };

  inputEl.addEventListener('input', () => {
    clearTimeout(timer);
    const q = inputEl.value.trim();
    if (q.length < 2) { hide(); return; }
    const id = ++reqSeq;
    timer = setTimeout(async () => {
      try {
        const results = await searchPlaces(q);
        if (id !== reqSeq) return; // stale response, drop
        render(results);
      }
      catch { if (id === reqSeq) hide(); }
    }, DEBOUNCE_MS);
  });

  inputEl.addEventListener('blur', () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, BLUR_GRACE_MS);
  });

  inputEl.addEventListener('focus', () => clearTimeout(hideTimer));

  window.addEventListener('scroll', () => { if (!dropdownEl.hidden) positionDropdown(); }, true);
  window.addEventListener('resize', () => { if (!dropdownEl.hidden) positionDropdown(); });
}

// ---------- Itinerary ----------

export function formatDrive(seconds) {
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `≈ ${h}h ${m}m` : `≈ ${m}m`;
}

// Google Maps of the lodging's exact address — the place page, with the
// business attached (street view, phone, website, directions). Address first
// so a name collision can't resolve to a same-named property elsewhere.
export const mapsUrl = (spot) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [spot.address, spot.name].filter(Boolean).join(', '),
  )}`;

// The lodging's own website when OSM has one (the actual room listing).
// Otherwise Google Maps for that specific lodging — its place page carries
// its website and booking options, and it always resolves to the right
// property. (The old fallback was a generic web search: "confusing links".)
export const bookingUrl = (spot) =>
  spot.website || mapsUrl(spot);

function buildLodgingList(lodging, townName) {
  const list = document.createElement('div');
  list.className = 'lodging-list';
  if (!lodging.length) {
    const none = document.createElement('div');
    none.className = 'itinerary-none';
    none.textContent = 'No lodging found nearby';
    list.appendChild(none);
    return list;
  }
  // One self-contained card per lodging: name + address on top, its two
  // actions underneath. No more flat [name][Booking][name][Booking] strip
  // where you couldn't tell which button belonged to which lodge.
  for (const spot of lodging) {
    const item = document.createElement('div');
    item.className = 'lodging-item';

    const nameEl = document.createElement('div');
    nameEl.className = 'lodging-item__name';
    nameEl.textContent = spot.name;
    item.appendChild(nameEl);

    if (spot.address) {
      const addrEl = document.createElement('div');
      addrEl.className = 'lodging-item__address';
      addrEl.textContent = spot.address;
      item.appendChild(addrEl);
    }

    const actions = document.createElement('div');
    actions.className = 'lodging-item__actions';

    const mapsBtn = document.createElement('a');
    mapsBtn.className = 'lodging-btn';
    mapsBtn.href = mapsUrl(spot);
    mapsBtn.target = '_blank';
    mapsBtn.rel = 'noopener';
    mapsBtn.textContent = 'Maps';

    const bookBtn = document.createElement('a');
    bookBtn.className = 'lodging-btn lodging-btn--book';
    bookBtn.href = bookingUrl(spot);
    bookBtn.target = '_blank';
    bookBtn.rel = 'noopener';
    bookBtn.textContent = spot.website ? 'Book' : 'Book / find';

    actions.append(mapsBtn, bookBtn);
    item.appendChild(actions);
    list.appendChild(item);
  }
  return list;
}

function lodgingPlaceholder() {
  const list = document.createElement('div');
  list.className = 'lodging-list';
  const none = document.createElement('div');
  none.className = 'itinerary-none';
  none.textContent = 'Finding lodging…';
  list.appendChild(none);
  return list;
}

function townText(day) {
  if (day.town) return day.town.name;
  return day.isOvernight ? 'Finding overnight stop…' : 'Destination';
}

export function renderItinerary(containerEl, days) {
  containerEl.replaceChildren();

  days.forEach((day, i) => {
    const card = document.createElement('div');
    card.className = 'glass card-enter itinerary-card';
    card.dataset.day = day.day;
    card.style.animationDelay = `${i * 80}ms`;

    const heading = document.createElement('h3');
    heading.textContent = `Day ${day.day}`;
    card.appendChild(heading);

    const townLine = document.createElement('div');
    townLine.className = 'itinerary-town';
    townLine.textContent = townText(day);
    card.appendChild(townLine);

    const driveLine = document.createElement('div');
    driveLine.className = 'itinerary-drive';
    driveLine.textContent = formatDrive(day.driveSeconds);
    card.appendChild(driveLine);

    if (day.isOvernight) {
      const lodgingLabel = document.createElement('div');
      lodgingLabel.className = 'lodging-label';
      lodgingLabel.textContent = 'Lodging';
      card.appendChild(lodgingLabel);

      card.appendChild(day.lodging.length
        ? buildLodgingList(day.lodging, day.town?.name)
        : lodgingPlaceholder());
    }

    containerEl.appendChild(card);
  });
}

// Live-update a day card's town line (called when the reverse-geocode resolves).
export function updateDayTown(dayNum, townName) {
  const card = document.querySelector(`#itinerary .itinerary-card[data-day="${dayNum}"]`);
  const townLine = card && card.querySelector('.itinerary-town');
  if (townLine) townLine.textContent = townName;
}

// Live-update a day card's lodging list (called when the Overpass results land).
// anchorName: when the raw stop point was remote and lodging was anchored on a
// nearby town, pass that town so the label reads "Lodging in Durango" instead of
// a bare "Lodging" (or a misleading "No lodging found nearby").
export function updateDayLodging(dayNum, lodging, townName, anchorName) {
  const card = document.querySelector(`#itinerary .itinerary-card[data-day="${dayNum}"]`);
  if (!card) return;
  const label = card.querySelector('.lodging-label');
  if (label) {
    // Only relabel when we anchored on a town DIFFERENT from the stop's own town
    // (or when the stop had no town name) — otherwise "Lodging in X" where X is
    // the same town the card already shows is redundant.
    const distinct = anchorName && (!townName || anchorName.toLowerCase() !== townName.toLowerCase());
    label.textContent = distinct ? `Lodging in ${anchorName}` : 'Lodging';
  }
  const list = card.querySelector('.lodging-list');
  if (list) list.replaceWith(buildLodgingList(lodging, townName));
}

// Live-update a day card's lodging list to an honest error state (called when
// every Overpass mirror fails). Without this the card would spin on
// "Finding lodging…" forever.
export function updateDayLodgingError(dayNum, message) {
  const card = document.querySelector(`#itinerary .itinerary-card[data-day="${dayNum}"]`);
  const list = card && card.querySelector('.lodging-list');
  if (!list) return;
  const err = document.createElement('div');
  err.className = 'lodging-list';
  const none = document.createElement('div');
  none.className = 'itinerary-none';
  none.textContent = message;
  err.appendChild(none);
  list.replaceWith(err);
}
