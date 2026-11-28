const PDFDocument = require('pdfkit');
const { StoredFile } = require('../models');

/**
 * The released lab report as a PDF (A4), built on the server so it can be
 * sent on WhatsApp / email and downloaded from the patient's report link.
 * Mirrors the printed report (client/src/pages/Lab/LabReport.jsx): the lab's
 * letterhead (a full A4 page as each page's background, or a header strip),
 * the patient details box on every page, each service group's name, tests
 * with Parameter | Result | Bio. Ref. Interval | Method (abnormal in red),
 * interpretation / sample type / remarks, signatures and page numbers.
 */

const MM = 72 / 25.4;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const SIDE = 12 * MM;
const IST_OFFSET_MS = 330 * 60 * 1000;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DARK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';

function fmtDateTime(d) {
  if (!d) return '—';
  const t = new Date(new Date(d).getTime() + IST_OFFSET_MS);
  const h = t.getUTCHours();
  const hh = String(((h + 11) % 12) + 1).padStart(2, '0');
  return `${String(t.getUTCDate()).padStart(2, '0')}-${MONTHS[t.getUTCMonth()]}-${t.getUTCFullYear()} ${hh}:${String(t.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
const doctorLabel = (n) => {
  const s = String(n || '').trim();
  if (!s || /^(dr\.?\s*)?self$/i.test(s)) return 'Self';
  return /^dr\b\.?/i.test(s) ? s : `Dr. ${s}`;
};
const rangeLabel = (p) => {
  if (p.normalRangeText && String(p.normalRangeText).trim()) return String(p.normalRangeText);
  const has = p.normalRangeLow != null && p.normalRangeLow !== '' && p.normalRangeHigh != null && p.normalRangeHigh !== '';
  return has ? `${p.normalRangeLow} - ${p.normalRangeHigh}` : '';
};
/** Range with the unit after each line that ends in a number (as the printed report). */
function rangeWithUnit(p) {
  const range = rangeLabel(p);
  const unit = String(p.unit || '').trim();
  if (!unit) return range || '—';
  if (!range) return unit;
  return range.split('\n').map((l) => (/\d\s*$/.test(l) && !l.includes(unit) ? `${l.trimEnd()} ${unit}` : l)).join('\n');
}
const hasValue = (p) => p.value != null && String(p.value).trim() !== '';

/** A stored upload ("/uploads/<path>?v=...") as image bytes, if PDFKit can draw it (PNG / JPEG). */
async function loadImage(url) {
  if (!url) return null;
  const rel = decodeURIComponent(String(url).replace(/^.*\/uploads\//, '').replace(/\?.*$/, ''));
  if (!rel || rel.includes('..')) return null;
  const file = await StoredFile.findOne({ where: { path: rel } });
  if (!file?.data) return null;
  const buf = Buffer.from(file.data);
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  return isPng || isJpg ? buf : null;
}

async function buildReportPdf(report) {
  const { patient, client, bill } = report;
  const groups = report.groups || [{ name: null, tests: report.tests, doctor: report.doctor }];
  const tests = groups.flatMap((g) => g.tests);
  const collectedAt = tests.map((t) => t.collectedAt).filter(Boolean).sort()[0];
  const releasedAt = tests.map((t) => t.releasedAt).filter(Boolean).sort().slice(-1)[0];

  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `Lab Report ${bill.billNo}`, Author: client.clientName } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Letterhead: a portrait image is a whole page (drawn behind each page, the
  // report fits between its header and footer); a wide one is a header strip.
  const letterhead = await loadImage(client.letterheadUrl);
  let fullPage = false;
  let stripH = 0;
  if (letterhead) {
    const img = doc.openImage(letterhead);
    fullPage = img.height / img.width >= 1;
    if (!fullPage) stripH = Math.min(150, (PAGE_W - 2 * SIDE) * (img.height / img.width));
  }
  const topMargin = fullPage ? (Number(client.letterheadTopMm) || 45) * MM : (letterhead ? 4 * MM + stripH + 8 : 14 * MM + 34);
  const bottomMargin = fullPage ? (Number(client.letterheadBottomMm) || 25) * MM : 14 * MM;
  const usableBottom = PAGE_H - bottomMargin - 14; // keep room for the page number

  const sigCache = new Map();
  const signature = async (url) => {
    if (!sigCache.has(url)) sigCache.set(url, await loadImage(url));
    return sigCache.get(url);
  };

  let y = 0;
  const pageDecor = () => {
    if (letterhead && fullPage) doc.image(letterhead, 0, 0, { width: PAGE_W, height: PAGE_H });
    else if (letterhead) doc.image(letterhead, SIDE, 4 * MM, { width: PAGE_W - 2 * SIDE, height: stripH });
    else {
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(15).text(client.clientName || '', SIDE, 12 * MM, { width: PAGE_W - 2 * SIDE });
      const line = [client.address, client.mobile, client.email].filter(Boolean).join(' · ');
      if (line) doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(line, SIDE, doc.y + 2, { width: PAGE_W - 2 * SIDE });
    }
    y = topMargin;
    // Patient details box - two columns, as on the printed report.
    const rows = [
      ['Patient Name', `${patient?.title ? `${patient.title} ` : ''}${patient?.name || ''}`, 'Order ID', bill.billNo],
      ['Age / Gender', `${patient?.age ? `${patient.age} ${patient.ageUnit === 'Months' ? 'Mths' : patient.ageUnit === 'Days' ? 'Days' : 'Yrs'}` : '—'} / ${patient?.gender || '—'}`, 'Order Date', fmtDateTime(bill.createdAt)],
      ['UMR', patient?.umr || '—', 'Collection Date', fmtDateTime(collectedAt)],
      ['Referred By', doctorLabel(bill.referredDoctor), 'Report Date', fmtDateTime(releasedAt)],
    ];
    const boxH = rows.length * 13 + 8;
    doc.save().roundedRect(SIDE, y, PAGE_W - 2 * SIDE, boxH, 4).fillOpacity(0.85).fill('#ffffff').restore();
    doc.roundedRect(SIDE, y, PAGE_W - 2 * SIDE, boxH, 4).lineWidth(0.6).strokeColor(LINE).stroke();
    const colW = (PAGE_W - 2 * SIDE) / 2;
    rows.forEach((r, i) => {
      const ry = y + 5 + i * 13;
      [[r[0], r[1], 0], [r[2], r[3], 1]].forEach(([label, value, c]) => {
        const x = SIDE + 8 + c * colW;
        doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(label, x, ry, { width: 80, lineBreak: false });
        doc.text(':', x + 80, ry, { lineBreak: false });
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(8.5).text(String(value), x + 88, ry, { width: colW - 100, lineBreak: false, ellipsis: true });
      });
    });
    y += boxH + 8;
  };
  const newPage = () => { doc.addPage(); pageDecor(); };
  const ensure = (h) => { if (y + h > usableBottom) { newPage(); return true; } return false; };

  // Columns: Parameter | Result | Bio. Ref. Interval | Method (34 / 16 / 28 / 22 %)
  const tw = PAGE_W - 2 * SIDE;
  const cols = [{ x: SIDE, w: tw * 0.34 }, { x: SIDE + tw * 0.34, w: tw * 0.16 }, { x: SIDE + tw * 0.5, w: tw * 0.28 }, { x: SIDE + tw * 0.78, w: tw * 0.22 }];
  const tableHead = () => {
    doc.save().rect(SIDE, y, tw, 15).fill('#f8fafc').restore();
    ['Parameter', 'Result', 'Bio. Ref. Interval', 'Method'].forEach((h, i) => doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(h, cols[i].x + 5, y + 4, { width: cols[i].w - 8 }));
    y += 16;
  };
  const testTitle = (name, contd) => {
    doc.save().roundedRect(SIDE, y, tw, 18, 3).fill('#f1f5f9').restore();
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text(contd ? `${name} (contd.)` : name, SIDE + 7, y + 5, { width: tw - 14 });
    y += 21;
  };
  const textHeight = (text, font, size, width) => { doc.font(font).fontSize(size); return doc.heightOfString(String(text || ''), { width }); };

  pageDecor();
  for (let gi = 0; gi < groups.length; gi += 1) {
    const g = groups[gi];
    if (gi > 0) newPage(); // each service group on its own page, as printed
    if (g.name) {
      ensure(30);
      doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(12).text(String(g.name).toUpperCase(), SIDE, y, { width: tw, align: 'center' });
      y = doc.y + 3;
      doc.moveTo(SIDE, y).lineTo(PAGE_W - SIDE, y).lineWidth(1.4).strokeColor('#1e3a8a').stroke();
      y += 8;
    }
    for (const t of g.tests) {
      const rows = (t.parameters || []).filter((p) => !p.isInterpretation && hasValue(p));
      const notes = (t.parameters || []).filter((p) => p.isInterpretation && hasValue(p));
      // Title + head + first row stay together.
      ensure(21 + 16 + 18);
      testTitle(t.testName, false);
      if (rows.length) tableHead();
      for (const p of rows) {
        const cells = [p.parameterName, String(p.value), rangeWithUnit(p), p.method || '—'];
        const h = Math.max(...cells.map((c, i) => textHeight(c, i === 1 && p.isAbnormal ? 'Helvetica-Bold' : 'Helvetica', i === 3 ? 8.5 : 9, cols[i].w - 8))) + 7;
        if (ensure(h)) { testTitle(t.testName, true); tableHead(); }
        cells.forEach((c, i) => {
          const abnormal = i === 1 && p.isAbnormal;
          doc.fillColor(abnormal ? '#b91c1c' : (i === 3 ? '#475569' : DARK)).font(abnormal ? 'Helvetica-Bold' : 'Helvetica').fontSize(i === 3 ? 8.5 : 9)
            .text(c, cols[i].x + 5, y + 3.5, { width: cols[i].w - 8 });
        });
        y += h;
        doc.moveTo(SIDE, y).lineTo(PAGE_W - SIDE, y).lineWidth(0.5).strokeColor(LINE).stroke();
      }
      const block = (label, body, color = DARK) => {
        const h = textHeight(body, 'Helvetica', 9, tw) + 16;
        if (ensure(h)) testTitle(t.testName, true);
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9).text(label, SIDE, y + 4, { width: tw });
        doc.fillColor(color).font('Helvetica').fontSize(9).text(String(body), SIDE, doc.y + 1, { width: tw });
        y = doc.y + 4;
      };
      notes.forEach((p) => block(p.parameterName, p.value));
      if (t.sampleType && String(t.sampleType).trim()) {
        ensure(14);
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9).text(`Sample Type: ${t.sampleType}`, SIDE, y + 4, { width: tw });
        y = doc.y + 2;
      }
      if (t.interpretation) block('Interpretation', t.interpretation, '#475569');
      if (t.remarks && String(t.remarks).trim()) block('Remarks', t.remarks);
      y += 8;
    }
    // The group's signature, bottom right of its last page section.
    if (g.doctor) {
      const img = await signature(g.doctor.signatureUrl); // eslint-disable-line no-await-in-loop
      const h = (img ? 40 : 0) + 34;
      ensure(h + 10);
      const x = PAGE_W - SIDE - 170;
      y += 8;
      if (img) { try { doc.image(img, x + 35, y, { fit: [100, 38], align: 'center' }); } catch { /* unreadable signature image */ } y += 40; }
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11).text(g.doctor.name || '', x, y, { width: 170, align: 'center' });
      if (g.doctor.designation) doc.fillColor('#475569').font('Helvetica').fontSize(9.5).text(g.doctor.designation, x, doc.y + 1, { width: 170, align: 'center' });
      y = doc.y + 6;
    }
  }
  const disclaimer = 'This is a system-generated report. Values in red are outside the normal reference range. Please correlate clinically.';
  ensure(24);
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(disclaimer, SIDE, y + 8, { width: tw });

  // Page numbers.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.fillColor('#94a3b8').font('Helvetica').fontSize(8).text(`Page ${i + 1} of ${range.count}`, SIDE, PAGE_H - bottomMargin - 10, { width: tw, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}

module.exports = { buildReportPdf };
