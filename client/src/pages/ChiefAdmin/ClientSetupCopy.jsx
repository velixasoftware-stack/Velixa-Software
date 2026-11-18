import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import SearchSelect from '../../components/SearchSelect';

// What can be copied - keys match the server's "parts".
const PART_OPTIONS = [
  { key: 'ownParameters', label: 'Own parameters (with their normal ranges)', hint: 'Parameters the client added for itself', defaultOn: true },
  { key: 'normalRanges', label: 'Normal range changes on Chief Admin parameters', hint: 'Its own age/gender ranges and printed range text', defaultOn: true },
  { key: 'labels', label: 'Parameter name / unit / method changes', hint: 'Its own labels for Chief Admin parameters', defaultOn: true },
  { key: 'testSettings', label: 'Specimens and short names', hint: 'Per test', defaultOn: true },
  { key: 'hiddenTrend', label: 'Removed parameters and AI trend settings', hint: 'Per test / parameter', defaultOn: true },
  { key: 'prices', label: 'Test prices and Active/Inactive', hint: 'Off by default - prices usually differ per client', defaultOn: false },
];

const RESULT_LABELS = {
  ownParameters: 'own parameters', rangeRows: 'normal range rows', normalRanges: 'normal range changes', labels: 'name/unit/method changes',
  specimens: 'specimens', shortNames: 'short names', hidden: 'removed parameters', trend: 'trend settings', prices: 'prices',
};

/**
 * Chief Admin: copy one client's own test setup (its parameters, normal
 * ranges, labels, specimens, prices ...) to another client, test by test.
 * The source client is never changed.
 */
export default function ClientSetupCopy() {
  const [clients, setClients] = useState([]);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [parts, setParts] = useState(() => new Set(PART_OPTIONS.filter((p) => p.defaultOn).map((p) => p.key)));
  const [overwrite, setOverwrite] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get('/clients').then((r) => setClients(r.data.clients || [])).catch(() => setError('Failed to load clients'));
  }, []);

  async function loadPreview(from = fromId, to = toId) {
    setPreview(null);
    setSelected(new Set());
    setResult(null);
    setError('');
    if (!from) return;
    if (to && String(to) === String(from)) { setError('Pick two different clients'); return; }
    setBusy('load');
    try {
      const { data } = await api.get('/admin/client-copy/preview', { params: { fromClientId: from, toClientId: to || undefined } });
      setPreview(data);
      setSelected(new Set(data.rows.map((r) => r.testId)));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load the client\'s setup');
    } finally {
      setBusy('');
    }
  }

  const clientOptions = clients.map((c) => ({ value: c.id, label: `${c.clientCode} — ${c.clientName}`, sublabel: [c.mobile, c.email].filter(Boolean).join(' · ') }));
  const clientLabel = (id) => clientOptions.find((o) => String(o.value) === String(id))?.label || '';

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (preview?.rows || []).filter((r) => !q || `${r.testCode} ${r.testName} ${r.category || ''}`.toLowerCase().includes(q));
  }, [preview, search]);
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.testId));
  function toggleAllShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      shown.forEach((r) => (allShownSelected ? next.delete(r.testId) : next.add(r.testId)));
      return next;
    });
  }
  const toggle = (setter, k) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  async function runCopy() {
    const list = PART_OPTIONS.filter((p) => parts.has(p.key)).map((p) => `• ${p.label}`).join('\n');
    if (!window.confirm(`Copy from ${clientLabel(fromId)}\nto ${clientLabel(toId)}\n\n${selected.size} test(s):\n${list}\n\n${overwrite ? 'Settings the target already has WILL BE REPLACED.' : 'Settings the target already has are kept.'}`)) return;
    setBusy('copy');
    setError('');
    setResult(null);
    try {
      const { data } = await api.post('/admin/client-copy', {
        fromClientId: Number(fromId), toClientId: Number(toId), testIds: [...selected], parts: [...parts], overwrite,
      });
      setResult(data);
      await loadPreview(fromId, toId).then(() => setResult(data));
    } catch (err) {
      setError(err.response?.data?.message || 'Copy failed - nothing was changed');
    } finally {
      setBusy('');
    }
  }

  const count = (n) => (n ? n : <span className="cell-sub">—</span>);
  const canCopy = fromId && toId && String(fromId) !== String(toId) && selected.size > 0 && parts.size > 0 && !busy;

  return (
    <div>
      <div className="card">
        <h3 style={{ margin: 0 }}>Copy Client Setup</h3>
        <p className="cell-sub" style={{ margin: '2px 0 12px' }}>
          Copy one client&apos;s own tests setup - parameters, normal ranges, names/units/methods, specimens and
          (optionally) prices - to another client. The client you copy from is never changed.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 300px', maxWidth: 420 }}>
            <span className="reset-field-label">Copy from (Client A)</span>
            <SearchSelect options={clientOptions} value={fromId} placeholder="Search by client code, name, mobile…"
              onChange={(id) => { const v = id ? String(id) : ''; setFromId(v); loadPreview(v, toId); }} />
          </div>
          <div style={{ fontSize: 22, color: '#64748b', paddingBottom: 6 }}>→</div>
          <div style={{ flex: '1 1 300px', maxWidth: 420 }}>
            <span className="reset-field-label">Copy to (Client B)</span>
            <SearchSelect options={clientOptions.filter((o) => String(o.value) !== String(fromId))} value={toId} placeholder="Search by client code, name, mobile…"
              onChange={(id) => { const v = id ? String(id) : ''; setToId(v); if (fromId) loadPreview(fromId, v); }} />
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>

      {busy === 'load' && <div className="card"><p className="cell-sub">Loading…</p></div>}

      {preview && (
        <>
          <div className="card">
            <h4 style={{ marginTop: 0 }}>What to copy</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
              {PART_OPTIONS.map((p) => (
                <label key={p.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: 0, fontWeight: 'normal' }}>
                  <input type="checkbox" style={{ width: 16, height: 16, marginTop: 2 }} checked={parts.has(p.key)} onChange={() => toggle(setParts, p.key)} />
                  <span><strong style={{ fontSize: 13 }}>{p.label}</strong><br /><span className="cell-sub">{p.hint}</span></span>
                </label>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 0', fontWeight: 'normal' }}>
              <input type="checkbox" style={{ width: 16, height: 16 }} checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              <span>Replace what Client B already has <span className="cell-sub">(unticked: B&apos;s existing settings are kept and skipped)</span></span>
            </label>
          </div>

          <div className="card">
            <div className="masters-row" style={{ marginBottom: 10 }}>
              <input className="masters-search" placeholder="Search tests…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, fontSize: 13, fontWeight: 500, margin: 0, whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} disabled={shown.length === 0} style={{ width: 16, height: 16 }} />
                Select all shown ({shown.length})
              </label>
              <button type="button" disabled={!canCopy} onClick={runCopy}>
                {busy === 'copy' ? 'Copying…' : `Copy ${selected.size} test(s) to Client B`}
              </button>
            </div>
            {!toId && <p className="cell-sub" style={{ marginTop: 0 }}>Pick Client B to copy to.</p>}

            {result && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13 }}>
                <strong style={{ color: '#166534' }}>Copied:</strong>{' '}
                {Object.entries(result.done).filter(([, n]) => n).map(([k, n]) => `${n} ${RESULT_LABELS[k]}`).join(', ') || 'nothing new'}
                {Object.values(result.skipped).some(Boolean) && (
                  <div className="cell-sub">
                    Kept Client B&apos;s existing: {Object.entries(result.skipped).filter(([, n]) => n).map(([k, n]) => `${n} ${RESULT_LABELS[k]}`).join(', ')}
                  </div>
                )}
              </div>
            )}

            {preview.rows.length === 0 ? (
              <p className="cell-sub">This client has no tests setup of its own to copy.</p>
            ) : (
              <div className="masters-table-wrap">
                <table className="orders-table">
                  <thead>
                    <tr>
                      <th style={{ width: 30 }} />
                      <th>Test</th>
                      <th>Own params</th>
                      <th>Range changes</th>
                      <th>Name/unit/method</th>
                      <th>Specimen / short name</th>
                      <th>Price</th>
                      {toId && <th>Client B has</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.testId}>
                        <td><input type="checkbox" style={{ width: 16, height: 16 }} checked={selected.has(r.testId)} onChange={() => toggle(setSelected, r.testId)} /></td>
                        <td data-label="Test">
                          <strong>{r.testName}</strong>
                          <div className="cell-sub">{r.testCode}{r.category ? ` · ${r.category}` : ''}{r.createdBySource ? ' · created by Client A' : ''}</div>
                        </td>
                        <td data-label="Own params">{count(r.ownParameters)}</td>
                        <td data-label="Range changes">{count(r.normalRanges)}</td>
                        <td data-label="Name/unit/method">{count(r.labels)}</td>
                        <td data-label="Specimen / short name">{[r.specimen, r.shortName].filter(Boolean).join(' / ') || <span className="cell-sub">—</span>}</td>
                        <td data-label="Price">{r.price ? `₹${Number(r.price.price).toFixed(2)}${r.price.active ? '' : ' (Inactive)'}` : <span className="cell-sub">—</span>}</td>
                        {toId && (
                          <td data-label="Client B has" className="cell-sub">
                            {[r.targetOwnParameters ? `${r.targetOwnParameters} own param(s)` : '', r.targetPriced ? 'price' : ''].filter(Boolean).join(', ') || '—'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
