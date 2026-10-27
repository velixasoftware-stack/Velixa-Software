import { useEffect, useState } from 'react';
import api from '../api/client';

// Chief Admin maintains one title list for every client - fetched once per
// page load and shared by every dropdown on it.
let titlesRequest = null;
function loadTitles() {
  if (!titlesRequest) {
    titlesRequest = api.get('/patients/titles').then((r) => r.data.map((t) => t.name)).catch(() => {
      titlesRequest = null; // let the next dropdown retry
      return [];
    });
  }
  return titlesRequest;
}

/**
 * Patient Title dropdown (Mr./Mrs./...) from Chief Admin's Patient Titles.
 * A saved title no longer in that list (since deleted) is still shown, so
 * editing such a patient doesn't silently drop it.
 */
export default function PatientTitleSelect({ value, onChange, disabled, style }) {
  const [titles, setTitles] = useState([]);
  useEffect(() => {
    let alive = true;
    loadTitles().then((list) => { if (alive) setTitles(list); });
    return () => { alive = false; };
  }, []);

  const options = value && !titles.includes(value) ? [value, ...titles] : titles;
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={style}>
      <option value="">—</option>
      {options.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}
