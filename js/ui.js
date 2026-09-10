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

// Name+address query — Google resolves this to the actual business (street
// view, phone, website, directions). A bare "lat,lon" query only drops a pin
// at the coordinates with no business attached.
export const mapsUrl = (spot) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(spot.name + (spot.address ? `, ${spot.address}` : ''))}`;

// The property's own website is the actual room listing (OSM tags carry it for
// ~half of mapped hotels). Booking.com deep-links don't survive its redirect
// (verified: ?ss= is dropped to a bare searchresults.html), so when OSM has no
// website, search for the property by name+address — its own listing pages
// (Booking, Expedia, the hotel site) rank at the top of those results.
export const bookingUrl = (spot) =>
  spot.website ||
  `https://www.google.com/search?q=${encodeURIComponent(spot.name + (spot.address ? `, ${spot.address}` : '') + ' booking')}`;

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
  for (const spot of lodging) {
    const mapsChip = document.createElement('a');
    mapsChip.className = 'lodging-chip';
    mapsChip.href = mapsUrl(spot);
    mapsChip.target = '_blank';
    mapsChip.rel = 'noopener';
    mapsChip.textContent = spot.name;

    const bookingChip = document.createElement('a');
    bookingChip.className = 'lodging-chip lodging-chip--booking';
    bookingChip.href = bookingUrl(spot);
    bookingChip.target = '_blank';
    bookingChip.rel = 'noopener';
    bookingChip.textContent = 'Booking';

    list.append(mapsChip, bookingChip);
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
export function updateDayLodging(dayNum, lodging, townName) {
  const card = document.querySelector(`#itinerary .itinerary-card[data-day="${dayNum}"]`);
  const list = card && card.querySelector('.lodging-list');
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
