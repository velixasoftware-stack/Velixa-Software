const { Client, ClientNotificationConfig, NotificationLog } = require('../models');
const { EVENTS, DEFAULT_TEXT, TEMPLATE_PARAMS, sendTest } = require('../utils/clientNotify');

/**
 * Chief Admin > Client Messaging: each client's own WhatsApp / SMS / Gmail
 * accounts and which automatic messages go out. Secrets (WhatsApp token,
 * Gmail app password, SMS headers) are never sent back to the browser - only
 * whether one is saved and its last 4 characters; leaving the box empty keeps
 * the saved one.
 */

const SECRETS = { whatsapp: ['accessToken'], sms: ['headers'], email: ['appPassword'] };
const FIELDS = {
  whatsapp: ['enabled', 'phoneNumberId', 'accessToken', 'language', 'templateBill', 'templateReport'],
  sms: ['enabled', 'method', 'url', 'body', 'contentType', 'headers', 'senderId', 'dltTemplateBill', 'dltTemplateReport'],
  email: ['enabled', 'gmailAddress', 'appPassword', 'fromName'],
};
const hint = (v) => (v ? `••••${String(v).slice(-4)}` : '');

function masked(cfg) {
  const out = { usePlatformFallback: !!cfg?.usePlatformFallback, events: {} };
  for (const ch of Object.keys(FIELDS)) {
    const src = cfg?.[ch] || {};
    out[ch] = {};
    for (const f of FIELDS[ch]) {
      if (SECRETS[ch].includes(f)) { out[ch][f] = ''; out[ch][`${f}Saved`] = hint(src[f]); } else out[ch][f] = src[f] ?? (f === 'enabled' ? false : '');
    }
  }
  for (const ev of EVENTS) {
    const e = cfg?.events?.[ev] || {};
    out.events[ev] = { whatsapp: !!e.whatsapp, sms: !!e.sms, email: !!e.email, text: e.text || DEFAULT_TEXT[ev] };
  }
  return out;
}

// GET /api/admin/client-notifications/:clientId
async function getConfig(req, res) {
  const client = await Client.findByPk(req.params.clientId, { attributes: ['id', 'clientCode', 'clientName'] });
  if (!client) return res.status(404).json({ message: 'Client not found' });
  const cfg = await ClientNotificationConfig.findOne({ where: { clientId: client.id } });
  return res.json({ client, config: masked(cfg), defaults: DEFAULT_TEXT, templateParams: TEMPLATE_PARAMS });
}

// PUT /api/admin/client-notifications/:clientId  { whatsapp, sms, email, events, usePlatformFallback }
async function saveConfig(req, res) {
  const client = await Client.findByPk(req.params.clientId, { attributes: ['id'] });
  if (!client) return res.status(404).json({ message: 'Client not found' });
  const existing = await ClientNotificationConfig.findOne({ where: { clientId: client.id } });
  const next = {};
  for (const ch of Object.keys(FIELDS)) {
    const incoming = req.body[ch] || {};
    const prev = existing?.[ch] || {};
    next[ch] = {};
    for (const f of FIELDS[ch]) {
      let v = incoming[f];
      if (f === 'enabled') { next[ch][f] = !!v; continue; }
      v = v == null ? '' : String(v).trim();
      // An empty secret box keeps the saved value; "-" clears it.
      if (SECRETS[ch].includes(f)) v = v === '' ? (prev[f] || '') : (v === '-' ? '' : v);
      next[ch][f] = v;
    }
  }
  // Light checks so a typo is caught here rather than when a patient's message fails.
  if (next.sms.url && !/^https?:\/\//i.test(next.sms.url)) return res.status(400).json({ message: 'SMS API URL must start with http:// or https://' });
  if (next.sms.headers) { try { JSON.parse(next.sms.headers); } catch { return res.status(400).json({ message: 'SMS headers must be JSON, e.g. {"authkey":"..."}' }); } }
  if (next.email.gmailAddress && !/^\S+@\S+\.\S+$/.test(next.email.gmailAddress)) return res.status(400).json({ message: 'Enter a valid Gmail address' });
  if (!['GET', 'POST'].includes((next.sms.method || 'GET').toUpperCase())) next.sms.method = 'GET';

  const events = {};
  for (const ev of EVENTS) {
    const e = (req.body.events || {})[ev] || {};
    // A channel switched off at the top never sends, whatever is ticked here.
    events[ev] = {
      whatsapp: !!e.whatsapp && next.whatsapp.enabled,
      sms: !!e.sms && next.sms.enabled,
      email: !!e.email && next.email.enabled,
      text: String(e.text || '').trim() || DEFAULT_TEXT[ev],
    };
  }
  const values = { ...next, events, usePlatformFallback: !!req.body.usePlatformFallback };
  if (existing) await existing.update(values);
  else await ClientNotificationConfig.create({ clientId: client.id, ...values });
  const saved = await ClientNotificationConfig.findOne({ where: { clientId: client.id } });
  return res.json({ message: 'Messaging settings saved', config: masked(saved) });
}

// POST /api/admin/client-notifications/:clientId/test  { channel: WHATSAPP|SMS|EMAIL, to }
async function testSend(req, res) {
  const channel = String(req.body.channel || '').toUpperCase();
  if (!['WHATSAPP', 'SMS', 'EMAIL'].includes(channel)) return res.status(400).json({ message: 'Choose WhatsApp, SMS or Email' });
  if (!String(req.body.to || '').trim()) return res.status(400).json({ message: channel === 'EMAIL' ? 'Enter an email address' : 'Enter a mobile number' });
  const result = await sendTest(Number(req.params.clientId), channel, String(req.body.to).trim());
  return res.json(result);
}

// GET /api/admin/client-notifications/:clientId/logs - the latest 100 attempts.
async function listLogs(req, res) {
  const rows = await NotificationLog.findAll({ where: { clientId: req.params.clientId }, order: [['id', 'DESC']], limit: 100 });
  return res.json(rows);
}

module.exports = { getConfig, saveConfig, testSend, listLogs };
