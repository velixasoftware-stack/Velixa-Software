const nodemailer = require('nodemailer');
const crypto = require('crypto');
const {
  Bill, BillItem, TestMaster, Patient, Client, Sample, ClientNotificationConfig, NotificationLog,
} = require('../models');
const { getSettings } = require('./notify');

/**
 * Automatic patient messages per client (WhatsApp / SMS / Gmail), configured
 * by Chief Admin (Client Messaging). Sending never blocks or fails a bill or a
 * release: notifyBillEvent is fired after the response and every attempt is
 * written to NotificationLog.
 */

const EVENTS = ['BILL_CREATED', 'REPORT_RELEASED'];
const DEFAULT_TEXT = {
  BILL_CREATED: 'Dear {patientName}, thank you for choosing {labName}. Bill {billNo}: {tests}. Amount {amount}, paid {paid}, due {due}.',
  REPORT_RELEASED: 'Dear {patientName}, your report from {labName} (bill {billNo}) is ready. View it here: {reportLink}',
};
// Order of the {{1}}, {{2}} ... values sent to an approved WhatsApp template.
const TEMPLATE_PARAMS = {
  BILL_CREATED: ['patientName', 'billNo', 'amount', 'labName'],
  REPORT_RELEASED: ['patientName', 'reportLink', 'labName'],
};
// The address patients open report links on (not CLIENT_URL, which is the CORS
// setting and is a localhost address on a developer's machine).
const PUBLIC_URL = (process.env.PUBLIC_APP_URL || 'https://lims.thevelixa.in').replace(/\/+$/, '');
const TIMEOUT_MS = 20000;

const render = (text, data) => String(text || '').replace(/{\s*(\w+)\s*}/g, (m, k) => (data[k] != null ? String(data[k]) : m));
const digits = (v) => String(v || '').replace(/\D/g, '');
/** 10-digit Indian mobile (for SMS gateways) and with country code (for WhatsApp). */
function mobiles(raw) {
  let d = digits(raw);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.length === 10 ? { mobile: d, mobile91: `91${d}` } : null;
}
const inr = (n) => `Rs.${Number(n || 0).toFixed(2)}`;

async function withTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} timed out`)), TIMEOUT_MS); })]);
  } finally { clearTimeout(timer); }
}

/* ---------- channels ---------- */

// document: { link, filename } - the report PDF. With an approved template it
// goes in the template's DOCUMENT header (only when the template has one -
// headerDocument); without a template it's sent as a document with the text as
// its caption (WhatsApp allows that only inside the 24-hour window).
async function sendWhatsAppVia(cfg, to91, text, templateName, params, document = null, headerDocument = false) {
  let body;
  if (templateName) {
    const components = [];
    if (document && headerDocument) components.push({ type: 'header', parameters: [{ type: 'document', document }] });
    components.push({ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p ?? '') })) });
    body = { messaging_product: 'whatsapp', to: to91, type: 'template', template: { name: templateName, language: { code: cfg.language || 'en' }, components } };
  } else if (document) {
    body = { messaging_product: 'whatsapp', to: to91, type: 'document', document: { ...document, caption: text } };
  } else {
    body = { messaging_product: 'whatsapp', to: to91, type: 'text', text: { body: text } };
  }
  const res = await withTimeout(fetch(`https://graph.facebook.com/v19.0/${cfg.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), 'WhatsApp');
  const out = await res.text();
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${out.slice(0, 300)}`);
  return `${templateName ? `template ${templateName}` : (document ? 'document' : 'text')}${document && (headerDocument || !templateName) ? ' + PDF' : ''}`;
}

async function sendSmsVia(cfg, m, text, dltTemplateId) {
  const vars = { mobile: m.mobile, mobile91: m.mobile91, message: text, senderId: cfg.senderId || '', templateId: dltTemplateId || '' };
  const fill = (s, encode) => String(s || '').replace(/{\s*(mobile91|mobile|message|senderId|templateId)\s*}/g, (_, k) => (encode ? encodeURIComponent(vars[k]) : vars[k]));
  const method = (cfg.method || 'GET').toUpperCase();
  let headers = {};
  if (cfg.headers) {
    try { headers = JSON.parse(cfg.headers); } catch { throw new Error('SMS headers are not valid JSON'); }
  }
  const options = { method, headers };
  if (method === 'POST') {
    const json = (cfg.contentType || 'json') === 'json';
    // JSON body: values are JSON-escaped; form body: URL-encoded.
    options.body = json
      ? String(cfg.body || '').replace(/{\s*(mobile91|mobile|message|senderId|templateId)\s*}/g, (_, k) => JSON.stringify(String(vars[k])).slice(1, -1))
      : fill(cfg.body, true);
    options.headers = { 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded', ...headers };
  }
  const res = await withTimeout(fetch(fill(cfg.url, true), options), 'SMS');
  const out = await res.text();
  if (!res.ok) throw new Error(`SMS gateway ${res.status}: ${out.slice(0, 300)}`);
  return out.slice(0, 200);
}

async function sendEmailVia(cfg, to, subject, text, attachments = []) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: cfg.gmailAddress, pass: String(cfg.appPassword || '').replace(/\s+/g, '') },
  });
  const html = `<p>${String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
    .replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>`;
  await withTimeout(transporter.sendMail({ from: cfg.fromName ? `"${cfg.fromName}" <${cfg.gmailAddress}>` : cfg.gmailAddress, to, subject, text, html, attachments }), 'Email');
  return attachments.length ? 'sent + PDF' : 'sent';
}

/* ---------- which account a channel uses ---------- */

const ownWhatsApp = (w) => (w?.phoneNumberId && w?.accessToken ? w : null);
const ownSms = (s) => (s?.url ? s : null);
const ownEmail = (e) => (e?.gmailAddress && e?.appPassword ? e : null);

/** The account to send a channel through: the client's own, else the platform's (if allowed). */
async function accountFor(channel, cfg) {
  if (channel === 'WHATSAPP') {
    const own = ownWhatsApp(cfg.whatsapp);
    if (own) return { account: own };
    if (cfg.usePlatformFallback) {
      const s = await getSettings();
      if (s.whatsappPhoneNumberId && s.whatsappAccessToken) {
        return { account: { ...cfg.whatsapp, phoneNumberId: s.whatsappPhoneNumberId, accessToken: s.whatsappAccessToken }, platform: true };
      }
    }
    return { reason: 'no WhatsApp account set for this client' };
  }
  if (channel === 'SMS') {
    const own = ownSms(cfg.sms);
    return own ? { account: own } : { reason: 'no SMS gateway set for this client' };
  }
  const own = ownEmail(cfg.email);
  if (own) return { account: own };
  if (cfg.usePlatformFallback) {
    const s = await getSettings();
    if (s.smtpHost && s.smtpUser && s.smtpPassword && /gmail/i.test(s.smtpHost)) {
      return { account: { gmailAddress: s.smtpUser, appPassword: s.smtpPassword, fromName: cfg.email?.fromName }, platform: true };
    }
  }
  return { reason: 'no Gmail account set for this client' };
}

async function deliver({ clientId, billId, event, channel, cfg, recipient, text, subject, templateName, templateParams, dltTemplateId, document, headerDocument, attachments }) {
  const log = (status, detail) => NotificationLog.create({ clientId, billId, event, channel, recipient: recipient || null, status, detail: String(detail || '').slice(0, 1000) })
    .catch((e) => console.error('NotificationLog write failed:', e.message));
  const { account, platform, reason } = await accountFor(channel, cfg);
  if (!account) return log('SKIPPED', reason);
  try {
    let info;
    if (channel === 'WHATSAPP') {
      const m = mobiles(recipient);
      if (!m) return log('SKIPPED', 'patient has no valid 10-digit mobile number');
      info = await sendWhatsAppVia(account, m.mobile91, text, templateName, templateParams || [], document, headerDocument);
    } else if (channel === 'SMS') {
      const m = mobiles(recipient);
      if (!m) return log('SKIPPED', 'patient has no valid 10-digit mobile number');
      info = await sendSmsVia(account, m, text, dltTemplateId);
    } else {
      if (!/^\S+@\S+\.\S+$/.test(String(recipient || ''))) return log('SKIPPED', 'patient has no email address');
      info = await sendEmailVia(account, recipient, subject, text, (attachments && await attachments()) || []);
    }
    return log('SENT', `${platform ? '[platform account] ' : ''}${info}`);
  } catch (err) {
    return log('FAILED', err.message);
  }
}

/* ---------- events ---------- */

async function billData(billId) {
  const bill = await Bill.findByPk(billId, {
    include: [Patient, Client, { model: BillItem, attributes: ['id', 'status'], include: [{ model: TestMaster, attributes: ['testName'] }] }],
  });
  if (!bill) return null;
  const net = Number(bill.totalAmount) - Number(bill.discount) + Number(bill.taxAmount);
  return {
    bill,
    data: {
      patientName: bill.Patient?.name || 'Patient',
      labName: bill.Client?.brandingName || bill.Client?.clientName || '',
      labMobile: bill.Client?.brandingMobile || bill.Client?.mobile || '',
      billNo: bill.billNo,
      tests: (bill.BillItems || []).filter((i) => i.status !== 'CANCELLED').map((i) => i.TestMaster?.testName).filter(Boolean).join(', '),
      amount: inr(net),
      paid: inr(bill.paidAmount),
      due: inr(bill.dueAmount),
      reportLink: bill.reportToken ? `${PUBLIC_URL}/r/${bill.reportToken}` : '',
    },
  };
}

/** Sends a bill's automatic messages for `event` on every channel the client switched on for it. */
async function notifyBillEvent(event, billId) {
  if (!EVENTS.includes(event)) return;
  const found = await billData(billId);
  if (!found) return;
  const { bill, data } = found;
  const cfg = await ClientNotificationConfig.findOne({ where: { clientId: bill.clientId } });
  const ev = cfg?.events?.[event];
  if (!cfg || !ev || !(ev.whatsapp || ev.sms || ev.email)) return; // nothing switched on for this client

  if (event === 'REPORT_RELEASED' && !bill.reportToken) {
    await bill.update({ reportToken: crypto.randomBytes(16).toString('hex') });
    data.reportLink = `${PUBLIC_URL}/r/${bill.reportToken}`;
  }
  const text = render(ev.text || DEFAULT_TEXT[event], data);
  const subject = event === 'BILL_CREATED' ? `${data.labName} - Bill ${data.billNo}` : `${data.labName} - Your report is ready (${data.billNo})`;
  const isBill = event === 'BILL_CREATED';
  const base = { clientId: bill.clientId, billId: bill.id, event, cfg, text, subject };
  // The report as a PDF: a link Meta downloads for WhatsApp (the same token
  // as the report link - only this report), and an attachment for Gmail.
  if (!isBill && ev.attachPdf && bill.reportToken) {
    const filename = `Report-${String(bill.billNo).replace(/[^\w.-]+/g, '_')}.pdf`;
    base.document = { link: `${PUBLIC_URL}/api/public/reports/${bill.reportToken}/pdf`, filename };
    base.headerDocument = !!cfg.whatsapp?.templateReportDocument;
    base.attachments = async () => {
      const { buildBillReport } = require('../controllers/lab.controller'); // eslint-disable-line global-require
      const { buildReportPdf } = require('./reportPdf'); // eslint-disable-line global-require
      const full = await Bill.findByPk(bill.id, { include: [Patient, Client, { association: 'ReferralDoctor' }] }).catch(() => null);
      const report = full && await buildBillReport(full);
      return report ? [{ filename, content: await buildReportPdf(report), contentType: 'application/pdf' }] : [];
    };
  }
  const jobs = [];
  if (ev.whatsapp) {
    jobs.push(deliver({
      ...base, channel: 'WHATSAPP', recipient: bill.Patient?.mobile,
      templateName: (isBill ? cfg.whatsapp?.templateBill : cfg.whatsapp?.templateReport) || null,
      templateParams: TEMPLATE_PARAMS[event].map((k) => data[k]),
    }));
  }
  if (ev.sms) jobs.push(deliver({ ...base, channel: 'SMS', recipient: bill.Patient?.mobile, dltTemplateId: isBill ? cfg.sms?.dltTemplateBill : cfg.sms?.dltTemplateReport }));
  if (ev.email) jobs.push(deliver({ ...base, channel: 'EMAIL', recipient: bill.Patient?.email }));
  await Promise.all(jobs);
}

/** Fire-and-forget: runs after the current request's response, never throws. */
function queueBillEvent(event, billId) {
  setImmediate(() => { notifyBillEvent(event, billId).catch((e) => console.error(`notify ${event} bill ${billId} failed:`, e.message)); });
}

// Bills with a "report ready" message waiting to go: the lab screen releases
// several tests at once - they're gathered into one message.
const reportReadyPending = new Set();
const REPORT_BATCH_MS = 20 * 1000;

/**
 * After a release. sendOn EACH: a message for every release (tests released
 * together within ~20s share one). sendOn ALL (default): one message once
 * every test on the bill is released.
 */
async function queueReportReadyIfComplete(billId) {
  const bill = await Bill.findByPk(billId, { attributes: ['id', 'clientId'] });
  if (!bill) return;
  const cfg = await ClientNotificationConfig.findOne({ where: { clientId: bill.clientId }, attributes: ['events'] });
  const ev = cfg?.events?.REPORT_RELEASED;
  if (!ev || !(ev.whatsapp || ev.sms || ev.email)) return;
  if (reportReadyPending.has(billId)) return; // already gathered into a message about to go
  if (ev.sendOn !== 'EACH') {
    const samples = await Sample.findAll({ attributes: ['status'], include: [{ model: BillItem, attributes: ['status'], where: { billId } }] });
    const active = samples.filter((s) => s.BillItem?.status !== 'CANCELLED');
    if (!(active.length > 0 && active.every((s) => s.status === 'RELEASED'))) return;
    // Already sent in the last few minutes (e.g. a second release request) - don't repeat it.
    const recent = await NotificationLog.count({
      where: { billId, event: 'REPORT_RELEASED', createdAt: { [require('sequelize').Op.gte]: new Date(Date.now() - 5 * 60 * 1000) } },
    });
    if (recent) return;
  }
  reportReadyPending.add(billId);
  setTimeout(() => {
    notifyBillEvent('REPORT_RELEASED', billId)
      .catch((e) => console.error(`notify REPORT_RELEASED bill ${billId} failed:`, e.message))
      .finally(() => reportReadyPending.delete(billId));
  }, ev.sendOn === 'EACH' ? REPORT_BATCH_MS : 1000);
}

/** A test message on one channel from Chief Admin's screen, using the saved settings. */
async function sendTest(clientId, channel, to) {
  const cfg = await ClientNotificationConfig.findOne({ where: { clientId } });
  if (!cfg) return { status: 'SKIPPED', detail: 'Save the settings first' };
  const client = await Client.findByPk(clientId, { attributes: ['clientName', 'brandingName'] });
  const labName = client?.brandingName || client?.clientName || '';
  const text = `Test message from ${labName} via Velixa LIMS. If you received this, ${channel} is set up correctly.`;
  const before = new Date();
  await deliver({
    clientId, event: 'TEST', channel, cfg, recipient: to, text, subject: `${labName} - test message`,
    templateName: channel === 'WHATSAPP' ? (cfg.whatsapp?.templateBill || null) : null,
    templateParams: TEMPLATE_PARAMS.BILL_CREATED.map((k) => ({ patientName: 'Test Patient', billNo: 'TEST-001', amount: inr(100), labName }[k])),
    dltTemplateId: cfg.sms?.dltTemplateBill,
  });
  const last = await NotificationLog.findOne({ where: { clientId, event: 'TEST', channel }, order: [['id', 'DESC']] });
  return last && last.createdAt >= before ? { status: last.status, detail: last.detail } : { status: 'FAILED', detail: 'No result recorded' };
}

module.exports = {
  EVENTS, DEFAULT_TEXT, TEMPLATE_PARAMS, queueBillEvent, queueReportReadyIfComplete, notifyBillEvent, sendTest,
};
