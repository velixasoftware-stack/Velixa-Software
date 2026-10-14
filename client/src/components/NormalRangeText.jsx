// The "Normal Range (as printed)" boxes on parameter forms - gender-wise:
// Male, Female and Common. A male/female patient's report prints its own
// box (falling back to Common when that box is empty); anyone else gets
// Common. Each box fills itself from the ranges entered - Male from the Male
// age/gender rows, Female from the Female rows, Common from the default
// Range Low/High and the "Any" rows - one line per age band. Once a box is
// edited by hand it stops auto-filling (clearing it turns auto-fill back
// on). Any box can also be typed on its own, e.g. "Negative".
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

const blank = (v) => v === '' || v == null;
function ageBand(r) {
  if (blank(r.ageMin) && blank(r.ageMax)) return '';
  return `${blank(r.ageMin) ? 0 : r.ageMin}-${blank(r.ageMax) ? '∞' : r.ageMax} ${r.ageUnit || 'Years'}`;
}

function rowLines(rows, keep, withGender = false) {
  return rows
    .filter(keep)
    .map((r) => {
      const range = pair(r.normalRangeLow, r.normalRangeHigh);
      if (!range) return null;
      const who = [withGender && r.gender && r.gender !== 'Any' ? r.gender : '', ageBand(r)].filter(Boolean).join(' ');
      return who ? `${who}: ${range}` : range;
    })
    .filter(Boolean);
}

/** { common, male, female } texts from the default low/high and the range rows. */
export function autoRangeTexts(low, high, rows = []) {
  const g = (r) => (r.gender || 'Any');
  const male = rowLines(rows, (r) => g(r) === 'Male').join('\n');
  const female = rowLines(rows, (r) => g(r) === 'Female').join('\n');
  const others = rowLines(rows, (r) => g(r) !== 'Male' && g(r) !== 'Female', true);
  const base = pair(low, high);
  const common = [base && others.length ? `Default: ${base}` : base, ...others].filter(Boolean).join('\n');
  return { common, male, female };
}

const FIELDS = [
  { key: 'normalRangeTextMale', auto: 'male', edited: 'rangeTextMaleEdited', label: 'Male' },
  { key: 'normalRangeTextFemale', auto: 'female', edited: 'rangeTextFemaleEdited', label: 'Female' },
  { key: 'normalRangeText', auto: 'common', edited: 'rangeTextEdited', label: 'Common (all / other)' },
];

/** Blank form fields for the three boxes. */
export const blankRangeTexts = () => ({
  normalRangeText: '', normalRangeTextMale: '', normalRangeTextFemale: '',
  rangeTextEdited: false, rangeTextMaleEdited: false, rangeTextFemaleEdited: false,
});

/** Keeps each box filled from its ranges until that box is edited by hand. */
export function useAutoRangeText(form, setForm, low, high, rows) {
  const auto = autoRangeTexts(low, high, rows);
  const sig = `${auto.common}\u0000${auto.male}\u0000${auto.female}`;
  useEffect(() => {
    setForm((f) => {
      let next = f;
      for (const fld of FIELDS) {
        if (!f[fld.edited] && f[fld.key] !== auto[fld.auto]) next = { ...next, [fld.key]: auto[fld.auto] };
      }
      return next;
    });
  }, [sig, form.rangeTextEdited, form.rangeTextMaleEdited, form.rangeTextFemaleEdited]); // eslint-disable-line react-hooks/exhaustive-deps
}

function RangeBox({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display: 'block', margin: 0 }}>
      <span>{label}</span>
      <textarea rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

/** The three boxes for a parameter form; typing marks a box edited, clearing resumes auto-fill. */
export default function NormalRangeTextBoxes({ form, setForm }) {
  return (
    <div style={{ marginTop: 10 }}>
      <span style={{ fontWeight: 600, fontSize: 13 }}>Normal Range (as printed on the report)</span>
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 6px' }}>
        A male/female patient's report prints their own box; anyone else (or an empty box) gets Common.
        Fills from the ranges above, or type directly - e.g. "Negative".
      </p>
      <div className="range-text-grid">
        {FIELDS.map((fld) => (
          <RangeBox
            key={fld.key}
            label={fld.label}
            value={form[fld.key]}
            placeholder={fld.auto === 'common' ? 'e.g. 70 - 110 or Negative' : `Printed for ${fld.label.toLowerCase()} patients`}
            onChange={(v) => setForm((f) => ({ ...f, [fld.key]: v, [fld.edited]: v.trim() !== '' }))}
          />
        ))}
      </div>
    </div>
  );
}

/** The reference range to show for a result row: the printed text if set, else low - high. */
export function rangeLabel(p) {
  if (p.normalRangeText && p.normalRangeText.trim()) return p.normalRangeText;
  const hasRange = p.normalRangeLow != null && p.normalRangeLow !== '' && p.normalRangeHigh != null && p.normalRangeHigh !== '';
  return hasRange ? `${p.normalRangeLow} - ${p.normalRangeHigh}` : '';
}

/**
 * Edit an existing parameter's printed Normal Ranges (Manage ranges dialog).
 * canEdit false (a universal parameter seen from a client) shows them read-only.
 */
export function ManageRangeText({ param, apiBase, canEdit, onSaved }) {
  const fromParam = () => ({
    normalRangeText: param.normalRangeText || '',
    normalRangeTextMale: param.normalRangeTextMale || '',
    normalRangeTextFemale: param.normalRangeTextFemale || '',
  });
  const [draft, setDraft] = useState(fromParam);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { setDraft(fromParam()); setMsg(''); }, [param.id, param.normalRangeText, param.normalRangeTextMale, param.normalRangeTextFemale]); // eslint-disable-line react-hooks/exhaustive-deps
  const auto = autoRangeTexts(param.normalRangeLow, param.normalRangeHigh, param.ParameterNormalRanges || []);
  const suggested = { normalRangeText: auto.common, normalRangeTextMale: auto.male, normalRangeTextFemale: auto.female };

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      await api.put(`${apiBase}/parameters/${param.id}/normal-range-text`, draft);
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
      <div style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>
        Printed on report (universal parameter - set by Chief Admin):
        {FIELDS.map((fld) => (
          <div key={fld.key} style={{ whiteSpace: 'pre-wrap' }}><strong>{fld.label}:</strong> {param[fld.key] || suggested[fld.key] || '—'}</div>
        ))}
      </div>
    );
  }
  const differs = FIELDS.some((fld) => suggested[fld.key] && draft[fld.key] !== suggested[fld.key]);
  return (
    <div style={{ margin: '0 0 12px' }}>
      <span style={{ fontWeight: 600, fontSize: 13 }}>Normal Range (as printed on the report)</span>
      <div className="range-text-grid" style={{ marginTop: 6 }}>
        {FIELDS.map((fld) => (
          <RangeBox key={fld.key} label={fld.label} value={draft[fld.key]} onChange={(v) => setDraft((d) => ({ ...d, [fld.key]: v }))} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Normal Range'}</button>
        {differs && (
          <button type="button" className="secondary" onClick={() => setDraft((d) => ({ ...d, ...Object.fromEntries(FIELDS.filter((f) => suggested[f.key]).map((f) => [f.key, suggested[f.key]])) }))}>
            Fill from ranges
          </button>
        )}
        {msg && <span style={{ fontSize: 12, color: msg === 'Saved' ? '#15803d' : '#b91c1c' }}>{msg}</span>}
      </div>
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0' }}>A male/female box left empty prints Common; all empty prints the low - high range.</p>
    </div>
  );
}
