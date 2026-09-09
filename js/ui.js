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

export function renderItinerary(containerEl, days) {
  containerEl.replaceChildren();

  days.forEach((day, i) => {
    const card = document.createElement('div');
    card.className = 'glass card-enter itinerary-card';
    card.style.animationDelay = `${i * 80}ms`;

    const heading = document.createElement('h3');
    heading.textContent = `Day ${day.day}`;
    card.appendChild(heading);

    const townLine = document.createElement('div');
    townLine.className = 'itinerary-town';
    townLine.textContent = day.town ? day.town.name : 'No overnight stop found';
    card.appendChild(townLine);

    const driveLine = document.createElement('div');
    driveLine.className = 'itinerary-drive';
    driveLine.textContent = formatDrive(day.driveSeconds);
    card.appendChild(driveLine);

    const lodgingLabel = document.createElement('div');
    lodgingLabel.className = 'lodging-label';
    lodgingLabel.textContent = 'Lodging';
    card.appendChild(lodgingLabel);

    const lodgingList = document.createElement('div');
    lodgingList.className = 'lodging-list';
    if (!day.lodging.length) {
      const none = document.createElement('div');
      none.className = 'itinerary-none';
      none.textContent = 'No lodging found nearby';
      lodgingList.appendChild(none);
    } else {
      for (const spot of day.lodging) {
        const mapsChip = document.createElement('a');
        mapsChip.className = 'lodging-chip';
        mapsChip.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${spot.name} ${spot.lat} ${spot.lon}`)}`;
        mapsChip.target = '_blank';
        mapsChip.rel = 'noopener';
        mapsChip.textContent = spot.name;

        const bookingChip = document.createElement('a');
        bookingChip.className = 'lodging-chip lodging-chip--booking';
        bookingChip.href = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(spot.name)}`;
        bookingChip.target = '_blank';
        bookingChip.rel = 'noopener';
        bookingChip.textContent = 'Booking';

        lodgingList.append(mapsChip, bookingChip);
      }
    }
    card.appendChild(lodgingList);

    containerEl.appendChild(card);
  });
}
