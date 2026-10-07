/** Consistent 2-decimal money formatting - avoids mixing "550.00" (from a
 * Sequelize DECIMAL field, which serializes as a string) with "550" (from a
 * plain JS number computed on the client) in the same table. */
export function formatMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

const SHORT_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Formats a date as "13-SEP-2026". */
export function formatDateDMY(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}-${SHORT_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}
