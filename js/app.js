// orchestration (Task 9)
import { attachAutocomplete } from './ui.js';

console.log('roadtrip planner loaded');

for (const id of ['from-input', 'to-input']) {
  const inputEl = document.getElementById(id);
  const dropdownEl = document.createElement('ul');
  dropdownEl.className = 'glass ac-dropdown';
  dropdownEl.hidden = true;
  document.body.appendChild(dropdownEl);
  attachAutocomplete(inputEl, dropdownEl);
}
