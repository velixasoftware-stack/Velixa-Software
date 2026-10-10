import { useEffect, useState } from 'react';
import api from '../../api/client';
import SearchSelect from '../../components/SearchSelect';
import { downloadFile } from '../../utils/download';

// Horizontal tabs instead of one long vertical page - each master task
// (tests, prices, packages, bulk upload) gets the full width on its own.
const MASTER_TABS = [
  { key: 'tests', label: 'Test Master', count: ({ tests }) => tests.length },
  { key: 'prices', label: 'Price Updation', count: ({ prices }) => prices.length },
  { key: 'packages', label: 'Packages', count: ({ packages }) => packages.length },
  { key: 'bulk', label: 'Bulk Upload' },
];

function blankPackage() {
  return { packageCode: '', packageName: '', price: '', testIds: [] };
}

export default function Masters() {
  const [tests, setTests] = useState([]);
  const [prices, setPrices] = useState([]);
  const [packages, setPackages] = useState([]);
  const [newTest, setNewTest] = useState({ testCode: '', testName: '' });
  const [priceForm, setPriceForm] = useState({ testId: '', price: '' });
  const [packageForm, setPackageForm] = useState(blankPackage());

  const [testPreview, setTestPreview] = useState(null);
  const [testFile, setTestFile] = useState(null);
  const [testUploadMessage, setTestUploadMessage] = useState('');

  const [pkgPreview, setPkgPreview] = useState(null);
  const [pkgFile, setPkgFile] = useState(null);
  const [pkgUploadMessage, setPkgUploadMessage] = useState('');

  const [error, setError] = useState('');
  const [tab, setTab] = useState('tests');
  const [search, setSearch] = useState(''); // filters the current tab's table
  const [pkgTestSearch, setPkgTestSearch] = useState(''); // filters the package test picker

  async function loadAll() {
    const [testsRes, pricesRes, packagesRes] = await Promise.all([
      api.get('/masters/tests'),
      api.get('/masters/client-test-price'),
      api.get('/masters/packages'),
    ]);
    setTests(testsRes.data);
    setPrices(pricesRes.data);
    setPackages(packagesRes.data);
  }

  useEffect(() => { loadAll(); }, []);

  async function handleCreateTest(e) {
    e.preventDefault();
    await api.post('/masters/tests', newTest);
    setNewTest({ testCode: '', testName: '' });
    loadAll();
  }

  async function handleSetPrice(e) {
    e.preventDefault();
    await api.put('/masters/client-test-price', { testId: Number(priceForm.testId), price: Number(priceForm.price) });
    setPriceForm({ testId: '', price: '' });
    loadAll();
  }

  async function handleTestPreview(e) {
    e.preventDefault();
    if (!testFile) return;
    const formData = new FormData();
    formData.append('file', testFile);
    const { data } = await api.post('/masters/client-test-price/upload/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setTestPreview(data);
  }

  async function handleTestCommit() {
    const rows = testPreview.preview.filter((r) => r.valid).map((r) => ({ testCode: r.testCode, price: r.price }));
    const { data } = await api.post('/masters/client-test-price/upload/commit', { rows });
    setTestUploadMessage(`Uploaded: ${data.success.length} succeeded, ${data.errors.length} failed.`);
    setTestPreview(null);
    setTestFile(null);
    loadAll();
  }

  function toggleTestSelection(testId) {
    setPackageForm((f) => ({
      ...f,
      testIds: f.testIds.includes(testId) ? f.testIds.filter((id) => id !== testId) : [...f.testIds, testId],
    }));
  }

  async function handleCreatePackage(e) {
    e.preventDefault();
    setError('');
    if (packageForm.testIds.length === 0) {
      setError('Select at least one test for the package');
      return;
    }
    try {
      await api.post('/masters/packages', { ...packageForm, price: Number(packageForm.price) });
      setPackageForm(blankPackage());
      loadAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create package');
    }
  }

  async function handlePkgPreview(e) {
    e.preventDefault();
    if (!pkgFile) return;
    const formData = new FormData();
    formData.append('file', pkgFile);
    const { data } = await api.post('/masters/packages/upload/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setPkgPreview(data);
  }

  async function handlePkgCommit() {
    const rows = pkgPreview.preview.filter((r) => r.valid).map((r) => ({ packageCode: r.packageCode, price: r.price }));
    const { data } = await api.post('/masters/packages/upload/commit', { rows });
    setPkgUploadMessage(`Uploaded: ${data.success.length} succeeded, ${data.errors.length} failed.`);
    setPkgPreview(null);
    setPkgFile(null);
    loadAll();
  }

  // Active/Inactive here is for this clinic only - the shared Test Master and
  // other clinics are untouched. A test Chief Admin made inactive can't be
  // switched back on from here.
  async function toggleClientTest(test, priceRow) {
    const turningOff = priceRow.active !== false;
    if (!window.confirm(turningOff
      ? `Mark "${test.testName}" Inactive for your clinic?\n\nIt can't be billed until you make it Active again. Old bills and reports keep it.`
      : `Make "${test.testName}" Active again for your clinic?`)) return;
    try {
      await api.put(`/masters/client-test-price/${test.id}/status`, { active: !turningOff });
      loadAll();
    } catch (err) {
      window.alert(err.response?.data?.message || 'Could not change the test status');
    }
  }

  async function removeClientTest(test) {
    if (!window.confirm(`Remove "${test.testName}" from your clinic?

This deletes your clinic's price, short name and payor prices for it, and takes it out of your packages. Bills already made are not changed.`)) return;
    try {
      await api.delete(`/masters/client-test-price/${test.id}`);
      loadAll();
    } catch (err) {
      window.alert(err.response?.data?.message || 'Could not remove the test');
    }
  }

  const priceRowByTestId = new Map(prices.map((p) => [p.testId ?? p.TestMaster?.id, p]));

  function testStatus(test) {
    const row = priceRowByTestId.get(test.id);
    if (test.active === false) return <span className="badge EXPIRED" title="Switched off by Chief Admin for all clinics">Inactive (Chief Admin)</span>;
    if (!row) return <span className="badge PENDING">No price</span>;
    return row.active === false ? <span className="badge EXPIRED">Inactive</span> : <span className="badge PAID">Active</span>;
  }

  function testActions(test) {
    const row = priceRowByTestId.get(test.id);
    if (!row) return null;
    return (
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {test.active !== false && (
          <button type="button" className="secondary" onClick={() => toggleClientTest(test, row)}>
            {row.active === false ? 'Make Active' : 'Make Inactive'}
          </button>
        )}
        <button type="button" className="danger" onClick={() => removeClientTest(test)}>Remove</button>
      </div>
    );
  }

  const priceByTestId = new Map(prices.map((p) => [p.testId ?? p.TestMaster?.id, Number(p.price)]));
  const q = search.trim().toLowerCase();
  const matches = (...fields) => !q || fields.some((f) => (f || '').toString().toLowerCase().includes(q));
  const pq = pkgTestSearch.trim().toLowerCase();
  const pickerTests = tests.filter((t) => !pq || `${t.testCode} ${t.testName}`.toLowerCase().includes(pq));
  const selectedTests = tests.filter((t) => packageForm.testIds.includes(t.id));
  const selectedTotal = selectedTests.reduce((sum, t) => sum + (priceByTestId.get(t.id) || 0), 0);

  return (
    <div className="card masters-card">
      <div className="masters-head">
        <h3 style={{ margin: 0 }}>Masters &amp; Pricing</h3>
        <div className="status-tabs compact">
          {MASTER_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`status-tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => { setTab(t.key); setSearch(''); }}
            >
              {t.label}
              {t.count && <span className="tab-count">{t.count({ tests, prices, packages })}</span>}
            </button>
          ))}
        </div>
      </div>

      {tab === 'tests' && (
        <>
          <form onSubmit={handleCreateTest} className="masters-row">
            <label><span>Test Code</span><input value={newTest.testCode} onChange={(e) => setNewTest((f) => ({ ...f, testCode: e.target.value }))} required /></label>
            <label className="grow"><span>Test Name</span><input value={newTest.testName} onChange={(e) => setNewTest((f) => ({ ...f, testName: e.target.value }))} required /></label>
            <button type="submit">Add Test</button>
            <input className="masters-search" placeholder="Search tests…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
          <div className="masters-table-wrap">
            <table className="orders-table">
              <thead><tr><th>Code</th><th>Name</th><th>Parameters</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {tests.filter((t) => matches(t.testCode, t.testName)).map((t) => (
                  <tr key={t.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{t.testCode}</td>
                    <td>{t.testName}</td>
                    <td className="cell-sub" style={{ whiteSpace: 'normal' }}>{(t.ParameterMasters || []).map((p) => p.parameterName).join(', ') || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{testStatus(t)}</td>
                    <td>{testActions(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'prices' && (
        <>
          <form onSubmit={handleSetPrice} className="masters-row">
            <div className="grow"><span className="field-label">Test</span>
              <SearchSelect
                options={tests.map((t) => ({ value: t.id, label: `${t.testCode} — ${t.testName}` }))}
                value={priceForm.testId}
                onChange={(testId) => setPriceForm((f) => ({ ...f, testId }))}
                placeholder="Search by test code or name…"
              />
            </div>
            <label><span>Price (₹)</span><input type="number" value={priceForm.price} onChange={(e) => setPriceForm((f) => ({ ...f, price: e.target.value }))} required /></label>
            <button type="submit" disabled={!priceForm.testId}>Set Price</button>
            <input className="masters-search" placeholder="Search price list…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
          <div className="masters-table-wrap">
            <table className="orders-table">
              <thead><tr><th>Test Code</th><th>Test Name</th><th style={{ textAlign: 'right' }}>Price</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {prices.filter((p) => p.TestMaster && matches(p.TestMaster.testCode, p.TestMaster.testName)).map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.TestMaster.testCode}</td>
                    <td>{p.TestMaster.testName}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{p.price}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{testStatus(p.TestMaster)}</td>
                    <td>{testActions(p.TestMaster)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'packages' && (
        <>
          <div className="pkg-builder">
            <form onSubmit={handleCreatePackage} className="pkg-form">
              <div className="pkg-form-title">New package</div>
              <label><span>Package Code</span><input value={packageForm.packageCode} onChange={(e) => setPackageForm((f) => ({ ...f, packageCode: e.target.value }))} required /></label>
              <label><span>Package Name</span><input value={packageForm.packageName} onChange={(e) => setPackageForm((f) => ({ ...f, packageName: e.target.value }))} required /></label>
              <label><span>Package Price (₹)</span><input type="number" value={packageForm.price} onChange={(e) => setPackageForm((f) => ({ ...f, price: e.target.value }))} required /></label>
              <div className="pkg-selected">
                <div className="pkg-selected-head">
                  <span>{selectedTests.length} test{selectedTests.length === 1 ? '' : 's'} selected</span>
                  {selectedTotal > 0 && <span title="Sum of the individual test prices">Individually ₹{selectedTotal.toFixed(2)}</span>}
                </div>
                <div className="pkg-selected-chips">
                  {selectedTests.map((t) => (
                    <span key={t.id} className="pkg-chip">
                      {t.testName}
                      <button type="button" aria-label={`Remove ${t.testName}`} onClick={() => toggleTestSelection(t.id)}>×</button>
                    </span>
                  ))}
                  {selectedTests.length === 0 && <span className="cell-sub">Pick tests from the list →</span>}
                </div>
              </div>
              {error && <p className="error-text">{error}</p>}
              <button type="submit">Create Package</button>
            </form>

            <div className="pkg-picker">
              <div className="pkg-picker-head">
                <input placeholder="Search tests by code or name…" value={pkgTestSearch} onChange={(e) => setPkgTestSearch(e.target.value)} autoFocus />
                <span className="cell-sub">{pickerTests.length} of {tests.length}</span>
              </div>
              <div className="pkg-picker-list">
                {pickerTests.map((t) => {
                  const on = packageForm.testIds.includes(t.id);
                  return (
                    <label key={t.id} className={`pkg-pick${on ? ' on' : ''}`}>
                      <input type="checkbox" checked={on} onChange={() => toggleTestSelection(t.id)} />
                      <span className="code">{t.testCode}</span>
                      <span className="name">{t.testName}</span>
                      {priceByTestId.has(t.id) && <span className="price">₹{priceByTestId.get(t.id)}</span>}
                    </label>
                  );
                })}
                {pickerTests.length === 0 && <p className="cell-sub" style={{ padding: 8 }}>No tests match “{pkgTestSearch}”.</p>}
              </div>
            </div>
          </div>

          <div className="masters-row" style={{ marginTop: 12 }}>
            <strong style={{ fontSize: 13 }}>Existing packages</strong>
            <input className="masters-search" placeholder="Search packages…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="masters-table-wrap">
            <table className="orders-table">
              <thead><tr><th>Code</th><th>Name</th><th>Tests Included</th><th style={{ textAlign: 'right' }}>Price</th></tr></thead>
              <tbody>
                {packages.filter((p) => matches(p.packageCode, p.packageName)).map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.packageCode}</td>
                    <td>{p.packageName}</td>
                    <td className="cell-sub" style={{ whiteSpace: 'normal' }}>{(p.TestMasters || []).map((t) => t.testName).join(', ')}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{p.price}</td>
                  </tr>
                ))}
                {packages.length === 0 && <tr><td colSpan={4}>No packages yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'bulk' && (
        <div className="bulk-grid">
          <div className="bulk-box">
            <div className="pkg-form-title">Test prices</div>
            <p className="cell-sub">Excel columns: TEST_CODE, TEST_NAME, PRICE</p>
            <form onSubmit={handleTestPreview} className="masters-row">
              <button type="button" className="secondary" onClick={() => downloadFile('/masters/client-test-price/template', 'test-price-template.xlsx')}>
                Template
              </button>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setTestFile(e.target.files[0])} />
              <button type="submit">Preview</button>
            </form>
            {testPreview && (
              <>
                <p className="cell-sub">{testPreview.validRows} valid, {testPreview.invalidRows} invalid of {testPreview.totalRows} rows.</p>
                <table className="orders-table">
                  <thead><tr><th>Row</th><th>Test Code</th><th>Price</th><th>Status</th></tr></thead>
                  <tbody>
                    {testPreview.preview.map((r) => (
                      <tr key={r.row}>
                        <td>{r.row}</td><td>{r.testCode}</td><td>{r.price}</td>
                        <td>{r.valid ? <span className="badge PAID">Valid</span> : <span className="badge EXPIRED">{r.errors.join('; ')}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={handleTestCommit} disabled={testPreview.validRows === 0} style={{ marginTop: 8 }}>
                  Upload {testPreview.validRows} Valid Rows
                </button>
              </>
            )}
            {testUploadMessage && <p className="cell-sub">{testUploadMessage}</p>}
          </div>

          <div className="bulk-box">
            <div className="pkg-form-title">Package prices</div>
            <p className="cell-sub">Excel columns: PACKAGE_CODE, PACKAGE_NAME, PRICE</p>
            <form onSubmit={handlePkgPreview} className="masters-row">
              <button type="button" className="secondary" onClick={() => downloadFile('/masters/packages/template', 'package-price-template.xlsx')}>
                Template
              </button>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setPkgFile(e.target.files[0])} />
              <button type="submit">Preview</button>
            </form>
            {pkgPreview && (
              <>
                <p className="cell-sub">{pkgPreview.validRows} valid, {pkgPreview.invalidRows} invalid of {pkgPreview.totalRows} rows.</p>
                <table className="orders-table">
                  <thead><tr><th>Row</th><th>Package Code</th><th>Price</th><th>Status</th></tr></thead>
                  <tbody>
                    {pkgPreview.preview.map((r) => (
                      <tr key={r.row}>
                        <td>{r.row}</td><td>{r.packageCode}</td><td>{r.price}</td>
                        <td>{r.valid ? <span className="badge PAID">Valid</span> : <span className="badge EXPIRED">{r.errors.join('; ')}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={handlePkgCommit} disabled={pkgPreview.validRows === 0} style={{ marginTop: 8 }}>
                  Upload {pkgPreview.validRows} Valid Rows
                </button>
              </>
            )}
            {pkgUploadMessage && <p className="cell-sub">{pkgUploadMessage}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
