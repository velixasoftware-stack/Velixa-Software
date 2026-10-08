import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client';
import ShareButton from '../../components/ShareButton';
import { ReportRemarks } from '../../components/Remarks';

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString();
}

/** A minimal inline trend line - no charting library needed for a handful of points. */
function Sparkline({ points }) {
  const nums = points.map((p) => Number(p.value)).filter((n) => Number.isFinite(n));
  if (nums.length < 2) return null;

  const w = 140, h = 36, pad = 5;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (nums.length - 1);
  const coords = nums.map((n, i) => [
    pad + i * stepX,
    h - pad - ((n - min) / range) * (h - pad * 2),
  ]);
  const lastAbnormal = points[points.length - 1].isAbnormal;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={coords.map((c) => c.join(',')).join(' ')} fill="none" stroke="#2563eb" strokeWidth="2" />
      {coords.map(([x, y], i) => (
        <circle
          key={i}
          cx={x} cy={y}
          r={i === coords.length - 1 ? 3.5 : 2.5}
          fill={i === coords.length - 1 ? (lastAbnormal ? '#dc2626' : '#16a34a') : '#94a3b8'}
        />
      ))}
    </svg>
  );
}

export default function LabReport() {
  const { billId } = useParams();
  const [report, setReport] = useState(null);
  const [trend, setTrend] = useState(null);
  const [error, setError] = useState('');
  const [includeHeader, setIncludeHeader] = useState(true);
  const [includeTrend, setIncludeTrend] = useState(true);

  useEffect(() => {
    api.get(`/report-view/bills/${billId}/report`)
      .then((r) => setReport(r.data))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load report'));
    // The AI trend report is a bonus add-on - if it fails for any reason, the
    // main report above still renders fine without it.
    api.get(`/report-view/bills/${billId}/trend`)
      .then((r) => setTrend(r.data))
      .catch(() => setTrend(null));
  }, [billId]);

  if (error) return <div className="card"><p className="error-text">{error}</p></div>;
  if (!report) return <p>Loading…</p>;

  const { patient, client, tests, doctor } = report;
  const collectedAt = tests.map((t) => t.collectedAt).filter(Boolean).sort()[0];
  const releasedAt = tests.map((t) => t.releasedAt).filter(Boolean).sort().slice(-1)[0];

  return (
    <div>
      <div className="no-print report-toolbar">
        <Link to="/app/orders">&larr; Back to Orders</Link>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 0, fontWeight: 'normal' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={includeHeader} onChange={(e) => setIncludeHeader(e.target.checked)} />
          Include letterhead/logo header
        </label>
        {trend && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 0, fontWeight: 'normal' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={includeTrend} onChange={(e) => setIncludeTrend(e.target.checked)} />
            Include AI Trend Report
          </label>
        )}
        <div className="report-toolbar-actions">
          <ShareButton apiPath={`/report-view/bills/${billId}/report/share`} />
          <button onClick={() => window.print()}>Print Report</button>
        </div>
      </div>

      <div className="report-sheet">
        {/* Always reserves the same space here, header shown or not - so a
            report printed without the digital header (onto paper that
            already has the lab's letterhead pre-printed on it) leaves that
            same blank area at the top instead of the content shifting up
            and colliding with the physical letterhead. */}
        <div className="report-header-slot">
          {includeHeader && (client.letterheadUrl ? (
            <img src={client.letterheadUrl} alt="Letterhead" className="report-letterhead" />
          ) : (
            <div className="report-header">
              {client.logoUrl && <img src={client.logoUrl} alt="Logo" className="report-logo" />}
              <div>
                <h2 style={{ margin: 0 }}>{client.clientName}</h2>
                <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
                  {[client.address, client.mobile, client.email].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
          ))}
        </div>

        <h3 style={{ marginTop: 24 }}>Laboratory Report</h3>
        <div className="report-patient-grid">
          <div><span>UMR</span><strong>{patient?.umr}</strong></div>
          <div><span>Patient Name</span><strong>{patient?.name}</strong></div>
          <div><span>Age / Gender</span><strong>{patient?.age ? `${patient.age} Yrs` : '—'} / {patient?.gender || '—'}</strong></div>
          <div><span>Order ID</span><strong>{report.bill.billNo}</strong></div>
          <div><span>Mobile</span><strong>{patient?.mobile || '—'}</strong></div>
          <div><span>Referred By</span><strong>{report.bill.referredDoctor ? `Dr. ${report.bill.referredDoctor}` : 'Self'}</strong></div>
          <div><span>Billed To</span><strong>{report.bill.payor || 'Self / Direct'}</strong></div>
          <div><span>Collected On</span><strong>{formatDateTime(collectedAt)}</strong></div>
          <div><span>Report Date</span><strong>{formatDateTime(releasedAt)}</strong></div>
        </div>

        {tests.map((t) => {
          // Parameters left empty at result entry are optional and not printed.
          const hasValue = (p) => p.value != null && p.value.toString().trim() !== '';
          const numericParams = t.parameters.filter((p) => !p.isInterpretation && hasValue(p));
          const interpretationParams = t.parameters.filter((p) => p.isInterpretation && hasValue(p));
          return (
            <div key={t.barcode} style={{ marginTop: 24 }}>
              <h4 style={{ background: '#f1f5f9', padding: '6px 10px', borderRadius: 6 }}>{t.testName}</h4>
              {numericParams.length > 0 && (
                <table>
                  <thead>
                    <tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Bio. Ref. Interval</th></tr>
                  </thead>
                  <tbody>
                    {numericParams.map((p) => (
                      <tr key={p.parameterName}>
                        <td>{p.parameterName}</td>
                        <td style={p.isAbnormal ? { color: '#b91c1c', fontWeight: 700 } : undefined}>{p.value}</td>
                        <td>{p.unit || '—'}</td>
                        <td>{p.normalRangeLow} - {p.normalRangeHigh}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {interpretationParams.map((p) => (
                <div key={p.parameterName} style={{ marginTop: 10 }}>
                  <strong>{p.parameterName}</strong>
                  <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{p.value}</p>
                </div>
              ))}
              {t.interpretation && (
                <div style={{ marginTop: 10 }}>
                  <strong>Interpretation</strong>
                  <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', color: '#475569' }}>{t.interpretation}</p>
                </div>
              )}
              <ReportRemarks text={t.remarks} />
            </div>
          );
        })}

        {trend && includeTrend && (
          <div style={{ marginTop: 28 }}>
            <h3 className="section-heading" style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, background: '#eef2ff', color: '#2563eb', padding: '3px 7px', borderRadius: 5, letterSpacing: '0.03em' }}>AI</span>
              &nbsp;AI Trend Report
            </h3>
            <p style={{ fontSize: 12, color: '#64748b', marginTop: 0, marginBottom: 4 }}>
              Automated comparison against this patient's own past results for the same parameter. Not a clinical
              diagnosis — please correlate clinically.
            </p>
            {trend.parameters.map((p) => (
              <div className="trend-row" key={`${p.testName}-${p.parameterName}`}>
                <div className="trend-row-main">
                  <strong>{p.parameterName}</strong>
                  <span style={{ color: '#94a3b8', fontSize: 12 }}> · {p.testName}</span>
                  <p style={{ margin: '4px 0 0', fontSize: 13 }}>{p.insight}</p>
                </div>
                <div className="trend-row-chart">
                  <Sparkline points={p.history} />
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    {p.history.length} recorded value{p.history.length === 1 ? '' : 's'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {doctor && (
          <div style={{ marginTop: 40, display: 'flex', justifyContent: 'flex-end', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
            <div style={{ textAlign: 'center' }}>
              {doctor.signatureUrl && (
                <img src={doctor.signatureUrl} alt="Signature" style={{ height: 50, display: 'block', margin: '0 auto 4px' }} />
              )}
              <div style={{ minWidth: 160 }}>
                <strong style={{ fontSize: 13 }}>{doctor.name}</strong>
                {doctor.designation && <div style={{ fontSize: 12, color: '#64748b' }}>{doctor.designation}</div>}
              </div>
            </div>
          </div>
        )}

        <p style={{ marginTop: 32, fontSize: 12, color: '#64748b' }}>
          This is a system-generated report. Values in <span style={{ color: '#b91c1c', fontWeight: 700 }}>red</span> are
          outside the normal reference range. Please correlate clinically.
        </p>
      </div>
    </div>
  );
}
