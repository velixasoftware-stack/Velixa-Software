import { useEffect, useState } from 'react';
import api from '../../api/client';
import { downloadFile } from '../../utils/download';
import { Icon } from '../../components/Icons';

/** A minimal inline bar chart - no charting library needed for a handful of bars. */
function BarChart({ data, valueKey, labelKey }) {
  if (data.length === 0) return <p style={{ color: '#94a3b8', fontSize: 13 }}>No data for this period.</p>;

  const w = 640, h = 200, pad = 28, gap = 10;
  const max = Math.max(...data.map((d) => Number(d[valueKey])), 1);
  const barW = Math.max(8, (w - pad * 2 - gap * (data.length - 1)) / data.length);

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMinYMid meet">
      <line x1={pad} y1={h - pad} x2={w - 4} y2={h - pad} stroke="#e2e8f0" strokeWidth="1" />
      {data.map((d, i) => {
        const value = Number(d[valueKey]);
        const barH = ((h - pad * 2) * value) / max;
        const x = pad + i * (barW + gap);
        const y = h - pad - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx="3" fill="#2563eb" />
            <text x={x + barW / 2} y={h - pad + 14} fontSize="9" fill="#64748b" textAnchor="middle">
              {String(d[labelKey]).slice(5)}
            </text>
            <text x={x + barW / 2} y={y - 4} fontSize="9" fill="#334155" textAnchor="middle">
              {value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Reports() {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [collection, setCollection] = useState(null);
  const [outstanding, setOutstanding] = useState([]);
  const [labSummary, setLabSummary] = useState(null);
  const [testRevenue, setTestRevenue] = useState([]);
  const [reportStatus, setReportStatus] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [groupBy, setGroupBy] = useState('day');
  const [labDetails, setLabDetails] = useState([]);

  const dateParams = { from: fromDate || undefined, to: toDate || undefined };

  useEffect(() => {
    api.get('/reports/collection-summary', { params: dateParams }).then((r) => setCollection(r.data));
    api.get('/reports/outstanding', { params: dateParams }).then((r) => setOutstanding(r.data));
    api.get('/reports/lab-summary', { params: dateParams }).then((r) => setLabSummary(r.data));
    api.get('/reports/test-wise-revenue', { params: dateParams }).then((r) => setTestRevenue(r.data));
    api.get('/reports/report-status', { params: dateParams }).then((r) => setReportStatus(r.data));
    api.get('/reports/lab-details', { params: dateParams }).then((r) => setLabDetails(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  useEffect(() => {
    api.get('/reports/transactions', { params: { ...dateParams, groupBy } }).then((r) => setTransactions(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, groupBy]);

  function exportUrl() {
    // URLSearchParams stringifies `undefined` as the literal text "undefined"
    // (unlike axios's `params`, which drops it) - only add a param when it's
    // actually set, or the date filter breaks server-side.
    const entries = { ...dateParams, groupBy };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(entries)) {
      if (value) params.set(key, value);
    }
    return `/reports/export?${params.toString()}`;
  }

  return (
    <div>
      <div className="card date-filter-bar no-print">
        <div className="df-title"><Icon name="calendar" size={15} /> Filter by Date</div>
        <div className="df-controls">
          <div className="df-field"><span>From</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="df-field"><span>To</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          {(fromDate || toDate) && (
            <button type="button" className="secondary" onClick={() => { setFromDate(''); setToDate(''); }}>Clear</button>
          )}
          <button type="button" className="secondary" onClick={() => downloadFile(exportUrl(), 'reports-export.xlsx')}>
            Export to Excel
          </button>
          <button type="button" onClick={() => window.print()}>Print / Save as PDF</button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-tile"><div className="value">{collection?.billCount ?? '—'}</div><div className="label">Bills</div></div>
        <div className="stat-tile"><div className="value">₹{collection?.totalBilled ?? 0}</div><div className="label">Total Billed</div></div>
        <div className="stat-tile"><div className="value">₹{collection?.totalCollected ?? 0}</div><div className="label">Total Collected</div></div>
        <div className="stat-tile"><div className="value">₹{collection?.totalRefunded ?? 0}</div><div className="label">Cancelled / Refunded</div></div>
        <div className="stat-tile"><div className="value">₹{collection?.totalPostDiscount ?? 0}</div><div className="label">Post-Billing Discount</div></div>
        <div className="stat-tile"><div className="value">₹{collection?.outstanding ?? 0}</div><div className="label">Outstanding</div></div>
      </div>

      <div className="card">
        <div className="topbar">
          <h3 style={{ margin: 0 }}>Transactions</h3>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} style={{ width: 160 }} className="no-print">
            <option value="day">Day-wise</option>
            <option value="month">Month-wise</option>
          </select>
        </div>
        <BarChart data={transactions} valueKey="totalAmount" labelKey="period" />
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Period</th><th>Bill Count</th><th>Total Amount</th></tr></thead>
          <tbody>
            {transactions.map((t) => <tr key={t.period}><td>{t.period}</td><td>{t.billCount}</td><td>₹{t.totalAmount}</td></tr>)}
            {transactions.length === 0 && <tr><td colSpan={3}>No transactions.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Lab Summary</h3>
        <div className="stat-row">
          {labSummary && Object.entries(labSummary.byStatus).map(([status, count]) => (
            <div className="stat-tile" key={status}><div className="value">{count}</div><div className="label">{status}</div></div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Report Status (Pending / Verified / Released)</h3>
        <div className="stat-row">
          <div className="stat-tile"><div className="value">{reportStatus?.PENDING ?? 0}</div><div className="label">Pending</div></div>
          <div className="stat-tile"><div className="value">{reportStatus?.VERIFIED ?? 0}</div><div className="label">Verified</div></div>
          <div className="stat-tile"><div className="value">{reportStatus?.RELEASED ?? 0}</div><div className="label">Released</div></div>
        </div>
      </div>

      <div className="card">
        <h3>Test-wise Counts & Revenue</h3>
        <table>
          <thead><tr><th>Test Code</th><th>Test Name</th><th>Count</th><th>Revenue</th></tr></thead>
          <tbody>
            {testRevenue.map((t) => <tr key={t.testCode}><td>{t.testCode}</td><td>{t.testName}</td><td>{t.count}</td><td>₹{t.revenue}</td></tr>)}
            {testRevenue.length === 0 && <tr><td colSpan={4}>No data.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Outstanding Amounts</h3>
        <table>
          <thead><tr><th>Bill No</th><th>Patient</th><th>Total</th><th>Paid</th><th>Refunded</th><th>Post-Billing Discount</th><th>Outstanding</th></tr></thead>
          <tbody>
            {outstanding.map((o) => (
              <tr key={o.billNo}>
                <td>{o.billNo}</td><td>{o.patient}</td><td>₹{o.totalAmount}</td><td>₹{o.paidAmount}</td>
                <td>₹{o.refundedAmount || 0}</td><td>₹{o.postDiscountAmount || 0}</td><td>₹{o.outstanding}</td>
              </tr>
            ))}
            {outstanding.length === 0 && <tr><td colSpan={7}>No outstanding bills.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Lab Details (Samples)</h3>
        <table>
          <thead><tr><th>Barcode</th><th>Test Code</th><th>Test Name</th><th>Sample Status</th><th>Report Status</th><th>Collected At</th></tr></thead>
          <tbody>
            {labDetails.map((d) => (
              <tr key={d.barcode}>
                <td>{d.barcode}</td><td>{d.testCode}</td><td>{d.testName}</td>
                <td>{d.status}</td><td>{d.reportStatus || '—'}</td>
                <td>{d.collectedAt ? new Date(d.collectedAt).toLocaleString() : '—'}</td>
              </tr>
            ))}
            {labDetails.length === 0 && <tr><td colSpan={6}>No samples.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
