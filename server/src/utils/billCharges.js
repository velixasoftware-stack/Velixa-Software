// What each test on a bill actually cost the patient. A bill-level discount
// (given at billing, plus any post-billing discount - both are in
// Bill.discount) and GST apply to the whole bill, so each test carries a share
// of them in proportion to its price:
//
//   bill charge = totalAmount - discount + taxAmount
//   test charge = bill charge x test price / totalAmount
//
// e.g. 50 + 280 + 300 = 630 with a 130 discount: the 280 test cost 222.22,
// not 280. Cancelling a test refunds at most its charge - never its list
// price - so the discount isn't left sitting on the remaining tests.

const round2 = (n) => Math.round(n * 100) / 100;

// Map of billItem id -> { charge, refunded, remaining }. Shares are rounded
// to paise with the rounding difference put on the last item, so they always
// add up exactly to the bill charge.
function itemCharges(bill, items) {
  const gross = Number(bill.totalAmount) || 0;
  const billCharge = Math.max(0, gross - Number(bill.discount || 0) + Number(bill.taxAmount || 0));
  const out = new Map();
  let allocated = 0;
  items.forEach((item, i) => {
    const price = Number(item.price) || 0;
    const charge = i === items.length - 1
      ? round2(billCharge - allocated)
      : round2(gross > 0 ? billCharge * price / gross : 0);
    allocated = round2(allocated + charge);
    const refunded = round2((item.Refunds || []).reduce((s, r) => s + Number(r.amount), 0));
    out.set(item.id, { charge, refunded, remaining: round2(Math.max(0, charge - refunded)) });
  });
  return out;
}

// For cancelling one test: its unrefunded charge first comes off whatever the
// patient still owes on the bill, and only the rest - never more than the
// money actually collected - can be refunded.
function cancellationSplit(bill, itemCharge) {
  const due = Number(bill.dueAmount) || 0;
  const paid = Number(bill.paidAmount) || 0;
  const fromDue = round2(Math.min(due, itemCharge.remaining));
  const maxRefund = round2(Math.max(0, Math.min(itemCharge.remaining - fromDue, paid)));
  return { fromDue, maxRefund };
}

// Bill JSON plus, per item, its charge and what cancelling it now would do,
// and the discount/charge belonging to the still-active tests - what the
// receipt and Edit Order show once some tests are cancelled.
function withCharges(bill) {
  const json = bill.toJSON ? bill.toJSON() : bill;
  const items = json.BillItems || [];
  const charges = itemCharges(json, items);
  const gross = Number(json.totalAmount) || 0;
  let activeGross = 0;
  let activeCharge = 0;
  for (const item of items) {
    const c = charges.get(item.id);
    item.charge = c.charge;
    if (item.status === 'ACTIVE') {
      Object.assign(item, cancellationSplit(json, c));
      activeGross += Number(item.price) || 0;
      activeCharge += c.charge;
    }
  }
  json.activeGross = round2(activeGross);
  json.activeDiscount = round2(gross > 0 ? Number(json.discount || 0) * activeGross / gross : 0);
  json.activeTax = round2(gross > 0 ? Number(json.taxAmount || 0) * activeGross / gross : 0);
  json.activeCharge = round2(activeCharge);
  return json;
}

module.exports = { itemCharges, cancellationSplit, withCharges, round2 };
