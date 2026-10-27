import { useEffect, useState } from 'react';
import api from '../../api/client';

/**
 * Chief Admin: the Patient Title list (Mr., Mrs., Baby ...) offered in every
 * client's billing screen and printed before the patient's name on bills
 * and lab reports.
 */
export default function PatientTitles() {
  const [titles, setTitles] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await api.get('/admin/masters/patient-titles');
    setTitles(data);
  }
  useEffect(() => { load(); }, []);

  async function handleAdd(e) {
    e.preventDefault();
    if (saving) return;
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const { data } = await api.post('/admin/masters/patient-titles', { name: name.trim() });
      setMessage(`"${data.name}" added - it now shows in every client's billing screen.`);
      setName('');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add title');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(t) {
    if (!window.confirm(`Delete the title "${t.name}"?\n\nPatients already saved with it keep it; it just won't be offered for new patients.`)) return;
    setError('');
    setMessage('');
    try {
      await api.delete(`/admin/masters/patient-titles/${t.id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete title');
    }
  }

  return (
    <div>
      <div className="card">
        <h3 style={{ margin: 0 }}>Patient Titles</h3>
        <p className="cell-sub" style={{ margin: '2px 0 12px' }}>
          Offered in the Title dropdown when billing a patient, for <strong>all clients</strong>, and printed
          before the patient&apos;s name on bills and lab reports (e.g. &quot;Mr. Ravi Kumar&quot;).
        </p>
        <form onSubmit={handleAdd} className="form-grid" style={{ alignItems: 'end' }}>
          <label><span>New Title</span>
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mrs." required />
          </label>
          <button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add Title'}</button>
        </form>
        {error && <p className="error-text">{error}</p>}
        {message && <p className="success-text">{message}</p>}
      </div>

      <div className="card orders-card">
        <table className="orders-table">
          <thead>
            <tr><th>#</th><th>Title</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {titles.map((t, i) => (
              <tr key={t.id}>
                <td>{i + 1}</td>
                <td><strong>{t.name}</strong></td>
                <td>
                  <div className="order-actions">
                    <button type="button" className="danger" onClick={() => handleDelete(t)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {titles.length === 0 && (
              <tr><td colSpan={3} className="cell-sub">No titles yet - add one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
