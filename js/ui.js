// ui.js — shared UI helpers (autocomplete, etc.)
import { searchPlaces } from './places.js';

const DEBOUNCE_MS = 400; // Nominatim policy: max 1 req/s
const BLUR_GRACE_MS = 150; // let dropdown clicks register before hiding

export function attachAutocomplete(inputEl, dropdownEl) {
  let timer = null;
  let hideTimer = null;

  const show = () => { dropdownEl.hidden = false; };
  const hide = () => { dropdownEl.hidden = true; dropdownEl.replaceChildren(); };

  const positionDropdown = () => {
    const r = inputEl.getBoundingClientRect();
    dropdownEl.style.top = `${r.bottom + 6}px`;
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
    timer = setTimeout(async () => {
      try { render(await searchPlaces(q)); }
      catch { hide(); }
    }, DEBOUNCE_MS);
  });

  inputEl.addEventListener('blur', () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, BLUR_GRACE_MS);
  });

  window.addEventListener('scroll', () => { if (!dropdownEl.hidden) positionDropdown(); }, true);
  window.addEventListener('resize', () => { if (!dropdownEl.hidden) positionDropdown(); });
}
