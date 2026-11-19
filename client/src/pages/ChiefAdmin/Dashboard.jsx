import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { Icon } from '../../components/Icons';

function StatCard({ icon, color, value, label, onClick, selected }) {
  const inner = (
    <>
      <div className={`dash-stat-icon ${color}`}><Icon name={icon} size={19} /></div>
      <div>
        <div className="dash-stat-value">{value}</div>
        <div className="dash-stat-label">{label}</div>
      </div>
    </>
  );
  if (!onClick) return <div className="dash-stat-card">{inner}</div>;
  // A clickable tile filters the client list below; the selected one is outlined.
  return (
    <button
      type="button"
      className="dash-stat-card"
      onClick={onClick}
      aria-pressed={selected}
      title={selected ? 'Showing these clients - click to show all' : `Show ${label.toLowerCase()} clients below`}
      style={{
        cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', width: '100%',
        border: selected ? '2px solid #2563eb' : '2px solid transparent',
        boxShadow: selected ? '0 0 0 3px rgba(37, 99, 235, 0.15)' : undefined,
      }}
    >
      {inner}
    </button>
  );
}

export default function Dashboard() {
  const [data, setData] = useState({ summary: {}, clients: [] });
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    // Always every client: the status tiles keep their counts while the list
    // below is filtered here by the selected tile / status dropdown.
    const { data } = await api.get('/clients', {
      params: {
        from: fromDate || undefined,
        to: toDate || undefined,
      },
    });
    setData(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, [fromDate, toDate]);

  // Clicking the selected tile again (or Total Clients) shows every client.
  const pickStatus = (status) => setStatusFilter((cur) => (cur === status ? '' : status));

  const { summary, clients } = data;
  const q = search.trim().toLowerCase();
  const filteredClients = clients.filter((c) => (!statusFilter || c.paymentStatus === statusFilter)
    && (!q || c.clientCode?.toLowerCase().includes(q) || c.clientName?.toLowerCase().includes(q)));
  const dateFiltered = Boolean(fromDate || toDate);

  return (
    <div>
      <div className="dash-header no-print">
        <div className="mark-icon"><Icon name="dashboard" size={20} /></div>
        <div>
          <h2>Dashboard</h2>
          <p>Overview of every client, their payment status, and revenue across the platform.</p>
        </div>
      </div>

      <div className="card date-filter-bar no-print">
        <div className="df-title"><Icon name="calendar" size={15} /> Filter by Date</div>
        <div className="df-controls">
          <div className="df-field"><span>From</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="df-field"><span>To</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          {dateFiltered && (
            <button type="button" className="secondary" onClick={() => { setFromDate(''); setToDate(''); }}>Clear</button>
          )}
        </div>
        <p className="df-note">
          Scopes Lab Bills/Lab Revenue/Payments Collected below to this date range. Client status counts and
          this-cycle SaaS revenue always reflect right now, regardless of the range.
        </p>
      </div>

      <p className="dash-section-label">Client Status</p>
      <div className="dash-stat-grid">
        <StatCard icon="building" color="blue" value={summary.total || 0} label="Total Clients" onClick={() => setStatusFilter('')} selected={!statusFilter} />
        <StatCard icon="team" color="green" value={summary.paid || 0} label="Paid" onClick={() => pickStatus('PAID')} selected={statusFilter === 'PAID'} />
        <StatCard icon="clock" color="amber" value={summary.pending || 0} label="Pending" onClick={() => pickStatus('PENDING')} selected={statusFilter === 'PENDING'} />
        <StatCard icon="close" color="red" value={summary.expired || 0} label="Expired" onClick={() => pickStatus('EXPIRED')} selected={statusFilter === 'EXPIRED'} />
      </div>

      <p className="dash-section-label">Revenue</p>
      <div className="dash-stat-grid">
        {/* Subscription revenue totals - not sent to MARKETING users (null), so not shown. */}
        {summary.monthlyRevenueBooked !== null && (
          <>
            <StatCard icon="invoice" color="teal" value={`₹${summary.monthlyRevenueCollected || 0}`} label="Collected this cycle" />
            <StatCard icon="invoice" color="purple" value={`₹${summary.monthlyRevenueBooked || 0}`} label="Booked this cycle" />
            <StatCard icon="percent" color="indigo" value={`₹${summary.paymentsCollected || 0}`} label={`Payments Collected${dateFiltered ? ' (range)' : ''}`} />
          </>
        )}
        <StatCard icon="reports" color="blue" value={summary.labBillCount || 0} label={`Lab Bills${dateFiltered ? ' (range)' : ' (all time)'}`} />
        <StatCard icon="lab" color="teal" value={`₹${summary.labRevenueCollected || 0}`} label={`Lab Revenue${dateFiltered ? ' (range)' : ' (all time)'}`} />
      </div>

      <div className="card">
        <div className="topbar">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="team" size={16} /> Clients</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: '100%' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by client code or name…"
              style={{ width: 240, maxWidth: '100%' }}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 180, maxWidth: '100%' }}>
              <option value="">All statuses</option>
              <option value="PAID">Paid</option>
              <option value="PENDING">Pending</option>
              <option value="EXPIRED">Expired</option>
            </select>
          </div>
        </div>
        {loading ? <p>Loading…</p> : (
          <table className="dash-table">
            <thead>
              <tr>
                <th>Client Code</th><th>Name</th><th>Mobile</th><th>Sales Person</th>
                <th>Monthly Amount</th><th>Users</th><th>Status</th><th>Active</th><th>Paid Through</th>
                <th>Payments{dateFiltered ? ' (range)' : ''}</th>
                <th>Lab Bills</th><th>Lab Revenue</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((c) => (
                <tr key={c.id}>
                  <td><span className="dash-client-code">{c.clientCode}</span></td>
                  <td>{c.clientName}</td>
                  <td>{c.mobile}</td>
                  <td>{c.salesPerson}</td>
                  <td>₹{c.monthlyAmount}</td>
                  <td>{c.userCount}</td>
                  <td><span className={`badge ${c.paymentStatus}`}>{c.paymentStatus}</span></td>
                  <td>
                    {c.active === false
                      ? <span className="badge" style={{ background: '#f1f5f9', color: '#64748b' }}>INACTIVE</span>
                      : <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>ACTIVE</span>}
                  </td>
                  <td>{c.paidThrough ? new Date(c.paidThrough).toLocaleDateString() : '—'}</td>
                  <td>₹{c.paymentsCollected}</td>
                  <td>{c.labBillCount}</td>
                  <td>₹{c.labRevenueCollected}</td>
                  <td>
                    <Link to={`/chief-admin/clients/${c.id}`} className="icon-btn" title="Edit client">
                      <Icon name="edit" size={15} />
                    </Link>
                  </td>
                </tr>
              ))}
              {filteredClients.length === 0 && <tr><td colSpan={13}>No clients found.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
