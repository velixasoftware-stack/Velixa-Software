// The "Normal Range (as printed)" box on parameter forms: the reference range
// exactly as it prints in the report's Bio. Ref. Interval column. Entering
// Range Low / High (and any age/gender range rows) clubs them into this box
// automatically - one line each; once someone edits the box it stops
// auto-filling (clearing it turns auto-fill back on). It can also be typed
// on its own, without any low/high - e.g. "Negative" or several lines.
import { useEffect, useState } from 'react';
import api from '../api/client';

function pair(low, high) {
  const l = (low ?? '').toString().trim();
  const h = (high ?? '').toString().trim();
  if (l && h) return `${l} - ${h}`;
  if (l) return `> ${l}`;
  if (h) return `< ${h}`;
  return '';
}

/** Default low/high plus every age/gender range row, one line each. */
export function autoRangeText(low, high, rows = []) {
  const lines = [];
  const base = pair(low, high);
  const ruleLines = rows
    .map((r) => {
      const range = pair(r.normalRangeLow, r.normalRangeHigh);
      if (!range) return null;
      const who = [
        r.gender && r.gender !== 'Any' ? r.gender : '',
        r.ageMin !== '' && r.ageMin != null || r.ageMax !== '' && r.ageMax != null
          ? `${r.ageMin === '' || r.ageMin == null ? 0 : r.ageMin}-${r.ageMax === '' || r.ageMax == null ? '∞' : r.ageMax} ${r.ageUnit || 'Years'}`
          : '',
      ].filter(Boolean).join(' ');
      return who ? `${who}: ${range}` : range;
    })
    .filter(Boolean);
  if (base) lines.push(ruleLines.length ? `Default: ${base}` : base);
  lines.push(...ruleLines);
  return lines.join('\n');
}

/**
 * Keeps form.normalRangeText filled from its ranges until edited by hand.
 * form needs normalRangeText + rangeTextEdited; setForm is its state setter.
 */
export function useAutoRangeText(form, setForm, low, high, rows) {
  const auto = autoRangeText(low, high, rows);
  useEffect(() => {
    if (!form.rangeTextEdited && form.normalRangeText !== auto) {
      setForm((f) => ({ ...f, normalRangeText: auto }));
    }
  }, [auto, form.rangeTextEdited]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Typing marks the box as edited; clearing it resumes auto-fill. */
export function rangeTextChange(setForm) {
  return (value) => setForm((f) => ({ ...f, normalRangeText: value, rangeTextEdited: value.trim() !== '' }));
}

export default function NormalRangeTextBox({ value, onChange }) {
  return (
    <label style={{ display: 'block', marginTop: 10 }}>
      <span>Normal Range (as printed on the report)</span>
      <textarea
        rows={3}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={'Fills from the ranges above, or type directly - e.g. "Negative", "Up to 200 mg/dL", or one line per age group'}
      />
    </label>
  );
}

/** The reference range to show for a result row: the printed text if set, else low - high. */
export function rangeLabel(p) {
  if (p.normalRangeText && p.normalRangeText.trim()) return p.normalRangeText;
  const hasRange = p.normalRangeLow != null && p.normalRangeLow !== '' && p.normalRangeHigh != null && p.normalRangeHigh !== '';
  return hasRange ? `${p.normalRangeLow} - ${p.normalRangeHigh}` : '';
}

/**
 * Edit an existing parameter's printed Normal Range (Manage ranges dialog).
 * canEdit false (a universal parameter seen from a client) shows it read-only.
 */
export function ManageRangeText({ param, apiBase, canEdit, onSaved }) {
  const [draft, setDraft] = useState(param.normalRangeText || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { setDraft(param.normalRangeText || ''); setMsg(''); }, [param.id, param.normalRangeText]);
  const suggested = autoRangeText(param.normalRangeLow, param.normalRangeHigh, param.ParameterNormalRanges || []);

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      await api.put(`${apiBase}/parameters/${param.id}/normal-range-text`, { normalRangeText: draft });
      setMsg('Saved');
      onSaved?.();
    } catch (err) {
      setMsg(err.response?.data?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return (
      <p style={{ fontSize: 13, color: '#64748b', whiteSpace: 'pre-wrap' }}>
        Printed on report: <strong>{param.normalRangeText || suggested || '—'}</strong> (universal parameter - set by Chief Admin)
      </p>
    );
  }
  return (
    <div style={{ margin: '0 0 12px' }}>
      <NormalRangeTextBox value={draft} onChange={setDraft} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Normal Range'}</button>
        {suggested && draft !== suggested && (
          <button type="button" className="secondary" onClick={() => setDraft(suggested)}>Fill from ranges</button>
        )}
        {msg && <span style={{ fontSize: 12, color: msg === 'Saved' ? '#15803d' : '#b91c1c' }}>{msg}</span>}
      </div>
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0' }}>Leave empty to print the low - high range instead.</p>
    </div>
  );
}
