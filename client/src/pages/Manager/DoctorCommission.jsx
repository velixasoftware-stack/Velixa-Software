import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import SearchSelect from '../../components/SearchSelect';
import { downloadFile } from '../../utils/download';
import { formatDateDMY } from '../../utils/format';

/** ₹ with Indian digit grouping. */
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rateText = (r) => (!r ? '—' : r.rateType === 'FIXED' ? `₹${Number(r.rate)}` : `${Number(r.rate)}%`);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmt = (d) => formatDateDMY(new Date(`${String(d).slice(0, 10)}T00:00:00`));

/** The Monday-Sunday week containing `date`. */
function weekOf(date) {
  const d = new Date(`${date}T00:00:00`);
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: ymd(mon), to: ymd(sun) };
}
/** First to last day of month "YYYY-MM". */
function monthOf(month) {
  const [y, m] = month.split('-').map(Number);
  return { from: `${month}-01`, to: ymd(new Date(y, m, 0)) };
}

const TABS = [
  { key: 'rates', label: 'Commission Rates' },
  { key: 'generate', label: 'Generate' },
  { key: 'statements', label: 'Statements' },
];

/**
 * Referral doctor commission: set each doctor's rate (default + per test, %
 * or ₹), then generate weekly/monthly statements from the bills they referred
 * and mark them paid. The patient's bill never changes.
 */
export default function DoctorCommission() {
  const [tab, setTab] = useState('rates');
  return (
    <div>
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ margin: 0 }}>Doctor Commission</h3>
          <p className="cell-sub" style={{ margin: '2px 0 0' }}>
            Commission for referral doctors, test-wise. Patients always pay the normal price - commission is worked out after billing.
          </p>
        </div>
      </div>
      <div className="status-tabs" style={{ marginBottom: 10 }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`status-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === 'rates' && <RatesTab />}
      {tab === 'generate' && <GenerateTab onGenerated={() => setTab('statements')} />}
      {tab === 'statements' && <StatementsTab />}
    </div>
  );
}

/* ---------------- Commission Rates ---------------- */
function RatesTab() {
  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState('');
  const [data, setData] = useState(null); // { doctor, defaultRate, tests }
  const [defType, setDefType] = useState('PERCENT');
  const [defRate, setDefRate] = useState('');
  const [testRates, setTestRates] = useState({}); // testId -> { rateType, rate }
  const [search, setSearch] = useState('');
  const [onlySet, setOnlySet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadDoctors = () => api.get('/doctor-commission/doctors').then((r) => setDoctors(r.data)).catch(() => setError('Failed to load doctors'));
  useEffect(() => { loadDoctors(); }, []);

  async function pick(id) {
    setDoctorId(id);
    setData(null);
    setMessage('');
    setError('');
    if (!id) return;
    try {
      const { data: d } = await api.get(`/doctor-commission/doctors/${id}/rates`);
      setData(d);
      setDefType(d.defaultRate?.rateType || 'PERCENT');
      setDefRate(d.defaultRate ? String(d.defaultRate.rate) : '');
      setTestRates(Object.fromEntries(d.tests.filter((t) => t.rate).map((t) => [t.testId, { rateType: t.rate.rateType, rate: String(t.rate.rate) }])));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load rates');
    }
  }

  const setTest = (testId, patch) => setTestRates((prev) => {
    const cur = prev[testId] || { rateType: defType, rate: '' };
    return { ...prev, [testId]: { ...cur, ...patch } };
  });

  async function save() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const tests = Object.entries(testRates)
        .filter(([, r]) => r.rate !== '' && r.rate != null)
        .map(([testId, r]) => ({ testId: Number(testId), rateType: r.rateType, rate: Number(r.rate) }));
      const { data: d } = await api.put(`/doctor-commission/doctors/${doctorId}/rates`, {
        defaultRate: defRate !== '' ? { rateType: defType, rate: Number(defRate) } : null,
        tests,
      });
      setMessage(d.message);
      loadDoctors();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save rates');
    } finally {
      setBusy(false);
    }
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.tests || []).filter((t) => (!q || `${t.testCode} ${t.testName} ${t.category || ''}`.toLowerCase().includes(q))
      && (!onlySet || (testRates[t.testId]?.rate ?? '') !== ''));
  }, [data, search, onlySet, testRates]);

  const preview = (t) => {
    const own = testRates[t.testId];
    const r = own && own.rate !== '' ? own : (defRate !== '' ? { rateType: defType, rate: defRate } : null);
    if (!r) return '—';
    return r.rateType === 'FIXED' ? inr(r.rate) : inr((t.price * Number(r.rate)) / 100);
  };

  return (
    <div className="card">
      <div style={{ maxWidth: 460 }}>
        <span className="reset-field-label">Referral Doctor</span>
        <SearchSelect
          options={doctors.map((d) => ({ value: d.id, label: d.name, sublabel: [d.mobile, d.defaultRate ? `Default ${rateText(d.defaultRate)}` : 'No default', d.testRateCount ? `${d.testRateCount} test rate(s)` : ''].filter(Boolean).join(' · ') }))}
          value={doctorId}
          onChange={(id) => pick(id ? String(id) : '')}
          placeholder="Search doctor…"
        />
        {doctors.length === 0 && <p className="cell-sub">Doctors appear here once they've been entered as Ref. Doctor on a bill.</p>}
      </div>
      {error && <p className="error-text">{error}</p>}
      {message && <p style={{ color: '#166534' }}>{message}</p>}

      {data && (
        <>
          <div className="masters-row" style={{ marginTop: 14, alignItems: 'flex-end' }}>
            <div><span className="field-label">Default for all tests</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={defType} onChange={(e) => setDefType(e.target.value)} style={{ width: 90 }}>
                  <option value="PERCENT">%</option><option value="FIXED">₹</option>
                </select>
                <input type="number" min="0" step="0.01" value={defRate} onChange={(e) => setDefRate(e.target.value)} placeholder="e.g. 10" style={{ width: 110 }} />
              </div>
            </div>
            <input className="masters-search" placeholder="Search tests…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontWeight: 'normal', whiteSpace: 'nowrap' }}>
              <input type="checkbox" style={{ width: 16, height: 16 }} checked={onlySet} onChange={(e) => setOnlySet(e.target.checked)} />
              Only tests with their own rate
            </label>
            <button type="button" onClick={save} disabled={busy}>{busy ? 'Saving…' : `Save rates for ${data.doctor.name}`}</button>
          </div>
          <p className="cell-sub" style={{ margin: '6px 0 10px' }}>
            A test's own rate overrides the default. Leave it empty to use the default. % is of the test price after the bill&apos;s discount.
          </p>
          <div className="masters-table-wrap">
            <table className="orders-table">
              <thead><tr><th>Test</th><th style={{ textAlign: 'right' }}>Price</th><th>Own rate</th><th style={{ textAlign: 'right' }}>Commission (on full price)</th></tr></thead>
              <tbody>
                {shown.map((t) => {
                  const own = testRates[t.testId] || { rateType: defType, rate: '' };
                  return (
                    <tr key={t.testId}>
                      <td data-label="Test"><strong>{t.testName}</strong><div className="cell-sub">{t.testCode}{t.category ? ` · ${t.category}` : ''}</div></td>
                      <td data-label="Price" style={{ textAlign: 'right' }}>{inr(t.price)}</td>
                      <td data-label="Own rate">
                        <div style={{ display: 'flex', gap: 6 }}>
                          <select value={own.rateType} onChange={(e) => setTest(t.testId, { rateType: e.target.value })} style={{ width: 70 }}>
                            <option value="PERCENT">%</option><option value="FIXED">₹</option>
                          </select>
                          <input type="number" min="0" step="0.01" value={own.rate} placeholder="default" onChange={(e) => setTest(t.testId, { rate: e.target.value })} style={{ width: 100 }} />
                        </div>
                      </td>
                      <td data-label="Commission" style={{ textAlign: 'right' }}>{preview(t)}</td>
                    </tr>
                  );
                })}
                {shown.length === 0 && <tr><td colSpan={4}>No tests match.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Generate ---------------- */
function GenerateTab({ onGenerated }) {
  const today = ymd(new Date());
  const [periodType, setPeriodType] = useState('MONTH');
  const [weekDate, setWeekDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const period = periodType === 'WEEK' ? weekOf(weekDate) : monthOf(month);

  async function load() {
    setBusy('load');
    setError('');
    setRows(null);
    try {
      const { data } = await api.get('/doctor-commission/preview', { params: period });
      setRows(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load commission');
    } finally {
      setBusy('');
    }
  }
  useEffect(() => { load(); }, [period.from, period.to]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    if (!window.confirm(`Generate commission statements for ${fmt(period.from)} - ${fmt(period.to)}?\n\n${rows.length} doctor(s), total ${inr(rows.reduce((s, r) => s + r.totalCommission, 0))}.\nThese tests won't be counted again in another statement.`)) return;
    setBusy('generate');
    setError('');
    try {
      await api.post('/doctor-commission/statements', { ...period, periodType });
      onGenerated();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to generate statements');
      setBusy('');
    }
  }

  const total = (rows || []).reduce((s, r) => s + r.totalCommission, 0);
  return (
    <div className="card">
      <div className="masters-row" style={{ alignItems: 'flex-end' }}>
        <div role="radiogroup" aria-label="Period" style={{ display: 'flex', gap: 14, alignSelf: 'center' }}>
          {[['WEEK', 'Weekly'], ['MONTH', 'Monthly']].map(([v, l]) => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontWeight: 500 }}>
              <input type="radio" name="periodType" style={{ width: 'auto' }} checked={periodType === v} onChange={() => setPeriodType(v)} />{l}
            </label>
          ))}
        </div>
        {periodType === 'WEEK'
          ? <label><span>Any day in the week</span><input type="date" value={weekDate} onChange={(e) => setWeekDate(e.target.value || today)} /></label>
          : <label><span>Month</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value || today.slice(0, 7))} /></label>}
        <div className="cell-sub" style={{ alignSelf: 'center' }}>{fmt(period.from)} – {fmt(period.to)}</div>
        <button type="button" disabled={!rows || rows.length === 0 || !!busy} onClick={generate}>
          {busy === 'generate' ? 'Generating…' : 'Generate Statements'}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {busy === 'load' && <p className="cell-sub">Loading…</p>}
      {rows && rows.length === 0 && (
        <p className="cell-sub">No commission due for this period - no bills from doctors with rates, or it&apos;s all in statements already.</p>
      )}
      {rows && rows.length > 0 && (
        <div className="masters-table-wrap" style={{ marginTop: 10 }}>
          <table className="orders-table">
            <thead><tr><th>Doctor</th><th>Bills</th><th>Tests</th><th style={{ textAlign: 'right' }}>Value (after discount)</th><th style={{ textAlign: 'right' }}>Commission</th><th /></tr></thead>
            <tbody>
              {rows.map((d) => (
                <FragmentRows key={d.doctorId} d={d} open={open.has(d.doctorId)} onToggle={() => setOpen((p) => { const n = new Set(p); if (n.has(d.doctorId)) n.delete(d.doctorId); else n.add(d.doctorId); return n; })} />
              ))}
            </tbody>
            <tfoot><tr><th colSpan={4}>Total</th><th style={{ textAlign: 'right' }}>{inr(total)}</th><th /></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function FragmentRows({ d, open, onToggle }) {
  return (
    <>
      <tr>
        <td data-label="Doctor"><strong>{d.doctorName}</strong></td>
        <td data-label="Bills">{d.billCount}</td>
        <td data-label="Tests">{d.testCount}</td>
        <td data-label="Value" style={{ textAlign: 'right' }}>{inr(d.totalAmount)}</td>
        <td data-label="Commission" style={{ textAlign: 'right' }}><strong>{inr(d.totalCommission)}</strong></td>
        <td><button type="button" className="secondary" style={{ padding: '2px 10px', fontSize: 12 }} onClick={onToggle}>{open ? 'Hide tests' : 'Test-wise'}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ background: '#f8fafc' }}>
            <LinesTable lines={d.lines} />
          </td>
        </tr>
      )}
    </>
  );
}

function LinesTable({ lines }) {
  return (
    <table style={{ fontSize: 12.5 }}>
      <thead><tr><th>Bill No</th><th>Date</th><th>Patient</th><th>Test</th><th style={{ textAlign: 'right' }}>Price</th><th style={{ textAlign: 'right' }}>After discount</th><th>Rate</th><th style={{ textAlign: 'right' }}>Commission</th></tr></thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.billItemId}>
            <td>{l.billNo}</td><td>{formatDateDMY(new Date(l.billDate))}</td><td>{l.patientName}</td>
            <td>{l.testName}</td>
            <td style={{ textAlign: 'right' }}>{inr(l.price)}</td><td style={{ textAlign: 'right' }}>{inr(l.netAmount)}</td>
            <td>{rateText(l)}</td><td style={{ textAlign: 'right' }}>{inr(l.commission)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------- Statements ---------------- */
function StatementsTab() {
  const [list, setList] = useState([]);
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null); // full statement with lines
  const [pay, setPay] = useState(null); // { id, paidAt, paymentMode, paymentReference, notes }
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = () => api.get('/doctor-commission/statements', { params: status ? { status } : {} })
    .then((r) => setList(r.data)).catch(() => setError('Failed to load statements'));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(id) {
    setError('');
    try { setView((await api.get(`/doctor-commission/statements/${id}`)).data); } catch (err) { setError(err.response?.data?.message || 'Failed to open statement'); }
  }
  async function savePay(e) {
    e.preventDefault();
    setError('');
    try {
      await api.put(`/doctor-commission/statements/${pay.id}/pay`, pay);
      setMessage('Marked as paid.');
      setPay(null);
      setView(null);
      load();
    } catch (err) { setError(err.response?.data?.message || 'Failed to mark paid'); }
  }
  async function cancel(s) {
    if (!window.confirm(`Cancel ${s.statementNo} (${s.doctorName}, ${inr(s.totalCommission)})?\nIts tests become available to generate again.`)) return;
    try {
      const { data } = await api.delete(`/doctor-commission/statements/${s.id}`);
      setMessage(data.message);
      setView(null);
      load();
    } catch (err) { setError(err.response?.data?.message || 'Failed to cancel'); }
  }

  const due = list.filter((s) => s.status === 'GENERATED').reduce((t, s) => t + Number(s.totalCommission), 0);
  return (
    <div className="card">
      <div className="masters-row">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 180 }}>
          <option value="">All statements</option><option value="GENERATED">Unpaid</option><option value="PAID">Paid</option>
        </select>
        <span className="cell-sub" style={{ alignSelf: 'center' }}>Unpaid shown: <strong>{inr(due)}</strong></span>
      </div>
      {error && <p className="error-text">{error}</p>}
      {message && <p style={{ color: '#166534' }}>{message}</p>}
      <div className="masters-table-wrap">
        <table className="orders-table">
          <thead><tr><th>No</th><th>Doctor</th><th>Period</th><th>Tests</th><th style={{ textAlign: 'right' }}>Commission</th><th>Status</th><th /></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td data-label="No">{s.statementNo}</td>
                <td data-label="Doctor"><strong>{s.doctorName}</strong></td>
                <td data-label="Period">{s.periodType === 'WEEK' ? 'Week' : 'Month'}: {fmt(s.fromDate)} – {fmt(s.toDate)}</td>
                <td data-label="Tests">{s.testCount} <span className="cell-sub">({s.billCount} bills)</span></td>
                <td data-label="Commission" style={{ textAlign: 'right' }}><strong>{inr(s.totalCommission)}</strong></td>
                <td data-label="Status">
                  {s.status === 'PAID'
                    ? <span className="badge PAID">PAID</span>
                    : <span className="badge PENDING">UNPAID</span>}
                  {s.status === 'PAID' && <div className="cell-sub">{fmt(s.paidAt)} · {s.paymentMode}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="secondary" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => open(s.id)}>View</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={7}>No statements yet - create them on the Generate tab.</td></tr>}
          </tbody>
        </table>
      </div>

      {view && (
        <div className="modal-backdrop" onClick={() => setView(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 300, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
          <div className="card commission-statement" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, width: '100%', marginTop: 30 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h3 style={{ margin: 0 }}>Commission Statement {view.statementNo}</h3>
                <div><strong>{view.doctorName}</strong></div>
                <div className="cell-sub">{view.periodType === 'WEEK' ? 'Week' : 'Month'}: {fmt(view.fromDate)} – {fmt(view.toDate)} · {view.billCount} bills · {view.testCount} tests</div>
                <div className="cell-sub">{view.status === 'PAID' ? `Paid ${fmt(view.paidAt)} by ${view.paymentMode}${view.paymentReference ? ` (${view.paymentReference})` : ''}` : 'Unpaid'}</div>
              </div>
              <div className="no-print" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {view.status !== 'PAID' && <button type="button" onClick={() => setPay({ id: view.id, paidAt: ymd(new Date()), paymentMode: 'CASH', paymentReference: '', notes: '' })}>Mark Paid</button>}
                <button type="button" className="secondary" onClick={() => window.print()}>Print</button>
                <button type="button" className="secondary" onClick={() => downloadFile(`/doctor-commission/statements/${view.id}?format=xlsx`, `${view.statementNo}.xlsx`)}>Excel</button>
                {view.status !== 'PAID' && <button type="button" className="danger" onClick={() => cancel(view)}>Cancel</button>}
                <button type="button" className="secondary" onClick={() => setView(null)}>Close</button>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <LinesTable lines={view.CommissionStatementLines || []} />
            </div>
            <div style={{ textAlign: 'right', marginTop: 8, fontSize: 15 }}>
              Total commission: <strong>{inr(view.totalCommission)}</strong>
              <div className="cell-sub">on tests worth {inr(view.totalAmount)} after discount</div>
            </div>

            {pay && (
              <form onSubmit={savePay} className="no-print" style={{ marginTop: 12, padding: 12, background: '#f8fafc', borderRadius: 8, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label><span>Paid on</span><input type="date" value={pay.paidAt} onChange={(e) => setPay({ ...pay, paidAt: e.target.value })} required /></label>
                <label><span>Mode</span>
                  <select value={pay.paymentMode} onChange={(e) => setPay({ ...pay, paymentMode: e.target.value })}>
                    {['CASH', 'UPI', 'BANK TRANSFER', 'CHEQUE'].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label><span>Reference</span><input value={pay.paymentReference} onChange={(e) => setPay({ ...pay, paymentReference: e.target.value })} placeholder="UTR / cheque no." /></label>
                <button type="submit">Confirm Paid</button>
                <button type="button" className="secondary" onClick={() => setPay(null)}>Back</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
