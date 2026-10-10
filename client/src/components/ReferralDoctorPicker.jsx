import { useEffect, useRef, useState } from 'react';
import api from '../api/client';

function initials(name) {
  return name.replace(/^dr\.?\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'DR';
}

/**
 * "Referred by a doctor" switch + doctor search, inline on the billing page.
 * Suggests this clinic's saved referral doctors (most recently used first);
 * a name that isn't saved yet is offered as "Add new doctor" - the bill
 * request saves it against the clinic (findOrCreateDoctor on the server), so
 * it's suggested from the next bill onwards.
 */
export default function ReferralDoctorPicker({ enabled, onToggle, value, onChange }) {
  const [query, setQuery] = useState(value || '');
  const [doctors, setDoctors] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { setQuery(value || ''); }, [value]);

  // Server-side search, so a clinic with many saved doctors still finds all of them.
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setTimeout(() => {
      api.get('/doctors', { params: query.trim() ? { search: query.trim() } : {} })
        .then((r) => setDoctors(r.data))
        .catch(() => setDoctors([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, enabled]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggle() {
    const next = !enabled;
    onToggle(next);
    if (!next) { onChange(''); setQuery(''); }
    else setTimeout(() => inputRef.current?.focus(), 0);
  }

  function pick(name) {
    onChange(name);
    setQuery(name);
    setOpen(false);
  }

  const typed = query.trim();
  const exact = doctors.find((d) => d.name.toLowerCase() === typed.toLowerCase());
  const selected = value && value === query;
  const isNew = selected && !exact;

  return (
    <div className={`referral-picker${enabled ? ' on' : ''}`} ref={boxRef}>
      <button type="button" className="referral-switch" onClick={toggle} aria-pressed={enabled}>
        <span className="referral-check" aria-hidden="true">{enabled ? '✓' : ''}</span>
        <span className="referral-switch-text">
          <strong>Referral</strong>
          <small>{enabled ? 'Referred by a doctor' : 'Tick if a doctor referred this patient'}</small>
        </span>
      </button>

      {enabled && (
        <div className="referral-search">
          {selected ? (
            <div className="referral-chip">
              <span className="referral-avatar">{initials(value)}</span>
              <span className="referral-chip-name">{value}</span>
              {isNew && <span className="referral-new-tag">New · will be saved</span>}
              <button type="button" aria-label="Change doctor" onClick={() => { onChange(''); setQuery(''); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}>×</button>
            </div>
          ) : (
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); onChange(''); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); if (typed) pick(exact ? exact.name : typed); }
              }}
              placeholder="Search or type the doctor's name…"
            />
          )}

          {open && !selected && (
            <div className="referral-results">
              {doctors.map((d) => (
                <button type="button" key={d.id} className="referral-option" onClick={() => pick(d.name)}>
                  <span className="referral-avatar">{initials(d.name)}</span>
                  <span>
                    {d.name}
                    {d.mobile && <small> · {d.mobile}</small>}
                  </span>
                </button>
              ))}
              {typed && !exact && (
                <button type="button" className="referral-option add-new" onClick={() => pick(typed)}>
                  <span className="referral-avatar">+</span>
                  <span>Add new doctor “{typed}”</span>
                </button>
              )}
              {!typed && doctors.length === 0 && <div className="referral-empty">No saved doctors yet - type a name to add one.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
