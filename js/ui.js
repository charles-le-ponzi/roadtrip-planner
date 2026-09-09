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
