import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { Icon } from '../../components/Icons';
import ReviewResults from './ReviewResults';
import { StatusLegend, StatusPill, TestStatusSummary, TestStatusList } from '../../components/TestStatus';

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const RESULT_ENTRY_STATUSES = ['COLLECTED', 'RESULT_ENTERED', 'VERIFIED'];

const CARD_ACTION_LABEL = {
  collect: 'Collect',
  review: 'Enter Results',
  release: 'Release Report',
  report: 'View Report',
};

// The card view's single bulk action button - derived from the earliest
// pending stage present among a bill's (currently visible) tests, so a mixed
// group always surfaces its next actionable step.
function cardActionFor(group) {
  const statuses = new Set(group.samples.map((s) => s.status));
  if (statuses.has('PENDING_COLLECTION')) return 'collect';
  if (statuses.has('COLLECTED') || statuses.has('RESULT_ENTERED')) return 'review';
  if (statuses.has('VERIFIED')) return 'release';
  return 'report';
}

function labTag(sampleId) {
  return `#LAB${String(sampleId).padStart(5, '0')}`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function formatAge(age, ageUnit) {
  if (age == null || age === '') return '';
  if (ageUnit === 'Months') return `${age}mo`;
  if (ageUnit === 'Days') return `${age}d`;
  return `${age}y`;
}

// The post-billing flow, top to bottom: a sample is collected, its results are
// entered and verified, then its report is released. Each tab is a bucket of
// one or more Sample statuses - "Result Entry" covers both COLLECTED (not yet
// entered) and RESULT_ENTERED (entered, not yet verified). "Report Release"
// is VERIFIED only (ready to release, action still needed) and "Completed" is
// RELEASED only (already released) - kept as separate steps so a finished
// report doesn't sit mixed in with ones still awaiting release. "All" shows
// every status, including CANCELLED.
const STATUS_TABS = [
  { key: '', label: 'All', statuses: null },
  { key: 'SAMPLE_COLLECTION', label: 'Sample Collection', statuses: ['PENDING_COLLECTION'] },
  { key: 'RESULT_ENTRY', label: 'Result Entry', statuses: ['COLLECTED', 'RESULT_ENTERED'] },
  { key: 'REPORT_RELEASE', label: 'Report Release', statuses: ['VERIFIED'] },
  { key: 'COMPLETED', label: 'Completed', statuses: ['RELEASED'] },
];
const TAB_STATUSES = Object.fromEntries(STATUS_TABS.filter((t) => t.statuses).map((t) => [t.key, t.statuses]));

function groupByBill(samples) {
  const groups = new Map();
  for (const s of samples) {
    const bill = s.BillItem?.Bill;
    if (!bill) continue;
    if (!groups.has(bill.id)) {
      groups.set(bill.id, { billId: bill.id, billNo: bill.billNo, bill, patient: bill.Patient, samples: [] });
    }
    groups.get(bill.id).samples.push(s);
  }
  return [...groups.values()].sort((a, b) => b.billId - a.billId);
}

function matchesSearch(sample, q) {
  if (!q) return true;
  const bill = sample.BillItem?.Bill;
  const haystack = [
    bill?.Patient?.name, bill?.Patient?.umr, labTag(sample.id), sample.barcode,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(q.toLowerCase());
}

export default function Laboratory() {
  const navigate = useNavigate();
  const [samples, setSamples] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState(() => daysAgoISO(3));
  const [toDate, setToDate] = useState(() => todayISO());
  const [viewMode, setViewMode] = useState('cards'); // cards | list
  const [expandedCards, setExpandedCards] = useState(() => new Set()); // billIds whose per-test status list is open
  const [reviewGroup, setReviewGroup] = useState(null); // bill group open in the full-screen Review Results panel
  const [reviewFocusId, setReviewFocusId] = useState(null); // which test within it starts focused
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(''); // e.g. which tests a Review Results save couldn't verify
  const [busy, setBusy] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(null); // samples[] pending a release confirmation, or null
  const [revokeFor, setRevokeFor] = useState(null); // sample being revoked, or null
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeError, setRevokeError] = useState('');
  const [revokeSaving, setRevokeSaving] = useState(false);

  // Always loaded unfiltered - the status tabs below filter client-side so the
  // counts strip (Total/Pending/Done/Cancelled) can keep reflecting every
  // sample regardless of which tab is currently selected.
  async function load() {
    const { data } = await api.get('/lab/samples');
    setSamples(data);
  }
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const total = samples.length;
    const cancelled = samples.filter((s) => s.status === 'CANCELLED').length;
    const done = samples.filter((s) => s.status === 'RELEASED').length;
    return { total, cancelled, done, pending: total - done - cancelled };
  }, [samples]);

  // Newest-first, filtered by status tab, the search box, and the walk-in
  // date range - shared by both the flat List view and the grouped Cards
  // view below. The date range only narrows down RELEASED (and CANCELLED)
  // samples - anything still outstanding (not yet collected/entered/
  // verified/released) always shows regardless of date, so a sample that's
  // been sitting pending for longer than the default window never silently
  // drops off the queue.
  const visibleSamples = useMemo(() => {
    const q = search.trim();
    const bucket = TAB_STATUSES[statusFilter];
    const list = samples.filter((s) => {
      const isOutstanding = !['RELEASED', 'CANCELLED'].includes(s.status);
      const walkInDate = s.BillItem?.Bill?.walkInDate;
      const matchesFrom = isOutstanding || !fromDate || !walkInDate || walkInDate >= fromDate;
      const matchesTo = isOutstanding || !toDate || !walkInDate || walkInDate <= toDate;
      return (!bucket || bucket.includes(s.status)) && matchesSearch(s, q) && matchesFrom && matchesTo;
    });
    return [...list].sort((a, b) => b.id - a.id);
  }, [samples, statusFilter, search, fromDate, toDate]);

  const visibleGroups = useMemo(() => groupByBill(visibleSamples), [visibleSamples]);

  // Per-tab sample counts under the current search and date range (ignoring
  // the tab itself), shown as a number on each status tab.
  const tabCounts = useMemo(() => {
    const q = search.trim();
    const inRange = samples.filter((s) => {
      const isOutstanding = !['RELEASED', 'CANCELLED'].includes(s.status);
      const walkInDate = s.BillItem?.Bill?.walkInDate;
      return matchesSearch(s, q)
        && (isOutstanding || !fromDate || !walkInDate || walkInDate >= fromDate)
        && (isOutstanding || !toDate || !walkInDate || walkInDate <= toDate);
    });
    return Object.fromEntries(STATUS_TABS.map((t) => [
      t.key, t.statuses ? inRange.filter((s) => t.statuses.includes(s.status)).length : inRange.length,
    ]));
  }, [samples, search, fromDate, toDate]);

  function toggleCard(billId) {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(billId)) next.delete(billId); else next.add(billId);
      return next;
    });
  }

  // Looked up when opening Review Results, so it always carries every test on that
  // bill (not just the ones visible under the current tab) - unfiltered, unlike above.
  const billGroupsById = useMemo(() => {
    const map = new Map();
    for (const g of groupByBill(samples)) map.set(g.billId, g);
    return map;
  }, [samples]);

  async function doAction(sample, action) {
    await api.post(`/lab/samples/${sample.id}/${action}`);
  }

  async function runAction(fn) {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  // Results entry AND verify both open the same Review Results screen - "enter
  // a value" and "confirm a value" are really the same review, just at a
  // different point, so one screen (checkbox-select which tests, edit inline,
  // then Save/Mark Reviewed) covers both instead of two different modals.
  function openReview(group, focusSampleId = null) {
    setReviewGroup(group);
    setReviewFocusId(focusSampleId);
  }

  function runCardAction(group) {
    const kind = cardActionFor(group);
    if (kind === 'collect') {
      const toCollect = group.samples.filter((s) => s.status === 'PENDING_COLLECTION');
      runAction(() => Promise.all(toCollect.map((s) => doAction(s, 'collect'))));
    } else if (kind === 'release') {
      // Only the still-VERIFIED tests need releasing - an already-RELEASED one
      // in the same bucket (Report Release covers both) would 400 if re-sent.
      const toRelease = group.samples.filter((s) => s.status === 'VERIFIED');
      setConfirmRelease(toRelease);
    } else if (kind === 'report') {
      navigate(`/app/report/${group.billId}`);
    } else {
      openReview(billGroupsById.get(group.billId) || group);
    }
  }

  function handleConfirmRelease() {
    const toRelease = confirmRelease;
    setConfirmRelease(null);
    runAction(() => Promise.all(toRelease.map((s) => doAction(s, 'release'))));
  }

  function openRevoke(sample) {
    setRevokeFor(sample);
    setRevokeReason('');
    setRevokeError('');
  }

  async function handleRevoke(e) {
    e.preventDefault();
    if (revokeSaving) return; // guard against a rapid double-submit
    setRevokeError('');
    setRevokeSaving(true);
    try {
      await api.put(`/lab/samples/${revokeFor.id}/revoke`, { reason: revokeReason });
      setRevokeFor(null);
      await load();
    } catch (err) {
      setRevokeError(err.response?.data?.message || 'Failed to revoke report');
    } finally {
      setRevokeSaving(false);
    }
  }

  return (
    <div>
      <div className="topbar compact-header">
        <h3 className="section-heading" style={{ margin: 0 }}>
          <span className="icon-badge"><Icon name="lab" size={15} /></span> Patients
        </h3>
        <div className="status-summary">
          <div className="stat-chip"><span className="stat-value">{counts.total}</span><span className="stat-label">Total</span></div>
          <div className="stat-chip pending"><span className="stat-value">{counts.pending}</span><span className="stat-label">Pending</span></div>
          <div className="stat-chip done"><span className="stat-value">{counts.done}</span><span className="stat-label">Done</span></div>
          <div className="stat-chip cancelled"><span className="stat-value">{counts.cancelled}</span><span className="stat-label">Cancel</span></div>
        </div>
        <div className="compact-filters">
          <div className="df-field"><span>From</span><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div className="df-field"><span>To</span><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          {(fromDate || toDate) && (
            <button type="button" className="secondary" onClick={() => { setFromDate(''); setToDate(''); }}>
              Clear
            </button>
          )}
          <input
            placeholder="Search patient, UMR or sample…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
            <option value="cards">Cards</option>
            <option value="list">List</option>
          </select>
        </div>
      </div>

      <div className="status-tabs compact" style={{ marginBottom: 8 }}>
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`status-tab ${statusFilter === t.key ? 'active' : ''}`}
            onClick={() => setStatusFilter(t.key)}
          >
            {t.label}<span className="tab-count">{tabCounts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>
      <StatusLegend />
      {error && <p className="error-text">{error}</p>}
      {notice && (
        <div className="lab-notice" role="status">
          <span>⚠ {notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice('')}>×</button>
        </div>
      )}

      {viewMode === 'list' && (
        <div className="card orders-card">
          <table className="orders-table lab-list-table">
            <thead>
              <tr><th>Sample</th><th>Patient</th><th>Test</th><th>Status</th><th>Last updated</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {visibleSamples.map((s) => {
                const bill = s.BillItem?.Bill;
                const group = bill ? billGroupsById.get(bill.id) : null;
                return (
                  <tr key={s.id}>
                    <td><span className="lab-row-id">{labTag(s.id)}</span></td>
                    <td>
                      <div className="cell-main">{bill?.Patient?.name}</div>
                      <div className="cell-sub">{bill?.Patient?.umr}</div>
                    </td>
                    <td>{s.BillItem?.TestMaster?.testName}</td>
                    <td>
                      <StatusPill status={s.status} />
                      {s.status === 'VERIFIED' && s.Report?.status === 'REVOKED' && (
                        <div className="revoked-note" title={s.Report.revokedReason}>Previously revoked</div>
                      )}
                    </td>
                    <td>
                      <div className="cell-sub">{formatDateTime(s.updatedAt)}</div>
                      {s.updatedBy && <div className="cell-sub">by {s.updatedBy}</div>}
                    </td>
                    <td>
                      <div className="row-actions">
                        {s.status === 'PENDING_COLLECTION' && <button onClick={() => runAction(() => doAction(s, 'collect'))} disabled={busy}>Collect</button>}
                        {RESULT_ENTRY_STATUSES.includes(s.status) && (
                          <button onClick={() => openReview(group, s.id)} disabled={busy}>
                            {s.status === 'RESULT_ENTERED' ? 'Verify' : s.status === 'VERIFIED' ? 'Edit' : 'Results'}
                          </button>
                        )}
                        {s.status === 'VERIFIED' && (
                          <button onClick={() => setConfirmRelease([s])} disabled={busy}>
                            {s.Report?.status === 'REVOKED' ? 'Release Again' : 'Release'}
                          </button>
                        )}
                        {s.status === 'RELEASED' && bill && (
                          <>
                            <button className="secondary" onClick={() => navigate(`/app/report/${bill.id}`)}>Report</button>
                            <button className="danger" onClick={() => openRevoke(s)} disabled={busy}>Revoke</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleSamples.length === 0 && <tr><td colSpan={6}>No samples.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {viewMode === 'cards' && (
        <div className="lab-cards">
          {visibleGroups.map((g) => {
            const lastUpdated = g.samples.reduce((max, s) => (
              !max || new Date(s.updatedAt) > new Date(max.updatedAt) ? s : max
            ), null);
            const actionKind = cardActionFor(g);
            // The single CTA button above only surfaces the group's one "next
            // step" action (e.g. Release once everything's VERIFIED), which
            // hid two things list view already has: editing results that are
            // VERIFIED-but-not-yet-released, and revoking an already-RELEASED
            // one. Both need their own entry point here regardless of actionKind.
            const hasVerified = g.samples.some((s) => s.status === 'VERIFIED');
            const releasedSample = g.samples.find((s) => s.status === 'RELEASED');
            // Verified tests (including a revoked report rolled back to VERIFIED)
            // must stay releasable even while other tests on the same order are
            // still being collected/entered - otherwise the CTA, which follows
            // the earliest pending stage, leaves no way to release them.
            const verifiedSamples = g.samples.filter((s) => s.status === 'VERIFIED');
            const tests = g.samples.map((s) => ({ testName: s.BillItem?.TestMaster?.testName, status: s.status }));
            const expanded = expandedCards.has(g.billId);
            return (
              <div className="lab-card3" key={g.billId}>
                <div className="lab-card3-head">
                  <div className="lab-card3-name">{g.patient?.name}</div>
                  <span className="lab-row-id">{labTag(g.samples[0].id)}</span>
                </div>
                <div className="lab-card3-head">
                  <div className="lab-card3-sub">
                    {g.patient?.umr} · <span className="gender">{g.patient?.gender}</span>
                    {g.patient?.age != null && g.patient?.age !== '' && ` · ${formatAge(g.patient.age, g.patient.ageUnit)}`}
                  </div>
                  <div className="lab-card3-tags">
                    {g.bill?.visitType && <span className="badge-outline visit-type">{g.bill.visitType}</span>}
                    {/* ROUTINE is the default - only flag the exceptions (e.g. URGENT) */}
                    {g.bill?.priority && g.bill.priority !== 'ROUTINE' && <span className="badge-outline urgent">{g.bill.priority}</span>}
                  </div>
                </div>

                <TestStatusSummary tests={tests} chipsShown={2} expanded={expanded} onToggle={() => toggleCard(g.billId)} />
                {expanded && <TestStatusList tests={tests} />}

                <div className="lab-card3-foot">
                  <span className="meta-item" title={lastUpdated?.updatedBy ? `Last updated by ${lastUpdated.updatedBy}` : ''}>
                    <Icon name="clock" size={11} /> {formatDateTime(lastUpdated?.updatedAt)}
                    {lastUpdated?.updatedBy ? ` · ${lastUpdated.updatedBy}` : ''}
                  </span>
                </div>
                <div className="lab-card3-actions">
                  <button type="button" className="icon-btn" title="View bill report" onClick={() => navigate(`/app/report/${g.billId}`)}>
                    <Icon name="orders" size={13} />
                  </button>
                  {hasVerified && actionKind !== 'review' && (
                    <button type="button" className="secondary" disabled={busy} onClick={() => openReview(g)}>Edit</button>
                  )}
                  {verifiedSamples.length > 0 && actionKind !== 'release' && (
                    <button
                      type="button"
                      className="release-btn"
                      disabled={busy}
                      title={`Release ${verifiedSamples.length} verified test${verifiedSamples.length === 1 ? '' : 's'}`}
                      onClick={() => setConfirmRelease(verifiedSamples)}
                    >
                      Release{verifiedSamples.length > 1 ? ` (${verifiedSamples.length})` : ''}
                    </button>
                  )}
                  {releasedSample && (
                    <button type="button" className="secondary danger" disabled={busy} onClick={() => openRevoke(releasedSample)}>Revoke</button>
                  )}
                  <button type="button" className="cta-btn" disabled={busy} onClick={() => runCardAction(g)}>
                    {CARD_ACTION_LABEL[actionKind]}
                  </button>
                </div>
              </div>
            );
          })}
          {visibleGroups.length === 0 && <p>No samples.</p>}
        </div>
      )}

      {confirmRelease && (
        <div className="modal-overlay" onClick={() => setConfirmRelease(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Confirm Report Release</h2>
            <p>
              You're about to release {confirmRelease.length === 1 ? 'this report' : `these ${confirmRelease.length} reports`} —
              once released, the patient/front office can view and print {confirmRelease.length === 1 ? 'it' : 'them'}. This can be undone later with Revoke if needed.
            </p>
            <ul style={{ fontSize: 13, color: '#334155', paddingLeft: 18, margin: '0 0 16px' }}>
              {confirmRelease.map((s) => <li key={s.id}>{s.BillItem?.TestMaster?.testName}</li>)}
            </ul>
            {error && <p className="error-text">{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="secondary" onClick={() => setConfirmRelease(null)} disabled={busy}>Cancel</button>
              <button type="button" onClick={handleConfirmRelease} disabled={busy}>{busy ? 'Releasing…' : 'Confirm & Release'}</button>
            </div>
          </div>
        </div>
      )}

      {revokeFor && (
        <div className="modal-overlay" onClick={() => setRevokeFor(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Revoke Released Report</h2>
            <p style={{ fontSize: 13, color: '#64748b' }}>
              {revokeFor.BillItem?.TestMaster?.testName} will no longer be visible on the patient's report until it's
              corrected and released again. This is kept as a record, not deleted.
            </p>
            <form onSubmit={handleRevoke}>
              <label><span>Reason (required)</span>
                <input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} required autoFocus />
              </label>
              {revokeError && <p className="error-text">{revokeError}</p>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="secondary" onClick={() => setRevokeFor(null)} disabled={revokeSaving}>Cancel</button>
                <button type="submit" className="danger" disabled={revokeSaving}>{revokeSaving ? 'Revoking…' : 'Revoke Report'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {reviewGroup && (
        <ReviewResults
          group={reviewGroup}
          focusSampleId={reviewFocusId}
          onClose={() => setReviewGroup(null)}
          onSaved={(info) => { setReviewGroup(null); setNotice(info?.notice || ''); load(); }}
        />
      )}
    </div>
  );
}
