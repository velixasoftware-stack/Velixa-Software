import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import SearchSelect from '../../components/SearchSelect';
import { formatDateDMY } from '../../utils/format';

/**
 * Chief Admin: a client's removed parameters, with Restore. Client users can
 * remove parameters from their tests but only Chief Admin can bring them back.
 */
export default function RemovedParameters() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get('/clients').then((r) => setClients(r.data.clients || [])).catch(() => setError('Failed to load clients'));
  }, []);

  async function load(id = clientId) {
    setError('');
    if (!id) { setData(null); return; }
    setLoading(true);
    try {
      const { data: d } = await api.get('/admin/removed-parameters', { params: { clientId: id } });
      setData(d);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load removed parameters');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const rowKey = (r) => `${r.kind}-${r.testId}-${r.parameterId}`;

  async function restore(r) {
    if (!window.confirm(`Restore "${r.parameterName}" on ${r.testName} for ${data.client.clientCode}?`)) return;
    setBusyKey(rowKey(r));
    setError('');
    setMessage('');
    try {
      await api.post('/admin/removed-parameters/restore', { clientId: Number(clientId), kind: r.kind, testId: r.testId, parameterId: r.parameterId });
      setMessage(`${r.parameterName} restored on ${r.testName}.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not restore the parameter');
    } finally {
      setBusyKey('');
    }
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows || []).filter((r) => !q || `${r.testCode} ${r.testName} ${r.parameterName}`.toLowerCase().includes(q));
  }, [data, search]);

  return (
    <div>
      <div className="card">
        <h3 style={{ margin: 0 }}>Removed Parameters</h3>
        <p className="cell-sub" style={{ margin: '2px 0 12px' }}>
          Parameters a client removed from its tests. Only Chief Admin can restore them - client users can&apos;t.
        </p>
        <div style={{ maxWidth: 420 }}>
          <span className="reset-field-label">Client</span>
          <SearchSelect
            options={clients.map((c) => ({ value: c.id, label: `${c.clientCode} — ${c.clientName}`, sublabel: [c.mobile, c.email].filter(Boolean).join(' · ') }))}
            value={clientId}
            onChange={(id) => { const v = id ? String(id) : ''; setClientId(v); setMessage(''); load(v); }}
            placeholder="Search by client code, name, mobile…"
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        {message && <p style={{ color: '#166534' }}>{message}</p>}
      </div>

      {loading && <div className="card"><p className="cell-sub">Loading…</p></div>}

      {data && !loading && (
        <div className="card">
          <div className="masters-row" style={{ marginBottom: 10 }}>
            <input className="masters-search" placeholder="Search by test or parameter…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {data.rows.length === 0 ? (
            <p className="cell-sub">{data.client.clientCode} has no removed parameters.</p>
          ) : (
            <div className="masters-table-wrap">
              <table className="orders-table">
                <thead>
                  <tr><th>Test</th><th>Parameter</th><th>Type</th><th>Removed by</th><th /></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={rowKey(r)}>
                      <td data-label="Test"><strong>{r.testName}</strong><div className="cell-sub">{r.testCode}</div></td>
                      <td data-label="Parameter">{r.parameterName}{r.unit ? <span className="cell-sub"> · {r.unit}</span> : null}</td>
                      <td data-label="Type">{r.kind === 'hidden' ? 'Chief Admin parameter' : 'Client\'s own parameter'}</td>
                      <td data-label="Removed by" className="cell-sub">
                        {r.removedBy || '—'}{r.removedAt ? ` · ${formatDateDMY(new Date(r.removedAt))}` : ''}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" className="secondary" disabled={!!busyKey} onClick={() => restore(r)}>
                          {busyKey === rowKey(r) ? 'Restoring…' : 'Restore'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
