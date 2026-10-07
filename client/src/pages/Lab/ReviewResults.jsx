import { useMemo, useState } from 'react';
import api from '../../api/client';

function isOutOfRange(value, low, high) {
  const v = Number(value);
  if (value === '' || Number.isNaN(v) || low == null || high == null) return false;
  const l = Number(low);
  const h = Number(high);
  if (Number.isNaN(l) || Number.isNaN(h)) return false;
  return v < l || v > h;
}

function paramsFor(sample) {
  return sample.BillItem?.TestMaster?.ParameterMasters || [];
}

// Interpretation parameters are free-text commentary, not a measured result -
// leaving one blank shouldn't block a test from counting as complete and
// auto-verifying on save.
function requiredParamsFor(sample) {
  return paramsFor(sample).filter((p) => !p.isInterpretation);
}

function initialValuesFor(sample) {
  const values = {};
  for (const r of sample.Results || []) values[r.parameterId] = r.value;
  return values;
}

function formatAge(age, ageUnit) {
  if (age == null || age === '') return '';
  if (ageUnit === 'Months') return `${age}mo`;
  if (ageUnit === 'Days') return `${age}d`;
  return `${age}y`;
}

/**
 * Full-screen result entry + review/verify panel for one bill's tests -
 * the same screen opens whichever of "Results" or "Verify" was clicked on a
 * test, since both are really "look at this test's values and confirm them".
 */
export default function ReviewResults({ group, focusSampleId, onClose, onSaved }) {
  const eligibleSamples = useMemo(
    () => group.samples.filter((s) => ['COLLECTED', 'RESULT_ENTERED', 'VERIFIED'].includes(s.status)),
    [group],
  );

  const [values, setValues] = useState(() => {
    const v = {};
    for (const s of eligibleSamples) v[s.id] = initialValuesFor(s);
    return v;
  });
  const [savedValues] = useState(() => {
    const v = {};
    for (const s of eligibleSamples) v[s.id] = initialValuesFor(s);
    return v;
  });
  const [checked, setChecked] = useState(() => {
    const set = new Set();
    for (const s of eligibleSamples) {
      const complete = requiredParamsFor(s).every((p) => (initialValuesFor(s)[p.id] || '').toString().trim() !== '');
      if (complete) set.add(s.id);
    }
    // Whichever test "Results"/"Verify" was clicked on should already be
    // showing when the screen opens, not require an extra click to check it.
    if (focusSampleId && eligibleSamples.some((s) => s.id === focusSampleId)) set.add(focusSampleId);
    return set;
  });
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(''); // '' | 'saving' | 'verifying' | 'releasing' - drives the footer button's label while busy
  const [error, setError] = useState('');

  function enteredCount(sample) {
    const params = requiredParamsFor(sample);
    const vals = values[sample.id] || {};
    const filled = params.filter((p) => (vals[p.id] || '').toString().trim() !== '').length;
    return { filled, total: params.length };
  }

  function setValue(sampleId, parameterId, value) {
    setValues((v) => ({ ...v, [sampleId]: { ...v[sampleId], [parameterId]: value } }));
  }

  function toggleChecked(sampleId) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(sampleId)) next.delete(sampleId); else next.add(sampleId);
      return next;
    });
  }

  function toggleSelectAll() {
    setChecked((prev) => (prev.size === eligibleSamples.length ? new Set() : new Set(eligibleSamples.map((s) => s.id))));
  }

  const checkedSamples = eligibleSamples.filter((s) => checked.has(s.id));
  const allCheckedReady = checkedSamples.length > 0 && checkedSamples.every((s) => enteredCount(s).filled === enteredCount(s).total);
  // Editing results that were already VERIFIED (opened via "Edit Results" on
  // a report pending/awaiting release) is a correction, not first-time entry -
  // saving re-verifies and re-releases it in one step instead of requiring a
  // separate trip through Verify and then the main screen's Release action.
  const allCheckedWereVerified = checkedSamples.length > 0 && checkedSamples.every((s) => s.status === 'VERIFIED');

  async function handleSubmit() {
    if (busy || checkedSamples.length === 0) return;
    setBusy(true);
    setError('');
    try {
      // Every checked sample's call runs in parallel instead of one-by-one -
      // with several tests checked, awaiting each sample's save/verify/release
      // in sequence could take several seconds and look stuck with no
      // feedback. The stage label below keeps the button honest about what's
      // still happening while it works.
      setStage('saving');
      await Promise.all(checkedSamples.map((s) => {
        const params = paramsFor(s);
        const results = params.map((p) => ({ parameterId: p.id, value: (values[s.id]?.[p.id] || '').toString() }));
        return api.post(`/lab/samples/${s.id}/results`, { results });
      }));

      if (allCheckedReady) {
        if (allCheckedWereVerified) {
          setStage('verifying');
          await Promise.all(checkedSamples.map((s) => api.post(`/lab/samples/${s.id}/verify`)));
          setStage('releasing');
          await Promise.all(checkedSamples.map((s) => api.post(`/lab/samples/${s.id}/release`)));
        } else {
          setStage('verifying');
          await Promise.all(checkedSamples.map((s) => (
            ['RESULT_ENTERED', 'COLLECTED'].includes(s.status)
              ? api.post(`/lab/samples/${s.id}/verify`).catch(() => {})
              : Promise.resolve()
          )));
        }
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save');
    } finally {
      setStage('');
      setBusy(false);
    }
  }

  function hasChanges(sample) {
    return paramsFor(sample).some(
      (p) => (values[sample.id]?.[p.id] || '') !== (savedValues[sample.id]?.[p.id] || ''),
    );
  }

  return (
    <div className="review-screen">
      <div className="review-header">
        <strong>Review Results</strong>
        <span className="dot">•</span>
        <span className="meta">#{`LAB${String(group.billId).padStart(5, '0')}`}</span>
        <span className="dot">•</span>
        <span className="meta">{group.billNo}</span>
        <span className="dot">•</span>
        <span className="meta">{group.patient?.name}</span>
        {(group.patient?.age || group.patient?.gender) && (
          <>
            <span className="dot">•</span>
            <span className="meta">
              {formatAge(group.patient?.age, group.patient?.ageUnit)}
              {group.patient?.age && group.patient?.gender ? ' / ' : ''}
              {group.patient?.gender}
            </span>
          </>
        )}
        <button className="close-btn" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="review-body">
        <div className="review-sidebar">
          <div className="review-select-all" onClick={toggleSelectAll} style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={checked.size === eligibleSamples.length && eligibleSamples.length > 0}
              ref={(el) => { if (el) el.indeterminate = checked.size > 0 && checked.size < eligibleSamples.length; }}
              onChange={toggleSelectAll}
              onClick={(e) => e.stopPropagation()}
            />
            <span>Select All</span>
            <span className="count">{checked.size}/{eligibleSamples.length}</span>
          </div>

          {eligibleSamples.map((s) => {
            const c = enteredCount(s);
            const complete = c.filled === c.total;
            const isChecked = checked.has(s.id);
            return (
              <div
                key={s.id}
                className={`review-test-row${isChecked ? ' active' : ''}`}
                onClick={() => toggleChecked(s.id)}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleChecked(s.id)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ marginTop: 2 }}
                />
                <div>
                  <div className="name">{s.BillItem?.TestMaster?.testName}</div>
                  <span className={`count-pill${complete ? ' complete' : ''}`}>{c.filled} / {c.total}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="review-main">
          {error && <p className="error-text">{error}</p>}

          {checkedSamples.length === 0 && (
            <p className="masters-empty">Check a test on the left to enter or review its results.</p>
          )}

          {checkedSamples.map((sample) => {
            const count = enteredCount(sample);
            return (
              <div key={sample.id} className="review-section">
                <div className="review-main-header">
                  <h2>{sample.BillItem?.TestMaster?.testName}</h2>
                  {hasChanges(sample) && <span className="review-badge delta">Δ Delta</span>}
                  <span className={`review-badge entered${count.filled === count.total ? '' : ' partial'}`}>
                    {count.filled} / {count.total} Entered
                  </span>
                </div>

                {paramsFor(sample).some((p) => !p.isInterpretation) && (
                  <div className="review-param-grid">
                    {paramsFor(sample).filter((p) => !p.isInterpretation).map((p) => {
                      const value = values[sample.id]?.[p.id] || '';
                      const abnormal = isOutOfRange(value, p.normalRangeLow, p.normalRangeHigh);
                      return (
                        <div className="review-param-card" key={p.id}>
                          <div>
                            <div className="p-name">{p.parameterCode ? `[${p.parameterCode}] ` : ''}{p.parameterName}</div>
                            <div className="p-range">Normal: {p.normalRangeLow}–{p.normalRangeHigh}</div>
                          </div>
                          <div className="p-input-wrap">
                            <input
                              className={abnormal ? 'abnormal' : ''}
                              value={value}
                              onChange={(e) => setValue(sample.id, p.id, e.target.value)}
                            />
                            <span className="p-unit">{p.unit}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {paramsFor(sample).filter((p) => p.isInterpretation).map((p) => (
                  <div className="review-interpretation-card" key={p.id}>
                    <div className="p-name">{p.parameterCode ? `[${p.parameterCode}] ` : ''}{p.parameterName}</div>
                    <textarea
                      rows={5}
                      value={values[sample.id]?.[p.id] || ''}
                      onChange={(e) => setValue(sample.id, p.id, e.target.value)}
                      placeholder="Enter interpretation / findings…"
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="review-footer">
        <span className="checked-count">{checkedSamples.length} of {eligibleSamples.length} test(s) checked</span>
        <button onClick={handleSubmit} disabled={busy || checkedSamples.length === 0}>
          {busy
            ? { saving: 'Saving…', verifying: 'Verifying…', releasing: 'Releasing…' }[stage] || 'Saving…'
            : allCheckedReady
              ? (allCheckedWereVerified
                ? `Release ${checkedSamples.length} Test${checkedSamples.length === 1 ? '' : 's'}`
                : `Mark Reviewed ${checkedSamples.length} Test${checkedSamples.length === 1 ? '' : 's'}`)
              : `Save Results (${checkedSamples.length})`}
        </button>
      </div>
    </div>
  );
}
