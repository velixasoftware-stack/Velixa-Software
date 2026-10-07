import { useEffect, useState } from 'react';
import api from '../../api/client';
import SearchSelect from '../../components/SearchSelect';
import { downloadFile } from '../../utils/download';

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

  return (
    <div>
      <div className="card">
        <h3>Test Master</h3>
        <form onSubmit={handleCreateTest} className="form-grid" style={{ alignItems: 'end' }}>
          <label><span>Test Code</span><input value={newTest.testCode} onChange={(e) => setNewTest((f) => ({ ...f, testCode: e.target.value }))} required /></label>
          <label><span>Test Name</span><input value={newTest.testName} onChange={(e) => setNewTest((f) => ({ ...f, testName: e.target.value }))} required /></label>
          <button type="submit">Add Test</button>
        </form>
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Parameters</th></tr></thead>
          <tbody>
            {tests.map((t) => (
              <tr key={t.id}>
                <td>{t.testCode}</td>
                <td>{t.testName}</td>
                <td>{(t.ParameterMasters || []).map((p) => p.parameterName).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Price Updation</h3>
        <form onSubmit={handleSetPrice} className="form-grid" style={{ alignItems: 'end' }}>
          <div><span>Test</span>
            <SearchSelect
              options={tests.map((t) => ({ value: t.id, label: `${t.testCode} — ${t.testName}` }))}
              value={priceForm.testId}
              onChange={(testId) => setPriceForm((f) => ({ ...f, testId }))}
              placeholder="Search by test code or name…"
            />
          </div>
          <label><span>Price (₹)</span><input type="number" value={priceForm.price} onChange={(e) => setPriceForm((f) => ({ ...f, price: e.target.value }))} required /></label>
          <button type="submit" disabled={!priceForm.testId}>Set Price</button>
        </form>
        <table>
          <thead><tr><th>Test Code</th><th>Test Name</th><th>Price</th></tr></thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.id}><td>{p.TestMaster?.testCode}</td><td>{p.TestMaster?.testName}</td><td>₹{p.price}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Bulk Update — Test Prices</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>Columns: TEST_CODE, TEST_NAME, PRICE</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button type="button" className="secondary" onClick={() => downloadFile('/masters/client-test-price/template', 'test-price-template.xlsx')}>
            Download Template
          </button>
        </div>
        <form onSubmit={handleTestPreview} className="form-grid" style={{ alignItems: 'end' }}>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setTestFile(e.target.files[0])} />
          <button type="submit">Preview</button>
        </form>

        {testPreview && (
          <>
            <p>{testPreview.validRows} valid, {testPreview.invalidRows} invalid of {testPreview.totalRows} rows.</p>
            <table>
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
            <button onClick={handleTestCommit} disabled={testPreview.validRows === 0} style={{ marginTop: 12 }}>
              Upload {testPreview.validRows} Valid Rows
            </button>
          </>
        )}
        {testUploadMessage && <p>{testUploadMessage}</p>}
      </div>

      <div className="card">
        <h3>Packages</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>Bundle several tests together under one package price.</p>
        <form onSubmit={handleCreatePackage} className="form-grid" style={{ alignItems: 'end' }}>
          <label><span>Package Code</span><input value={packageForm.packageCode} onChange={(e) => setPackageForm((f) => ({ ...f, packageCode: e.target.value }))} required /></label>
          <label><span>Package Name</span><input value={packageForm.packageName} onChange={(e) => setPackageForm((f) => ({ ...f, packageName: e.target.value }))} required /></label>
          <label><span>Package Price (₹)</span><input type="number" value={packageForm.price} onChange={(e) => setPackageForm((f) => ({ ...f, price: e.target.value }))} required /></label>
        </form>

        <p style={{ marginBottom: 6, fontWeight: 600, fontSize: 13 }}>Tests included in this package</p>
        <table>
          <thead><tr><th></th><th>Test</th></tr></thead>
          <tbody>
            {tests.map((t) => (
              <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => toggleTestSelection(t.id)}>
                <td><input type="checkbox" checked={packageForm.testIds.includes(t.id)} onChange={() => toggleTestSelection(t.id)} onClick={(e) => e.stopPropagation()} style={{ width: 'auto' }} /></td>
                <td>{t.testCode} — {t.testName}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {error && <p className="error-text">{error}</p>}
        <button onClick={handleCreatePackage} style={{ marginTop: 12 }}>Create Package</button>

        <table style={{ marginTop: 20 }}>
          <thead><tr><th>Code</th><th>Name</th><th>Tests Included</th><th>Price</th></tr></thead>
          <tbody>
            {packages.map((p) => (
              <tr key={p.id}>
                <td>{p.packageCode}</td>
                <td>{p.packageName}</td>
                <td>{(p.TestMasters || []).map((t) => t.testName).join(', ')}</td>
                <td>₹{p.price}</td>
              </tr>
            ))}
            {packages.length === 0 && <tr><td colSpan={4}>No packages yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Bulk Update — Package Prices</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>Columns: PACKAGE_CODE, PACKAGE_NAME, PRICE</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button type="button" className="secondary" onClick={() => downloadFile('/masters/packages/template', 'package-price-template.xlsx')}>
            Download Template
          </button>
        </div>
        <form onSubmit={handlePkgPreview} className="form-grid" style={{ alignItems: 'end' }}>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setPkgFile(e.target.files[0])} />
          <button type="submit">Preview</button>
        </form>

        {pkgPreview && (
          <>
            <p>{pkgPreview.validRows} valid, {pkgPreview.invalidRows} invalid of {pkgPreview.totalRows} rows.</p>
            <table>
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
            <button onClick={handlePkgCommit} disabled={pkgPreview.validRows === 0} style={{ marginTop: 12 }}>
              Upload {pkgPreview.validRows} Valid Rows
            </button>
          </>
        )}
        {pkgUploadMessage && <p>{pkgUploadMessage}</p>}
      </div>
    </div>
  );
}
