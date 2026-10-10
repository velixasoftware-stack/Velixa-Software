import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { Icon } from '../../components/Icons';

// One place for Chief Admin to switch tests off platform-wide or delete them
// with all their master data. Delete is only allowed while a test has no
// patient history - the server decides, and the popup shows why it's blocked.
export default function TestRemoval() {
  const [tests, setTests] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState(null);

  const [deleting, setDeleting] = useState(null); // { test, usage } while the delete popup is open
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function load() {
    const { data } = await api.get('/admin/masters/tests');
    setTests(data);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tests.filter((t) => {
      if (statusFilter === 'Active' && t.active === false) return false;
      if (statusFilter === 'Inactive' && t.active !== false) return false;
      return !q || `${t.testCode} ${t.testName} ${t.category || ''}`.toLowerCase().includes(q);
    });
  }, [tests, search, statusFilter]);

  const inactiveCount = tests.filter((t) => t.active === false).length;

  async function setActive(test, active) {
    if (!active && !window.confirm(`Mark "${test.testName}" Inactive?\n\nNo client will be able to bill it. Old bills and reports keep it, and you can make it Active again any time.`)) return;
    setError('');
    setMessage('');
    setBusyId(test.id);
    try {
      await api.put(`/admin/masters/tests/${test.id}`, { active });
      setMessage(`${test.testName} is now ${active ? 'Active' : 'Inactive'}.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not change the test status');
    } finally {
      setBusyId(null);
    }
  }

  async function openDelete(test) {
    setError('');
    setMessage('');
    setBusyId(test.id);
    try {
      const { data } = await api.get(`/admin/masters/tests/${test.id}/usage`);
      setDeleting({ test, usage: data });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not check where this test is used');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    const { test } = deleting;
    setDeleteBusy(true);
    try {
      await api.delete(`/admin/masters/tests/${test.id}`);
      setDeleting(null);
      setMessage(`${test.testName} (${test.testCode}) and its master data were deleted.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not delete the test');
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function inactivateInstead() {
    const { test } = deleting;
    setDeleting(null);
    await setActive(test, false);
  }

  return (
    <div>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="icon-badge" style={{ width: 40, height: 40 }}><Icon name="masters" size={20} /></span>
        <div>
          <h3 style={{ margin: 0 }}>Test Removal</h3>
          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
            Make a test inactive for all clients, or delete it with all its master data
          </p>
        </div>
      </div>

      <div className="card">
        <div className="masters-row" style={{ marginBottom: 10 }}>
          <input className="masters-search" placeholder="Search by code, name or group…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 180 }}>
            <option value="All">All tests ({tests.length})</option>
            <option value="Active">Active ({tests.length - inactiveCount})</option>
            <option value="Inactive">Inactive ({inactiveCount})</option>
          </select>
        </div>

        {error && <p className="error-text">{error}</p>}
        {message && <p style={{ color: '#166534' }}>{message}</p>}

        <div className="masters-table-wrap">
          <table className="orders-table">
            <thead><tr><th>Code</th><th>Test Name</th><th>Group</th><th>Parameters</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>{t.testCode}</td>
                  <td className="cell-main">{t.testName}</td>
                  <td>{t.category || 'Uncategorized'}</td>
                  <td>{(t.ParameterMasters || []).length}</td>
                  <td>
                    <span className={`badge ${t.active === false ? 'EXPIRED' : 'PAID'}`}>{t.active === false ? 'Inactive' : 'Active'}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button type="button" className="secondary" disabled={busyId === t.id} onClick={() => setActive(t, t.active === false)}>
                        {t.active === false ? 'Make Active' : 'Make Inactive'}
                      </button>
                      <button type="button" className="danger" disabled={busyId === t.id} onClick={() => openDelete(t)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6}>No tests found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {deleting && (
        <div className="modal-overlay" onClick={() => !deleteBusy && setDeleting(null)}>
          <div className="modal-card" style={{ textAlign: 'left', width: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2>Delete {deleting.test.testName}</h2>
            <p className="meta" style={{ marginTop: 0 }}>{deleting.test.testCode}</p>

            {deleting.usage.canDelete ? (
              <>
                <p style={{ fontSize: 14 }}>This permanently removes the test and, for every client:</p>
                <ul style={{ fontSize: 14, marginTop: 0 }}>
                  <li>{deleting.usage.parameters} parameter(s) and their normal ranges</li>
                  <li>{deleting.usage.clientPrices} client price(s)</li>
                  <li>{deleting.usage.shortNames} short name(s)</li>
                  <li>{deleting.usage.payorPrices} payor price(s)</li>
                  <li>{deleting.usage.packages} package link(s)</li>
                </ul>
                <p className="error-text" style={{ marginTop: 0 }}>This cannot be undone.</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button type="button" className="danger" disabled={deleteBusy} onClick={confirmDelete}>
                    {deleteBusy ? 'Deleting…' : 'Delete Permanently'}
                  </button>
                  <button type="button" className="secondary" disabled={deleteBusy} onClick={() => setDeleting(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <p className="error-text">{deleting.usage.blockedReason}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  {deleting.test.active !== false && (
                    <button type="button" onClick={inactivateInstead}>Make Inactive Instead</button>
                  )}
                  <button type="button" className="secondary" onClick={() => setDeleting(null)}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
