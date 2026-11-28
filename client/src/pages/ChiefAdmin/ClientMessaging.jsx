import { useEffect, useState } from 'react';
import api from '../../api/client';
import SearchSelect from '../../components/SearchSelect';

const EVENT_LABEL = { BILL_CREATED: 'Bill generated', REPORT_RELEASED: 'Report released (all tests)' };
const PLACEHOLDERS = '{patientName} {labName} {labMobile} {billNo} {tests} {amount} {paid} {due} {reportLink}';
const CHANNELS = [['whatsapp', 'WhatsApp'], ['sms', 'SMS'], ['email', 'Gmail']];
const STATUS_STYLE = { SENT: { background: '#dcfce7', color: '#166534' }, FAILED: { background: '#fee2e2', color: '#b91c1c' }, SKIPPED: { background: '#f1f5f9', color: '#64748b' } };

function Field({ label, children, hint, wide }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, margin: 0, flex: wide ? '1 1 100%' : '1 1 220px', minWidth: 0 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>{label}</span>
      {children}
      {hint && <span className="cell-sub" style={{ fontSize: 11.5 }}>{hint}</span>}
    </label>
  );
}

/**
 * Chief Admin: one client's own WhatsApp / SMS / Gmail accounts and the
 * automatic patient messages (bill generated, report released).
 */
export default function ClientMessaging() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [cfg, setCfg] = useState(null);
  const [params, setParams] = useState({});
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [test, setTest] = useState({ channel: 'WHATSAPP', to: '' });
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    api.get('/clients').then((r) => setClients(r.data.clients || [])).catch(() => setError('Failed to load clients'));
  }, []);

  async function pick(id) {
    setClientId(id);
    setCfg(null);
    setLogs([]);
    setError('');
    setMessage('');
    setTestResult(null);
    if (!id) return;
    try {
      const { data } = await api.get(`/admin/client-notifications/${id}`);
      setCfg(data.config);
      setParams(data.templateParams || {});
      loadLogs(id);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load settings');
    }
  }
  const loadLogs = (id = clientId) => api.get(`/admin/client-notifications/${id}/logs`).then((r) => setLogs(r.data)).catch(() => {});

  const set = (ch, field, value) => setCfg((c) => ({ ...c, [ch]: { ...c[ch], [field]: value } }));
  const setEvent = (ev, field, value) => setCfg((c) => ({ ...c, events: { ...c.events, [ev]: { ...c.events[ev], [field]: value } } }));

  async function save() {
    setBusy('save');
    setError('');
    setMessage('');
    try {
      const { data } = await api.put(`/admin/client-notifications/${clientId}`, cfg);
      setCfg(data.config);
      setMessage(data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save');
    } finally {
      setBusy('');
    }
  }

  async function sendTest() {
    setBusy('test');
    setTestResult(null);
    setError('');
    try {
      const { data } = await api.post(`/admin/client-notifications/${clientId}/test`, test);
      setTestResult(data);
      loadLogs();
    } catch (err) {
      setError(err.response?.data?.message || 'Test failed');
    } finally {
      setBusy('');
    }
  }

  const clientOptions = clients.map((c) => ({ value: c.id, label: `${c.clientCode} — ${c.clientName}`, sublabel: [c.mobile, c.email].filter(Boolean).join(' · ') }));
  const secretHint = (saved) => (saved ? `Saved (${saved}) - leave empty to keep, type - to remove` : 'Not set');

  return (
    <div>
      <div className="card">
        <h3 style={{ margin: 0 }}>Client Messaging</h3>
        <p className="cell-sub" style={{ margin: '2px 0 12px' }}>
          Each client&apos;s own WhatsApp, SMS and Gmail accounts, and which messages go to patients automatically when a bill is
          generated or a report is released. Messages are sent in the background - billing never waits for them.
        </p>
        <div style={{ maxWidth: 460 }}>
          <span className="reset-field-label">Client</span>
          <SearchSelect options={clientOptions} value={clientId} onChange={(id) => pick(id ? String(id) : '')} placeholder="Search by client code, name, mobile…" />
        </div>
        {error && <p className="error-text">{error}</p>}
        {message && <p style={{ color: '#166534' }}>{message}</p>}
      </div>

      {cfg && (
        <>
          {/* WhatsApp */}
          <div className="card">
            <ChannelHead title="WhatsApp (Meta WhatsApp Cloud API)" on={cfg.whatsapp.enabled} onToggle={(v) => set('whatsapp', 'enabled', v)} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, opacity: cfg.whatsapp.enabled ? 1 : 0.55 }}>
              <Field label="Phone number ID" hint="From Meta Business > WhatsApp > API setup">
                <input value={cfg.whatsapp.phoneNumberId} onChange={(e) => set('whatsapp', 'phoneNumberId', e.target.value)} />
              </Field>
              <Field label="Permanent access token" hint={secretHint(cfg.whatsapp.accessTokenSaved)}>
                <input type="password" autoComplete="new-password" value={cfg.whatsapp.accessToken} onChange={(e) => set('whatsapp', 'accessToken', e.target.value)} placeholder={cfg.whatsapp.accessTokenSaved ? 'unchanged' : ''} />
              </Field>
              <Field label="Template language" hint="e.g. en, en_US">
                <input value={cfg.whatsapp.language} onChange={(e) => set('whatsapp', 'language', e.target.value)} placeholder="en" />
              </Field>
              <Field label="Approved template - bill" hint={`Values sent in order: ${(params.BILL_CREATED || []).map((p, i) => `{{${i + 1}}}=${p}`).join(', ')}`}>
                <input value={cfg.whatsapp.templateBill} onChange={(e) => set('whatsapp', 'templateBill', e.target.value)} placeholder="e.g. bill_generated" />
              </Field>
              <Field label="Approved template - report" hint={`Values sent in order: ${(params.REPORT_RELEASED || []).map((p, i) => `{{${i + 1}}}=${p}`).join(', ')}`}>
                <input value={cfg.whatsapp.templateReport} onChange={(e) => set('whatsapp', 'templateReport', e.target.value)} placeholder="e.g. report_ready" />
              </Field>
            </div>
            <p className="cell-sub" style={{ margin: '8px 0 0' }}>
              WhatsApp only lets a business start a chat with an <strong>approved template</strong>. Without a template name, the message
              text below is sent as plain text, which WhatsApp delivers only if the patient messaged the lab in the last 24 hours.
            </p>
          </div>

          {/* SMS */}
          <div className="card">
            <ChannelHead title="SMS (any provider's HTTP API - MSG91, Fast2SMS, Textlocal, …)" on={cfg.sms.enabled} onToggle={(v) => set('sms', 'enabled', v)} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, opacity: cfg.sms.enabled ? 1 : 0.55 }}>
              <Field label="Method">
                <select value={cfg.sms.method || 'GET'} onChange={(e) => set('sms', 'method', e.target.value)}><option>GET</option><option>POST</option></select>
              </Field>
              <Field label="Sender ID" hint="6-letter DLT header, e.g. VELIXA">
                <input value={cfg.sms.senderId} onChange={(e) => set('sms', 'senderId', e.target.value)} />
              </Field>
              <Field label="DLT template ID - bill"><input value={cfg.sms.dltTemplateBill} onChange={(e) => set('sms', 'dltTemplateBill', e.target.value)} /></Field>
              <Field label="DLT template ID - report"><input value={cfg.sms.dltTemplateReport} onChange={(e) => set('sms', 'dltTemplateReport', e.target.value)} /></Field>
              <Field wide label="API URL" hint="Use {mobile} (10 digits) or {mobile91}, {message}, {senderId}, {templateId} - they're filled in for each patient.">
                <input value={cfg.sms.url} onChange={(e) => set('sms', 'url', e.target.value)} placeholder="https://provider.example/send?apikey=XXXX&to={mobile}&sender={senderId}&template={templateId}&text={message}" />
              </Field>
              {(cfg.sms.method || 'GET') === 'POST' && (
                <>
                  <Field label="Body format">
                    <select value={cfg.sms.contentType || 'json'} onChange={(e) => set('sms', 'contentType', e.target.value)}><option value="json">JSON</option><option value="form">Form</option></select>
                  </Field>
                  <Field wide label="Request body" hint="Same placeholders as the URL.">
                    <textarea rows={3} value={cfg.sms.body} onChange={(e) => set('sms', 'body', e.target.value)} placeholder='{"sender":"{senderId}","mobiles":"{mobile91}","message":"{message}","template_id":"{templateId}"}' />
                  </Field>
                </>
              )}
              <Field wide label="Extra headers (JSON, optional)" hint={secretHint(cfg.sms.headersSaved)}>
                <input type="password" autoComplete="new-password" value={cfg.sms.headers} onChange={(e) => set('sms', 'headers', e.target.value)} placeholder='{"authkey":"XXXX"}' />
              </Field>
            </div>
            <p className="cell-sub" style={{ margin: '8px 0 0' }}>
              In India, SMS is delivered only if the message text exactly matches a DLT-approved template of this sender.
            </p>
          </div>

          {/* Gmail */}
          <div className="card">
            <ChannelHead title="Gmail" on={cfg.email.enabled} onToggle={(v) => set('email', 'enabled', v)} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, opacity: cfg.email.enabled ? 1 : 0.55 }}>
              <Field label="Gmail address"><input value={cfg.email.gmailAddress} onChange={(e) => set('email', 'gmailAddress', e.target.value)} placeholder="lab@gmail.com" /></Field>
              <Field label="App password" hint={cfg.email.appPasswordSaved ? secretHint(cfg.email.appPasswordSaved) : 'Google Account > Security > 2-Step Verification > App passwords (16 letters)'}>
                <input type="password" autoComplete="new-password" value={cfg.email.appPassword} onChange={(e) => set('email', 'appPassword', e.target.value)} placeholder={cfg.email.appPasswordSaved ? 'unchanged' : ''} />
              </Field>
              <Field label="From name"><input value={cfg.email.fromName} onChange={(e) => set('email', 'fromName', e.target.value)} placeholder="Lab name" /></Field>
            </div>
          </div>

          {/* Automatic messages */}
          <div className="card">
            <h4 style={{ marginTop: 0 }}>Automatic messages to patients</h4>
            {Object.keys(cfg.events).map((ev) => (
              <div key={ev} style={{ borderTop: '1px solid #e2e8f0', padding: '10px 0' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
                  <strong style={{ minWidth: 200 }}>{EVENT_LABEL[ev] || ev}</strong>
                  {CHANNELS.map(([ch, label]) => (
                    <label key={ch} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontWeight: 'normal', opacity: cfg[ch].enabled ? 1 : 0.5 }} title={cfg[ch].enabled ? '' : `Switch ${label} on above first`}>
                      <input type="checkbox" style={{ width: 16, height: 16 }} disabled={!cfg[ch].enabled} checked={!!cfg.events[ev][ch] && cfg[ch].enabled} onChange={(e) => setEvent(ev, ch, e.target.checked)} />
                      {label}
                    </label>
                  ))}
                </div>
                <textarea rows={2} style={{ width: '100%', marginTop: 6 }} value={cfg.events[ev].text} onChange={(e) => setEvent(ev, 'text', e.target.value)} />
              </div>
            ))}
            <p className="cell-sub" style={{ margin: '4px 0 0' }}>Placeholders: {PLACEHOLDERS}</p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 0', fontWeight: 'normal' }}>
              <input type="checkbox" style={{ width: 16, height: 16 }} checked={cfg.usePlatformFallback} onChange={(e) => setCfg((c) => ({ ...c, usePlatformFallback: e.target.checked }))} />
              If this client has no own WhatsApp/Gmail account, send through the platform account (Integrations)
            </label>
            <div style={{ marginTop: 12 }}>
              <button type="button" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save Messaging Settings'}</button>
            </div>
          </div>

          {/* Test + log */}
          <div className="card">
            <h4 style={{ marginTop: 0 }}>Send a test (uses the saved settings)</h4>
            <div className="masters-row" style={{ alignItems: 'flex-end' }}>
              <Field label="Channel">
                <select value={test.channel} onChange={(e) => setTest({ ...test, channel: e.target.value })}>
                  <option value="WHATSAPP">WhatsApp</option><option value="SMS">SMS</option><option value="EMAIL">Gmail</option>
                </select>
              </Field>
              <Field label={test.channel === 'EMAIL' ? 'Email address' : 'Mobile number'}>
                <input value={test.to} onChange={(e) => setTest({ ...test, to: e.target.value })} placeholder={test.channel === 'EMAIL' ? 'you@example.com' : '98XXXXXXXX'} />
              </Field>
              <button type="button" onClick={sendTest} disabled={busy === 'test'}>{busy === 'test' ? 'Sending…' : 'Send Test'}</button>
            </div>
            {testResult && (
              <p style={{ marginBottom: 0 }}>
                <span className="badge" style={STATUS_STYLE[testResult.status]}>{testResult.status}</span>{' '}
                <span className="cell-sub">{testResult.detail}</span>
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <h4 style={{ margin: 0 }}>Recent messages</h4>
              <button type="button" className="secondary" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => loadLogs()}>Refresh</button>
            </div>
            <div className="masters-table-wrap" style={{ marginTop: 6 }}>
              <table className="orders-table">
                <thead><tr><th>When</th><th>Event</th><th>Channel</th><th>To</th><th>Status</th><th>Detail</th></tr></thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td data-label="When" style={{ whiteSpace: 'nowrap' }}>{new Date(l.createdAt).toLocaleString('en-IN')}</td>
                      <td data-label="Event">{EVENT_LABEL[l.event] || l.event}</td>
                      <td data-label="Channel">{l.channel}</td>
                      <td data-label="To">{l.recipient || '—'}</td>
                      <td data-label="Status"><span className="badge" style={STATUS_STYLE[l.status]}>{l.status}</span></td>
                      <td data-label="Detail" className="cell-sub" style={{ maxWidth: 380, overflowWrap: 'anywhere' }}>{l.detail}</td>
                    </tr>
                  ))}
                  {logs.length === 0 && <tr><td colSpan={6}>No messages yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ChannelHead({ title, on, onToggle }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
      <h4 style={{ margin: 0 }}>{title}</h4>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontWeight: 600 }}>
        <input type="checkbox" style={{ width: 18, height: 18 }} checked={on} onChange={(e) => onToggle(e.target.checked)} />
        {on ? 'On' : 'Off'}
      </label>
    </div>
  );
}
