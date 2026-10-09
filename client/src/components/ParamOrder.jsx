import { useState } from 'react';
import api from '../api/client';

/**
 * "Order" cell for a test's parameter table: its position number plus ▲/▼ to
 * move it. Saves the whole new order to `${apiBase}/tests/:testId/parameter-order`
 * - result entry and the printed report list parameters in this order.
 */
export default function ParamOrder({ apiBase, testId, params, index, onSaved }) {
  const [saving, setSaving] = useState(false);

  async function move(dir) {
    const to = index + dir;
    if (to < 0 || to >= params.length || saving) return;
    const ids = params.map((p) => p.id);
    [ids[index], ids[to]] = [ids[to], ids[index]];
    setSaving(true);
    try {
      await api.put(`${apiBase}/tests/${testId}/parameter-order`, { parameterIds: ids });
      await onSaved?.();
    } catch (err) {
      window.alert(err.response?.data?.message || 'Could not save the parameter order');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="param-order">
      <span className="param-order-no">{index + 1}</span>
      <button type="button" className="param-order-btn" title="Move up" disabled={index === 0 || saving} onClick={() => move(-1)}>▲</button>
      <button type="button" className="param-order-btn" title="Move down" disabled={index === params.length - 1 || saving} onClick={() => move(1)}>▼</button>
    </div>
  );
}
