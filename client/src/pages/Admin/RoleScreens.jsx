import { useEffect, useState } from 'react';
import api from '../../api/client';
import { SCREEN_CATALOG } from '../../components/Layout';

export default function RoleScreens() {
  const [roles, setRoles] = useState([]);
  const [defaults, setDefaults] = useState({});
  const [effective, setEffective] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/role-screens');
    setRoles(data.roles);
    setDefaults(data.defaults);
    setEffective(data.effective);
  }
  useEffect(() => { load(); }, []);

  function toggle(role, key) {
    setEffective((d) => {
      const current = d[role] || [];
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      return { ...d, [role]: next };
    });
  }

  async function handleSave(role) {
    setError('');
    setMessage('');
    try {
      await api.put('/role-screens', { role, screens: effective[role] || [] });
      setMessage(`Screen access for ${role} saved.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save');
    }
  }

  return (
    <div>
      <div className="card">
        <h3>Staff Screen Access</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          Choose which screens your own FRONT_OFFICE / LAB_USER / MANAGER / MASTER_MANAGER staff can see.
          You can only turn off a screen your platform plan already allows for that role — greyed-out screens
          aren't part of your plan for that role. The ADMIN role always has full access.
        </p>
        {error && <p className="error-text">{error}</p>}
        {message && <p style={{ color: '#166534' }}>{message}</p>}

        <table>
          <thead>
            <tr>
              <th>Role</th>
              {SCREEN_CATALOG.map((s) => <th key={s.key}>{s.label}</th>)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role}>
                <td><strong>{role}</strong></td>
                {SCREEN_CATALOG.map((s) => {
                  const allowed = (defaults[role] || []).includes(s.key);
                  return (
                    <td key={s.key}>
                      <input
                        type="checkbox"
                        style={{ width: 'auto' }}
                        disabled={!allowed}
                        checked={allowed && (effective[role] || []).includes(s.key)}
                        onChange={() => toggle(role, s.key)}
                        title={allowed ? '' : 'Not included in your platform plan for this role'}
                      />
                    </td>
                  );
                })}
                <td><button type="button" onClick={() => handleSave(role)}>Save</button></td>
              </tr>
            ))}
            {roles.length === 0 && <tr><td colSpan={SCREEN_CATALOG.length + 2}>Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
