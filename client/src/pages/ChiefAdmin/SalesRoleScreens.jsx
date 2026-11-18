import { useEffect, useState } from 'react';
import api from '../../api/client';

// The Chief Admin screens ADMIN can give a sales role (keys match the server).
export const SALES_SCREENS = [
  { key: 'create-client', label: 'Create Client', hint: 'Onboard new clients - always assigned to themselves' },
  { key: 'masters', label: 'Test Master', hint: 'Shared tests and parameters - changes apply to every client' },
  { key: 'patient-titles', label: 'Patient Titles', hint: "Mr./Mrs./... offered in every client's billing" },
  { key: 'test-removal', label: 'Test Removal', hint: 'Make tests inactive or delete them - for every client' },
  { key: 'client-setup-copy', label: 'Copy Client Setup', hint: 'Only between their own clients' },
  { key: 'removed-parameters', label: 'Removed Parameters', hint: 'Restore removed parameters - their own clients' },
  { key: 'data-reset', label: 'Client Data Reset', hint: "Delete a client's data - their own clients only" },
  { key: 'team-view', label: 'Team (view only)', hint: 'See the Chief Admin team list - cannot change it' },
  { key: 'team-passwords', label: 'Reset Passwords', hint: "Reset passwords of their own clients' users" },
  { key: 'tickets', label: 'Tickets', hint: 'Tickets from their own clients' },
  { key: 'integrations', label: 'Integrations', hint: 'Email / WhatsApp settings and templates - platform-wide' },
  { key: 'sales-dashboard', label: 'Sales Dashboard', hint: "Their own clients' sales figures" },
  { key: 'role-screen-defaults', label: 'Role Screen Defaults', hint: 'Default screens of client roles - platform-wide' },
  { key: 'announcements', label: 'Login Captions', hint: 'Captions on the login page - platform-wide' },
];

const SALES_ROLES = [
  { role: 'MARKETING', label: 'Marketing' },
  { role: 'MARKETING_LEAD', label: 'Marketing Lead' },
];

/**
 * Chief Admin (ADMIN): which Chief Admin screens the Marketing and Marketing
 * Lead roles get. Both always have the Dashboard and see only the clients
 * assigned to them; setup and money screens stay Admin-only.
 */
export default function SalesRoleScreens() {
  const [screens, setScreens] = useState(null); // { MARKETING: [...], MARKETING_LEAD: [...] }
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get('/chief-admin-role-screens')
      .then(({ data }) => { setScreens(data.roles); setSaved(data.roles); })
      .catch((err) => setError(err.response?.data?.message || 'Failed to load role screens'));
  }, []);

  function toggle(role, key) {
    setMessage('');
    setScreens((prev) => {
      const list = prev[role] || [];
      return { ...prev, [role]: list.includes(key) ? list.filter((k) => k !== key) : [...list, key] };
    });
  }

  const changed = (role) => JSON.stringify([...(screens?.[role] || [])].sort()) !== JSON.stringify([...(saved?.[role] || [])].sort());

  async function save(role, label) {
    setBusy(role);
    setError('');
    setMessage('');
    try {
      const { data } = await api.put(`/chief-admin-role-screens/${role}`, { screens: screens[role] });
      setSaved((prev) => ({ ...prev, [role]: data.screens }));
      setMessage(`${label} screens saved. Users with this role see the change the next time they open a page.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save');
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      <div className="card">
        <h3 style={{ margin: 0 }}>Sales Role Screens</h3>
        <p className="cell-sub" style={{ margin: '2px 0 0' }}>
          Choose which Chief Admin screens the <strong>Marketing</strong> and <strong>Marketing Lead</strong> roles get. Both always
          have the Dashboard and only ever see the clients assigned to them; client screens (Data Reset, Copy Setup, Removed
          Parameters …) cover only their own clients. Screens marked "platform-wide" change things for every client. Team
          management and this page stay Admin-only. Assign the roles to people on the Team screen.
        </p>
        {error && <p className="error-text">{error}</p>}
        {message && <p style={{ color: '#166534' }}>{message}</p>}
      </div>

      {!screens && !error && <div className="card"><p className="cell-sub">Loading…</p></div>}

      {screens && (
        <div className="card">
          <div className="masters-table-wrap">
            <table className="orders-table">
              <thead>
                <tr>
                  <th>Screen</th>
                  {SALES_ROLES.map((r) => <th key={r.role} style={{ textAlign: 'center' }}>{r.label}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-label="Screen"><strong>Dashboard</strong><div className="cell-sub">Their own clients - always on</div></td>
                  {SALES_ROLES.map((r) => (
                    <td key={r.role} data-label={r.label} style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked disabled style={{ width: 18, height: 18 }} />
                    </td>
                  ))}
                </tr>
                {SALES_SCREENS.map((s) => (
                  <tr key={s.key}>
                    <td data-label="Screen"><strong>{s.label}</strong><div className="cell-sub">{s.hint}</div></td>
                    {SALES_ROLES.map((r) => (
                      <td key={r.role} data-label={r.label} style={{ textAlign: 'center' }}>
                        <input type="checkbox" style={{ width: 18, height: 18 }} aria-label={`${s.label} for ${r.label}`}
                          checked={(screens[r.role] || []).includes(s.key)} onChange={() => toggle(r.role, s.key)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  {SALES_ROLES.map((r) => (
                    <td key={r.role} style={{ textAlign: 'center' }}>
                      <button type="button" disabled={!changed(r.role) || !!busy} onClick={() => save(r.role, r.label)}>
                        {busy === r.role ? 'Saving…' : `Save ${r.label}`}
                      </button>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
