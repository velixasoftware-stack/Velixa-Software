const { Op } = require('sequelize');
const XLSX = require('xlsx');
const { Bill, BillItem, TestMaster, Sample, Report, Patient, Refund, BillDiscount, Result, ClientUser } = require('../models');

/** Sum of everything refunded on a bill - already cancelled & paid back, so it must
 * never be counted as still "outstanding"/due from the patient. */
function refundedTotal(bill) {
  return (bill.Refunds || []).reduce((sum, r) => sum + Number(r.amount), 0);
}

/** Sum of every post-billing discount on a bill - also money already handed
 * back, not still owed, for the same reason as a refund. */
function postDiscountTotal(bill) {
  return (bill.BillDiscounts || []).reduce((sum, d) => sum + Number(d.amount), 0);
}

/** Everything already given back on a bill (cancellation refunds + post-billing
 * discounts) - the amount that must be netted out of any "outstanding" figure. */
function givenBackTotal(bill) {
  return refundedTotal(bill) + postDiscountTotal(bill);
}

function dateKey(date, groupBy) {
  const d = new Date(date);
  if (groupBy === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return d.toISOString().slice(0, 10);
}

/**
 * A `to` date is inclusive of that whole calendar day, not just midnight.
 * Silently ignores an unparseable value (e.g. a stray "undefined" string
 * from a caller) instead of handing Postgres an invalid date and 500ing.
 */
function dateRangeWhere(from, to) {
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  const validFrom = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null;
  const validTo = toDate && !Number.isNaN(toDate.getTime()) ? toDate : null;
  if (!validFrom && !validTo) return {};

  const range = {};
  if (validFrom) range[Op.gte] = validFrom;
  if (validTo) {
    const end = new Date(validTo);
    end.setHours(23, 59, 59, 999);
    range[Op.lte] = end;
  }
  return { createdAt: range };
}

// GET /api/reports/transactions?from=&to=&groupBy=day|month
async function transactions(req, res) {
  const { clientId } = req.user;
  const { from, to, groupBy = 'day' } = req.query;

  const bills = await Bill.findAll({ where: { clientId, ...dateRangeWhere(from, to) }, order: [['createdAt', 'ASC']] });
  const grouped = {};
  for (const bill of bills) {
    const key = dateKey(bill.createdAt, groupBy);
    if (!grouped[key]) grouped[key] = { period: key, billCount: 0, totalAmount: 0 };
    grouped[key].billCount += 1;
    grouped[key].totalAmount += Number(bill.totalAmount);
  }

  return res.json(Object.values(grouped));
}

// GET /api/reports/collection-summary?from=&to=
async function collectionSummary(req, res) {
  const { clientId } = req.user;
  const { from, to } = req.query;
  const bills = await Bill.findAll({ where: { clientId, ...dateRangeWhere(from, to) }, include: [Refund, BillDiscount] });
  const totalBilled = bills.reduce((s, b) => s + Number(b.totalAmount), 0);
  const totalCollected = bills.reduce((s, b) => s + Number(b.paidAmount), 0);
  const totalRefunded = bills.reduce((s, b) => s + refundedTotal(b), 0);
  const totalPostDiscount = bills.reduce((s, b) => s + postDiscountTotal(b), 0);

  return res.json({
    billCount: bills.length,
    totalBilled,
    totalCollected,
    totalRefunded,
    totalPostDiscount,
    // A refund/post-billing discount is money already given back, not money
    // still owed - net both out so they never inflate "outstanding".
    outstanding: totalBilled - totalCollected - totalRefunded - totalPostDiscount,
  });
}

// GET /api/reports/outstanding?from=&to=
async function outstanding(req, res) {
  const { clientId } = req.user;
  const { from, to } = req.query;
  const bills = await Bill.findAll({
    where: { clientId, ...dateRangeWhere(from, to) },
    include: [Patient, Refund, BillDiscount],
    order: [['createdAt', 'DESC']],
  });
  const unpaid = bills
    .map((b) => {
      const givenBack = givenBackTotal(b);
      return {
        billNo: b.billNo,
        patient: b.Patient?.name,
        totalAmount: b.totalAmount,
        paidAmount: b.paidAmount,
        refundedAmount: refundedTotal(b),
        postDiscountAmount: postDiscountTotal(b),
        outstanding: Number(b.totalAmount) - Number(b.paidAmount) - givenBack,
        createdAt: b.createdAt,
      };
    })
    .filter((b) => b.outstanding > 0);
  return res.json(unpaid);
}

// GET /api/reports/lab-summary?from=&to=  (samples by status)
async function labSummary(req, res) {
  const { clientId } = req.user;
  const { from, to } = req.query;
  const samples = await Sample.findAll({ where: { clientId, ...dateRangeWhere(from, to) } });
  const summary = samples.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});
  return res.json({ total: samples.length, byStatus: summary });
}

// GET /api/reports/lab-details?from=&to=
async function labDetails(req, res) {
  const { clientId } = req.user;
  const { from, to } = req.query;
  const samples = await Sample.findAll({
    where: { clientId, ...dateRangeWhere(from, to) },
    include: [
      { model: BillItem, include: [TestMaster, { model: Bill, include: [Patient] }] },
      { model: Report, include: [{ model: ClientUser, as: 'ReleasedByUser', attributes: ['username'] }] },
      { model: Result, attributes: ['createdAt', 'createdBy'] },
    ],
    order: [['createdAt', 'DESC']],
    limit: 200,
  });

  // Full audit trail per sample - who did each step and when. Samples from
  // before these columns existed fall back to what was recorded at the time
  // (e.g. result entry = when its results were first saved).
  return res.json(samples.map((s) => {
    const firstResult = [...(s.Results || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
    const r = s.Report;
    const bill = s.BillItem?.Bill;
    return {
      barcode: s.barcode,
      testCode: s.BillItem?.TestMaster?.testCode,
      testName: s.BillItem?.TestMaster?.testName,
      billNo: bill?.billNo,
      patientName: bill?.Patient?.name,
      umr: bill?.Patient?.umr,
      status: s.status,
      itemStatus: s.BillItem?.status,
      reportStatus: r?.status,
      registeredAt: s.createdAt,
      registeredBy: s.createdBy,
      collectedAt: s.collectedAt,
      collectedBy: s.collectedBy,
      resultEnteredAt: s.resultEnteredAt || firstResult?.createdAt || null,
      resultEnteredBy: s.resultEnteredBy || firstResult?.createdBy || null,
      verifiedAt: r?.verifiedAt,
      verifiedBy: r?.verifiedBy,
      releasedAt: r?.releasedAt,
      releasedBy: r?.releasedBy || r?.ReleasedByUser?.username || null,
      revokedAt: r?.revokedAt,
      revokedBy: r?.revokedBy,
      revokedReason: r?.revokedReason,
      lastUpdatedAt: s.updatedAt,
      lastUpdatedBy: s.updatedBy,
    };
  }));
}

// GET /api/reports/test-wise-revenue?from=&to=
async function testWiseRevenue(req, res) {
  const { clientId } = req.user;
  const { from, to } = req.query;
  const items = await BillItem.findAll({
    include: [
      { model: TestMaster },
      { model: Bill, where: { clientId, ...dateRangeWhere(from, to) }, attributes: [] },
    ],
  });

  const grouped = {};
  for (const item of items) {
    const code = item.TestMaster.testCode;
    if (!grouped[code]) {
      grouped[code] = { testCode: code, testName: item.TestMaster.testName, count: 0, revenue: 0 };
    }
    grouped[code].count += 1;
    grouped[code].revenue += Number(item.price);
  }

  return res.json(Object.values(grouped));
}

// GET /api/reports/report-status?from=&to=
async function reportStatusCounts(req, res) {
  const { clientId } = req.user;
  const { from, to } = req.query;
  const samples = await Sample.findAll({ where: { clientId, ...dateRangeWhere(from, to) }, include: [Report] });
  const counts = { PENDING: 0, VERIFIED: 0, RELEASED: 0 };
  for (const s of samples) {
    if (s.Report) counts[s.Report.status] = (counts[s.Report.status] || 0) + 1;
  }
  return res.json(counts);
}

// GET /api/reports/export?from=&to=&groupBy=day|month  - everything on the
// Reports screen, as one workbook with a sheet per section.
async function exportReport(req, res) {
  const { clientId } = req.user;
  const { from, to, groupBy = 'day' } = req.query;
  const range = dateRangeWhere(from, to);

  const [bills, testItems, samplesWithReport] = await Promise.all([
    Bill.findAll({ where: { clientId, ...range }, include: [Patient, Refund, BillDiscount], order: [['createdAt', 'ASC']] }),
    BillItem.findAll({ include: [TestMaster, { model: Bill, where: { clientId, ...range }, attributes: [] }] }),
    Sample.findAll({ where: { clientId, ...range }, include: [Report] }),
  ]);

  const grouped = {};
  for (const bill of bills) {
    const key = dateKey(bill.createdAt, groupBy);
    if (!grouped[key]) grouped[key] = { period: key, billCount: 0, totalAmount: 0 };
    grouped[key].billCount += 1;
    grouped[key].totalAmount += Number(bill.totalAmount);
  }
  const transactionRows = Object.values(grouped).map((t) => ({ Period: t.period, 'Bill Count': t.billCount, 'Total Amount': t.totalAmount }));

  const totalRefunded = bills.reduce((s, b) => s + refundedTotal(b), 0);
  const totalPostDiscount = bills.reduce((s, b) => s + postDiscountTotal(b), 0);
  const summaryRows = [{
    'From Date': from || 'All time',
    'To Date': to || 'All time',
    Bills: bills.length,
    'Total Billed': bills.reduce((s, b) => s + Number(b.totalAmount), 0),
    'Total Collected': bills.reduce((s, b) => s + Number(b.paidAmount), 0),
    'Total Refunded': totalRefunded,
    'Total Post-Billing Discount': totalPostDiscount,
    Outstanding: bills.reduce((s, b) => s + Number(b.totalAmount) - Number(b.paidAmount) - givenBackTotal(b), 0),
  }];

  const outstandingRows = bills
    .map((b) => ({
      'Bill No': b.billNo,
      Patient: b.Patient?.name || '',
      'Total Amount': b.totalAmount,
      'Paid Amount': b.paidAmount,
      Refunded: refundedTotal(b),
      'Post-Billing Discount': postDiscountTotal(b),
      Outstanding: Number(b.totalAmount) - Number(b.paidAmount) - givenBackTotal(b),
    }))
    .filter((r) => r.Outstanding > 0);

  const revenueByTest = {};
  for (const item of testItems) {
    const code = item.TestMaster.testCode;
    if (!revenueByTest[code]) revenueByTest[code] = { testCode: code, testName: item.TestMaster.testName, count: 0, revenue: 0 };
    revenueByTest[code].count += 1;
    revenueByTest[code].revenue += Number(item.price);
  }
  const testRevenueRows = Object.values(revenueByTest).map((t) => ({
    'Test Code': t.testCode, 'Test Name': t.testName, Count: t.count, Revenue: t.revenue,
  }));

  const reportStatusRows = [{ PENDING: 0, VERIFIED: 0, RELEASED: 0 }];
  for (const s of samplesWithReport) {
    if (s.Report) reportStatusRows[0][s.Report.status] = (reportStatusRows[0][s.Report.status] || 0) + 1;
  }

  const labDetailsRows = await Sample.findAll({
    where: { clientId, ...range },
    include: [{ model: BillItem, include: [TestMaster] }, Report],
    order: [['createdAt', 'DESC']],
  }).then((samples) => samples.map((s) => ({
    Barcode: s.barcode,
    'Test Code': s.BillItem?.TestMaster?.testCode,
    'Test Name': s.BillItem?.TestMaster?.testName,
    'Sample Status': s.status,
    'Report Status': s.Report?.status || '',
    'Collected At': s.collectedAt,
  })));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(transactionRows), 'Transactions');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(testRevenueRows), 'Test-wise Revenue');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(outstandingRows), 'Outstanding');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(reportStatusRows), 'Report Status');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(labDetailsRows), 'Lab Details');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="reports-export.xlsx"');
  return res.send(buffer);
}

module.exports = {
  transactions, collectionSummary, outstanding, labSummary, labDetails, testWiseRevenue, reportStatusCounts, exportReport,
};
