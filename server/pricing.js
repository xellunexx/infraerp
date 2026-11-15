// Offer price model taken from the company's Excel offer template (see OFFER_TEMPLATE_NOTES.md).
// Per unit:  O = material + delivery + labour      labour = install_cost, or labour_days x day_rate
//            P = O x overhead %      T = O x profit %      V = T x corporate tax %
//            W = O + P + T + V  -> unit price to the customer, rounded to 2 decimals (a manual price overrides it)
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = n => Math.round((n + Number.EPSILON) * 10000) / 10000;
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export const PRICING_DEFAULTS = { overhead_pct: 3.5, profit_pct: 30, tax_pct: 10 };

export function priceLine(l, defaults = PRICING_DEFAULTS) {
  const material = n(l.material_cost), delivery = n(l.delivery_cost);
  const hasInstall = l.install_cost !== null && l.install_cost !== undefined && l.install_cost !== '';
  const labour = hasInstall ? n(l.install_cost) : n(l.labour_days) * n(l.day_rate);
  const overheadPct = l.overhead_pct ?? defaults.overhead_pct, profitPct = l.profit_pct ?? defaults.profit_pct, taxPct = l.tax_pct ?? defaults.tax_pct;
  const direct = material + delivery + labour;
  const overhead = direct * n(overheadPct) / 100;
  const profit = direct * n(profitPct) / 100;
  const tax = profit * n(taxPct) / 100;
  const calculated = r2(direct + overhead + profit + tax);
  const manual = l.manual_price !== null && l.manual_price !== undefined && l.manual_price !== '';
  const unit_price = manual ? r2(n(l.manual_price)) : calculated;
  const qty = n(l.qty);
  return {
    labour: r4(labour), direct: r4(direct), overhead: r4(overhead), profit: r4(profit), tax: r4(tax), calculated_price: calculated, unit_price, manual,
    unit_cost: r4(direct + overhead),                       // Себест-ст per unit (O + P)
    total: r2(qty * unit_price),                            // H = F x G
    delivery_total: r2(delivery * qty), labour_total: r2(labour * qty), overhead_total: r2(overhead * qty),
    cost_total: r2((direct + overhead) * qty),              // R = O x F + Q
    profit_total: r2(profit * qty), tax_total: r2(tax * qty),
  };
}

/** Sections that are alternatives carry their own totals and are not added to the offer total. */
export function summarize(lines, sections, vatPct, discountPct = 0) {
  const alt = new Set(sections.filter(s => s.alternative).map(s => s.id));
  const sum = rows => { const t = { net: 0, cost: 0, profit: 0, tax: 0 }; for (const l of rows) { const p = priceLine(l); t.net += p.total; t.cost += p.cost_total; t.profit += p.profit_total; t.tax += p.tax_total; } return t; };
  const wrap = t => { const net = r2(t.net * (1 - n(discountPct) / 100)); return { gross: r2(t.net), net, cost: r2(t.cost), profit: r2(t.profit), corporate_tax: r2(t.tax), margin: r2(net - t.cost),
    vat_pct: n(vatPct), vat: r2(net * n(vatPct) / 100), total_with_vat: r2(net * (1 + n(vatPct) / 100)) }; };
  const bySection = sections.map(s => ({ section_id: s.id, alternative: !!s.alternative, ...wrap(sum(lines.filter(l => l.section_id === s.id))) }));
  return { ...wrap(sum(lines.filter(l => !alt.has(l.section_id)))), sections: bySection };
}

/** Валидна до = offer date + N months (Excel EDATE). */
export function validUntil(offerDate, months) {
  if (!offerDate) return null;
  const d = new Date(offerDate + 'T00:00:00Z'), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + Math.max(0, Math.round(n(months))));
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}
export const round2 = r2;