import { numberToWords } from '../utils/numberToWords';

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// The printable Bill/Receipt layout - shared verbatim between Front Desk
// (right after a bill is generated) and Orders' "Print Bill" button, so the
// two can never drift into different-looking receipts again.
export default function BillReceiptSheet({ bill }) {
  const totalRefunded = bill.BillItems.reduce(
    (sum, item) => sum + (item.Refunds || []).reduce((s, r) => s + Number(r.amount), 0), 0,
  );
  const totalPostDiscount = (bill.BillDiscounts || []).reduce((sum, d) => sum + Number(d.amount), 0);
  // The net amount this bill was ever meant to collect - paid-so-far plus
  // whatever's still due - independent of how paidAmount has shifted since
  // (a due payment, a refund, a post-billing discount all move paidAmount
  // without changing what the bill was originally billed for).
  const netAmount = Number(bill.paidAmount) + Number(bill.dueAmount);
  // Branding details (set from Report Branding) are what's shown on a bill -
  // deliberately separate from the clientName/address/mobile/email Chief
  // Admin set at client creation, falling back to those only until this
  // client has set its own.
  const brandName = bill.Client?.brandingName || bill.Client?.clientName;
  const brandContact = [
    bill.Client?.brandingAddress || bill.Client?.address,
    bill.Client?.brandingMobile || bill.Client?.mobile,
    bill.Client?.brandingEmail || bill.Client?.email,
  ].filter(Boolean).join(' · ');

  return (
    <div className="report-sheet bill-receipt">
      <div className="bill-receipt-box">
        <div className="bill-receipt-header">
          <div className="bill-receipt-logo">
            {bill.Client?.reportLogoPath
              ? <img src={bill.Client.reportLogoPath} alt="Logo" />
              : <div className="bill-receipt-logo-fallback">{brandName}</div>}
            {bill.Client && <p className="bill-receipt-client-contact">{brandContact}</p>}
          </div>
          <div className="bill-receipt-info">
            <div><span>Name</span><strong>{bill.Patient?.name}</strong></div>
            <div><span>Bill No</span><strong>{bill.billNo}</strong></div>
            <div><span>Umr No</span><strong>{bill.Patient?.umr}</strong></div>
            <div><span>Reg.Date</span><strong>{formatDateTime(bill.createdAt)}</strong></div>
            <div><span>Age/Gender</span><strong>{bill.Patient?.age ?? '—'} {bill.Patient?.ageUnit || 'Years'} / {bill.Patient?.gender || '—'}</strong></div>
            <div><span>Ref.By</span><strong>{bill.ReferralDoctor?.name ? `Dr. ${bill.ReferralDoctor.name}` : '-'}</strong></div>
            <div><span>Client Name</span><strong>{bill.Payor?.name || '-'}</strong></div>
            <div><span>Mobile No</span><strong>{bill.Patient?.mobile || '—'}</strong></div>
          </div>
        </div>

        <h3 className="bill-receipt-title">Bill Cum Receipt</h3>

        <table className="bill-receipt-table">
          <thead><tr><th>S.No</th><th>Service Name</th><th>Barcode</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {bill.BillItems.map((item, i) => {
              const refunded = (item.Refunds || []).reduce((sum, r) => sum + Number(r.amount), 0);
              return (
                <tr key={item.id}>
                  <td>{i + 1}</td>
                  <td style={item.status === 'CANCELLED' ? { textDecoration: 'line-through', color: '#94a3b8' } : undefined}>
                    {item.TestMaster?.testName}
                  </td>
                  <td>{item.Sample?.barcode}</td>
                  <td>₹{item.price}</td>
                  <td>
                    {item.status === 'CANCELLED' ? 'Cancelled' : 'Active'}
                    {refunded > 0 && ` (₹${refunded.toFixed(2)} refunded)`}
                  </td>
                </tr>
              );
            })}
            <tr className="bill-receipt-total-row">
              <td colSpan={3}>Total</td>
              <td colSpan={2}>₹{bill.totalAmount}</td>
            </tr>
          </tbody>
        </table>

        <div className="bill-receipt-footer">
          {Number(bill.paidAmount) > 0 && (
            <p className="bill-receipt-words">
              Received with thanks from {bill.Patient?.name} a sum of ₹{bill.paidAmount}/-
              <br />
              <strong>{numberToWords(bill.paidAmount).toUpperCase()} ONLY</strong>
              <br />
              Payment Mode: <strong>{bill.paymentMode || (bill.Payor ? 'Credit (billed to payor)' : '—')}</strong>
            </p>
          )}

          <div className="bill-receipt-summary">
            {Number(bill.discount) > 0 && <div><span>Discount</span><strong>₹{bill.discount}</strong></div>}
            {Number(bill.taxAmount) > 0 && (
              <>
                <div><span>CGST ({Number(bill.gstPercent) / 2}%)</span><strong>₹{bill.cgstAmount}</strong></div>
                <div><span>SGST ({Number(bill.gstPercent) / 2}%)</span><strong>₹{bill.sgstAmount}</strong></div>
              </>
            )}
            {totalRefunded > 0 && <div><span>Cancelled / Refunded</span><strong>₹{totalRefunded.toFixed(2)}</strong></div>}
            {totalPostDiscount > 0 && <div><span>Post-Billing Discount</span><strong>₹{totalPostDiscount.toFixed(2)}</strong></div>}
            <div className="bill-receipt-net"><span>Net Amount</span><strong>₹{netAmount.toFixed(2)}</strong></div>
            <div><span>Paid Amount</span><strong>₹{bill.paidAmount}</strong></div>
            {Number(bill.dueAmount) > 0 && (
              <div className="bill-receipt-due"><span>Due Amount</span><strong>₹{bill.dueAmount}</strong></div>
            )}
            <div><span>Payment Mode</span><strong>{bill.paymentMode || (bill.Payor ? 'Credit (billed to payor)' : '—')}</strong></div>
            {bill.transactionNumber && <div><span>Transaction No</span><strong>{bill.transactionNumber}</strong></div>}
          </div>
        </div>
      </div>

      {bill.remarks && <p style={{ marginTop: 12 }}><strong>Remarks:</strong> {bill.remarks}</p>}
    </div>
  );
}
