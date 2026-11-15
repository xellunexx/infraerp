import test from 'node:test';
import assert from 'node:assert/strict';
import { priceLine, summarize, validUntil } from '../server/pricing.js';

// Expected values are worked out by hand from the formulas in the Excel template (see OFFER_TEMPLATE_NOTES.md).
test('price model matches the Excel template formulas', () => {
  // GreenSet TOUR COURT line: I=6.40, J=2.00, L(install)=9.26 -> N=17.66, O=0.6181, S=5.298, U=0.5298, V=24.1059
  const g = priceLine({ qty: 648, material_cost: 6.4, delivery_cost: 2, install_cost: 9.26, overhead_pct: 3.5, profit_pct: 30, tax_pct: 10 });
  assert.equal(g.unit_price, 24.11);
  assert.equal(g.total, 15623.28);
  assert.equal(g.cost_total, 11844.21);           // Q = N*F + O*F = 11443.68 + 400.5288
  // Padel structure line: I=16400, J=2500, L=15 man-days x M=240 -> O=22500, P=787.5, T=6750, V=675, W=30712.5
  const p = priceLine({ qty: 1, material_cost: 16400, delivery_cost: 2500, labour_days: 15, day_rate: 240, overhead_pct: 3.5, profit_pct: 30, tax_pct: 10 });
  assert.equal(p.direct, 22500); assert.equal(p.overhead, 787.5); assert.equal(p.profit, 6750); assert.equal(p.tax, 675);
  assert.equal(p.unit_price, 30712.5);
  // Retop uses 2 % overhead: O=10 -> P=0.2, T=3, V=0.3, W=13.5
  assert.equal(priceLine({ qty: 1, material_cost: 10, overhead_pct: 2, profit_pct: 30, tax_pct: 10 }).unit_price, 13.5);
  // SBR tiles: unit price typed by hand (12.52 + 2.56 + 7.67) overrides the calculation
  const m = priceLine({ qty: 400, material_cost: 5, manual_price: 22.75 });
  assert.equal(m.unit_price, 22.75); assert.equal(m.manual, true); assert.equal(m.total, 9100);
});

test('alternative sections are not added to the offer total; validity is date + N months', () => {
  const sections = [{ id: 1, alternative: 0 }, { id: 2, alternative: 1 }, { id: 3, alternative: 1 }];
  const lines = [{ section_id: 1, qty: 10, manual_price: 100 }, { section_id: null, qty: 1, manual_price: 50 }, { section_id: 2, qty: 1, manual_price: 1000 }, { section_id: 3, qty: 1, manual_price: 2000 }];
  const s = summarize(lines, sections, 20);
  assert.equal(s.net, 1050); assert.equal(s.vat, 210); assert.equal(s.total_with_vat, 1260);
  assert.deepEqual(s.sections.map(x => x.net), [1000, 1000, 2000]);
  assert.equal(summarize(lines, sections, 20, 10).net, 945);
  assert.equal(validUntil('2026-11-15', 1), '2026-12-15');
  assert.equal(validUntil('2026-01-31', 1), '2026-02-28');
  assert.equal(validUntil('2026-11-30', 3), '2027-02-28');
});