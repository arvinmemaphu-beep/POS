/* ---------- Monthly sales report ---------- */
// Consignment sales are already saved as normal sales when a consignment is settled,
// so this report is built from the sales + sale_items tables and nothing is double counted.
function canSeeReport(){ return true; } // Report tab is visible to every role
function defaultReportMonth(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}
function reportRange(){
  const parts = (state.reportMonth || defaultReportMonth()).split('-').map(Number);
  return { y: parts[0], m: parts[1], start: new Date(parts[0], parts[1]-1, 1), end: new Date(parts[0], parts[1], 1) };
}
function reloadReportTab(){
  if(state.tab === 'expenses'){
    if(!state.salesYear || state.salesYear.year !== reportRange().y) fetchExpenses(); else render();
  }else fetchReport();
}
// Sales totals (only created_at + total) for a whole year, split per month and per day. Used by the charts on both reports.
async function loadSalesYear(y){
  const ys = encodeURIComponent(new Date(y, 0, 1).toISOString()), ye = encodeURIComponent(new Date(y + 1, 0, 1).toISOString());
  const months = new Array(12).fill(0), days = {}, step = 1000;
  for(let from = 0; ; from += step){
    const res = await fetch(`${state.supaUrl}/rest/v1/sales?select=created_at,total&created_at=gte.${ys}&created_at=lt.${ye}${notVoidedQ()}&order=created_at.asc`,
      { headers: Object.assign({}, supaHeaders(), { 'Range-Unit':'items', 'Range': `${from}-${from+step-1}` }) });
    if(!res.ok) throw new Error('Failed to load yearly sales');
    const rows = await res.json();
    rows.forEach(x=>{
      const d = new Date(x.created_at), t = Number(x.total) || 0, k = (d.getMonth() + 1) + '-' + d.getDate();
      months[d.getMonth()] += t;
      days[k] = (days[k] || 0) + t;
    });
    if(rows.length < step) break;
  }
  return { year: y, months, days };
}
// Every ledger entry that has an Out amount (all time), excluding cash deposits (see Settings SQL);
// the reports filter by month/year in the browser.
async function loadExpenseEntries(){
  const all = [], step = 1000;
  for(let from = 0; ; from += step){
    const res = await fetch(`${state.supaUrl}/rest/v1/ledger_entries?select=*&amount_out=gt.0&order=created_at.asc`,
      { headers: Object.assign({}, supaHeaders(), { 'Range-Unit':'items', 'Range': `${from}-${from+step-1}` }) });
    if(!res.ok) throw new Error('Failed to load expenses');
    const rows = await res.json();
    all.push(...rows);
    if(rows.length < step) break;
  }
  return all.filter(e => !e.is_deposit && !e.is_transfer && !e.voided); // voided entries are not expenses
}
function shiftReportMonth(delta){
  const r = reportRange();
  const d = new Date(r.y, r.m-1+delta, 1);
  state.reportMonth = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  reloadReportTab();
}
async function fetchReport(){
  if(!state.connected) return;
  if(!state.reportMonth) state.reportMonth = defaultReportMonth();
  const token = state.reportMonth;
  const r = reportRange();
  const range = (col)=> `${col}=gte.${encodeURIComponent(r.start.toISOString())}&${col}=lt.${encodeURIComponent(r.end.toISOString())}`;
  state.reportLoading = true; render();
  try{
    const all = [];
    const step = 1000;
    for(let from = 0; ; from += step){
      const res = await fetch(`${state.supaUrl}/rest/v1/sales?select=created_at,total,sale_items(${saleItemCols()})&${range('created_at')}${notVoidedQ()}&order=created_at.asc`,
        { headers: Object.assign({}, supaHeaders(), { 'Range-Unit':'items', 'Range': `${from}-${from+step-1}` }) });
      if(!res.ok) throw new Error('Failed to load sales');
      const rows = await res.json();
      all.push(...rows);
      if(rows.length < step) break;
    }
    let consign = [];
    try{
      const cRes = await fetch(`${state.supaUrl}/rest/v1/consignments?select=*,consignment_items(*)&status=eq.closed&${range('settled_at')}`, { headers: supaHeaders() });
      if(cRes.ok) consign = await cRes.json();
    }catch(e){ /* consignment note is optional */ }
    let salesYear = null, expenses = state.expenseEntries;
    try{ salesYear = await loadSalesYear(r.y); }catch(e){ /* the year chart is optional */ }
    if(state.ledgerReady){ try{ expenses = await loadExpenseEntries(); }catch(e){ /* expenses are optional here */ } }
    if(token !== state.reportMonth) return; // month changed while loading
    state.salesYear = salesYear;
    state.reportYearTotals = salesYear ? salesYear.months : [];
    state.expenseEntries = expenses;
    state.reportSales = all;
    state.reportConsign = consign;
  }catch(e){
    showToast('Could not load report: ' + e.message, true);
  }
  state.reportLoading = false; render();
}
function computeReport(){
  const days = {}, prods = {}, freebies = [];
  let total = 0, freeQty = 0;
  state.reportSales.forEach(s=>{
    const t = Number(s.total) || 0;
    total += t;
    const day = new Date(s.created_at).getDate();
    days[day] = (days[day] || 0) + t;
    (s.sale_items || []).forEach(i=>{
      const name = (i.product_name || '').trim() || '(no name)';
      const key = name.toLowerCase();
      const p = prods[key] || (prods[key] = { name, qty:0, revenue:0 });
      const q = Number(i.qty) || 0;
      if(i.is_free){
        p.free = (p.free || 0) + q; freeQty += q;
        freebies.push({ date: new Date(s.created_at), name, qty: q, remarks: (i.free_remarks || '').trim() });
        return;
      }
      p.qty += q;
      p.revenue += (Number(i.price) || 0) * q;
    });
  });
  const count = state.reportSales.filter(s => (Number(s.total) || 0) > 0).length; // paid sales only; all-free sales are listed under Freebies
  freebies.sort((a,b)=> a.date - b.date);
  const products = Object.values(prods).sort((a,b)=> b.revenue - a.revenue);
  let bestDay = null;
  Object.keys(days).forEach(d=>{ if(!bestDay || days[d] > days[bestDay]) bestDay = d; });
  const consignValue = state.reportConsign.reduce((sum,c)=>
    sum + (c.consignment_items || []).reduce((x,i)=> x + consignUnitPrice(i, c) * (i.qty_sold || 0), 0), 0);
  return { total, count, avg: count ? total / count : 0, days, products, bestDay, consignCount: state.reportConsign.length, consignValue, freebies, freeQty };
}
function reportMonthLabel(){
  const r = reportRange();
  return new Date(r.y, r.m-1, 1).toLocaleDateString(undefined, { month:'long', year:'numeric' });
}
function niceCeil(v){
  if(v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}
function compactNum(n){ return n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(Math.round(n)); }
function hasSeries(o){ return !!o && Object.values(o).some(v => v > 0); }
function chartLegend(){
  return '<div class="rc-legend"><span><i class="sw" style="background:var(--gold)"></i>Sales</span><span><i class="sw" style="background:var(--neg, var(--red))"></i>Expenses</span></div>';
}
function chartGrid(top, W, L, R, T, plotH){
  let g = '';
  for(let i = 0; i <= 4; i++){
    const yy = T + plotH - plotH * i / 4;
    g += `<line class="rc-grid" x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}"/><text class="rc-txt" x="${L-6}" y="${yy+4}" text-anchor="end">${compactNum(top * i / 4)}</text>`;
  }
  return g;
}
function chartSeries(sales, exp){
  const S = [];
  if(hasSeries(sales)) S.push({ data: sales, cls: 'rc-bar', name: 'Sales' });
  if(hasSeries(exp)) S.push({ data: exp, cls: 'rc-bar2', name: 'Expenses' });
  return S;
}
// Column chart for EVERY day of the month. Sales in gold, expenses in red; either one may be null. Inline SVG.
function dailyChartSvg(sales, exp, y, m, label){
  const N = new Date(y, m, 0).getDate();
  const W = 640, H = 230, L = 46, R = 8, T = 10, B = 26;
  const plotW = W - L - R, plotH = H - T - B, slot = plotW / N;
  const S = chartSeries(sales, exp), both = S.length === 2;
  const top = niceCeil(Math.max(0, ...S.map(s => Math.max(0, ...Object.values(s.data)))));
  const mon = new Date(y, m-1, 1).toLocaleDateString(undefined, { month:'short' });
  const groupW = slot * 0.8, bw = groupW / Math.max(1, S.length);
  let g = chartGrid(top, W, L, R, T, plotH);
  for(let d = 1; d <= N; d++){
    const cx = L + slot * (d - 0.5);
    S.forEach((s, i)=>{
      const v = s.data[d] || 0;
      if(v > 0){
        const h = Math.max(2, v / top * plotH);
        g += `<rect class="${s.cls}" x="${cx - groupW/2 + i * bw}" y="${T + plotH - h}" width="${bw}" height="${h}" rx="1"><title>${mon} ${d}${both ? ' ' + s.name : ''}: ${money(v)}</title></rect>`;
      }
    });
    if(d === 1 || d % 5 === 0) g += `<text class="rc-txt" x="${cx}" y="${H - 8}" text-anchor="middle">${d}</text>`;
  }
  return `<svg class="rc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label || 'Daily'} chart">${g}</svg>`;
}
// Column chart for each month Jan..Dec of one year; the picked month is highlighted, tap a column to open that month.
function monthlyChartSvg(sales, exp, y, selM, label){
  const W = 640, H = 230, L = 46, R = 8, T = 18, B = 26;
  const plotW = W - L - R, plotH = H - T - B, slot = plotW / 12;
  const S = chartSeries(sales, exp), both = S.length === 2;
  const top = niceCeil(Math.max(0, ...S.map(s => Math.max(0, ...s.data))));
  const groupW = slot * 0.8, bw = groupW / Math.max(1, S.length);
  let g = chartGrid(top, W, L, R, T, plotH);
  for(let i = 0; i < 12; i++){
    const cx = L + slot * (i + 0.5);
    const name = new Date(y, i, 1).toLocaleDateString(undefined, { month:'short' });
    const key = y + '-' + String(i + 1).padStart(2, '0');
    const dim = i + 1 === selM ? '' : ' rc-dim';
    S.forEach((s, k)=>{
      const v = s.data[i] || 0;
      if(v > 0){
        const h = Math.max(2, v / top * plotH), x = cx - groupW / 2 + k * bw;
        g += `<rect class="${s.cls}${dim}" x="${x}" y="${T + plotH - h}" width="${bw}" height="${h}" rx="1"/>`;
        if(!both) g += `<text class="rc-txt" x="${cx}" y="${T + plotH - h - 4}" text-anchor="middle">${compactNum(v)}</text>`;
      }
    });
    const tip = S.map(s => (both ? s.name + ' ' : '') + money(s.data[i] || 0)).join(', ');
    g += `<text class="rc-txt" x="${cx}" y="${H - 8}" text-anchor="middle"${i + 1 === selM ? ' style="font-weight:700"' : ''}>${name}</text>` +
         `<rect class="rc-hit" data-rpt-month="${key}" x="${cx - slot/2}" y="${T}" width="${slot}" height="${plotH + B}"><title>${name} ${y}: ${tip}</title></rect>`;
  }
  return `<svg class="rc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label || 'Monthly'} chart">${g}</svg>`;
}
// Month-by-month block for a year: heading, legend, chart, and (when both sales and expenses exist) a Sales / Expenses / Net table.
function yearCompareBlock(sales, exp, y, m){
  const hs = hasSeries(sales), he = hasSeries(exp), both = hs && he;
  if(!hs && !he) return '';
  const title = both ? 'Sales and expenses by month' : (he ? 'Expenses by month' : 'Sales by month');
  const sTot = hs ? sales.reduce((a, b) => a + b, 0) : 0, eTot = he ? exp.reduce((a, b) => a + b, 0) : 0;
  const netColor = v => v >= 0 ? 'var(--pos, var(--green))' : 'var(--neg, var(--red))';
  let table = '';
  if(both){
    const rows = [];
    for(let i = 0; i < 12; i++){
      const a = sales[i] || 0, b = exp[i] || 0;
      if(!a && !b) continue;
      rows.push(`<tr><td>${new Date(y, i, 1).toLocaleDateString(undefined, { month:'short' })}</td><td class="mono">${money(a)}</td><td class="mono">${money(b)}</td><td class="mono" style="color:${netColor(a - b)}">${money(a - b)}</td></tr>`);
    }
    rows.push(`<tr class="tot"><td>${y}</td><td class="mono">${money(sTot)}</td><td class="mono">${money(eTot)}</td><td class="mono" style="color:${netColor(sTot - eTot)}">${money(sTot - eTot)}</td></tr>`);
    table = `<div style="overflow-x:auto;"><table class="rpt-tbl"><thead><tr><th>Month</th><th>Sales</th><th>Expenses</th><th>Net</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
  const note = both ? `Net = sales minus expenses. It is not profit, because product costs are not tracked. ` : `Year total: ${money(hs ? sTot : eTot)}. `;
  return `<h2>${title}, ${y}</h2>${both ? chartLegend() : ''}<div>${monthlyChartSvg(sales, exp, y, m, title)}</div>${table}<div class="setup-note" style="margin:6px 0 16px;">${note}Tap a month in the chart to open its report.</div>`;
}
function salesMonthDays(){
  const r = reportRange(), sy = state.salesYear;
  if(!sy || sy.year !== r.y) return null;
  const out = {};
  Object.keys(sy.days).forEach(k=>{ const p = k.split('-'); if(Number(p[0]) === r.m) out[Number(p[1])] = sy.days[k]; });
  return out;
}
function netStatBox(net, otherLabel){
  const col = net >= 0 ? 'var(--pos, var(--green))' : 'var(--neg, var(--red))';
  return `<div class="rpt-stat"><div class="lbl">Net (sales minus expenses)</div><div class="val mono" style="color:${col}">${money(net)}</div><div class="lbl" style="margin:2px 0 0;">${otherLabel}</div></div>`;
}

function renderReport(){
  const label = reportMonthLabel();
  const r = reportRange();
  const c = computeReport();
  const ex = state.ledgerReady ? computeExpenses() : null;
  const dEx = ex && hasSeries(ex.days) ? ex.days : null;
  const shortMonth = new Date(r.y, r.m-1, 1).toLocaleDateString(undefined, { month:'short' });
  const maxRev = c.products.length ? c.products[0].revenue : 0;
  const prodRows = c.products.slice(0, 15).map(p=>
    `<div class="sale-row"><div class="head"><span>${escapeHtml(p.name)}</span><span class="amt mono">${money(p.revenue)}</span></div><div class="items">${p.qty} sold${p.free ? ', \uD83C\uDF81 ' + p.free + ' free' : ''}, ${c.total ? (p.revenue / c.total * 100).toFixed(1) : '0.0'}% of sales</div><div class="rpt-share"><div style="width:${maxRev ? Math.max(2, p.revenue / maxRev * 100) : 0}%"></div></div></div>`
  ).join('');
  const freeBlock = c.freebies.length ? `<h2 style="margin-top:18px;">\uD83C\uDF81 Freebies given (${c.freeQty} pcs, ${money(0)})</h2>` +
    c.freebies.map(f => `<div class="sale-row"><div class="head"><span>${f.qty}\u00D7 ${escapeHtml(f.name)}</span><span class="amt mono">${money(0)}</span></div><div class="items">${f.date.toLocaleString()} \u2014 <span class="free-note" style="display:inline;">${escapeHtml(f.remarks || '(walang remarks)')}</span></div></div>`).join('') : '';
  const yearBlock = yearCompareBlock(state.reportYearTotals.length ? state.reportYearTotals : null, ex ? ex.months : null, r.y, r.m);
  const body = state.reportLoading ? '<div class="empty">Loading report...</div>' :
    (c.count === 0 ? `<div class="empty">No sales recorded in ${escapeHtml(label)}.</div>` + yearBlock + freeBlock : `
    <div class="rpt-stats">
      <div class="rpt-stat"><div class="lbl">Total sales</div><div class="val mono">${money(c.total)}</div></div>
      <div class="rpt-stat"><div class="lbl">Transactions</div><div class="val mono">${c.count}</div></div>
      <div class="rpt-stat"><div class="lbl">Average per sale</div><div class="val mono">${money(c.avg)}</div></div>
      <div class="rpt-stat"><div class="lbl">Best day</div><div class="val mono">${c.bestDay ? shortMonth + ' ' + c.bestDay : '-'}</div><div class="lbl" style="margin:2px 0 0;">${c.bestDay ? money(c.days[c.bestDay]) : ''}</div></div>
      ${ex ? netStatBox(c.total - ex.total, 'Expenses ' + money(ex.total)) : ''}
      ${c.freeQty ? `<div class="rpt-stat"><div class="lbl">Freebies given</div><div class="val mono">${c.freeQty}</div><div class="lbl" style="margin:2px 0 0;">pcs, ${money(0)}</div></div>` : ''}
    </div>
    ${c.consignCount ? `<div class="setup-note" style="margin:0 0 14px;">${c.consignCount} consignment${c.consignCount>1?'s':''} settled this month, worth ${money(c.consignValue)}. This is already included in Total sales.</div>` : ''}
    <h2>${dEx ? 'Sales and expenses per day' : 'Sales per day'}</h2>
    ${dEx ? chartLegend() : ''}
    <div style="margin-bottom:16px;">${dailyChartSvg(c.days, dEx, r.y, r.m, dEx ? 'Sales and expenses per day' : 'Sales per day')}</div>
    ${yearBlock}
    <h2>Top products${c.products.length > 15 ? ' (top 15 of ' + c.products.length + ')' : ''}</h2>
    ${prodRows}
    ${freeBlock}`);
  return `<div class="panel">
    <h2>Monthly Sales Report: ${escapeHtml(label)}</h2>
    <div class="rpt-controls no-print">
      <button class="ghost" id="btn-rpt-prev" aria-label="Previous month">&lsaquo; Prev</button>
      <input type="month" id="rpt-month" value="${state.reportMonth || defaultReportMonth()}">
      <button class="ghost" id="btn-rpt-next" aria-label="Next month">Next &rsaquo;</button>
      <span style="flex:1"></span>
      <button class="ghost" id="btn-rpt-print">Print / Save PDF</button>
      <button class="ghost" id="btn-rpt-excel">Export to Excel</button>
    </div>
    ${body}
  </div>`;
}
/* ---------- Expense report ---------- */
// Expenses are the ledger entries that have an "Out" amount (added manually in the Ledger tab), grouped by month.
// Entry date = the date picked in the Ledger form, or the day the entry was created when no date was picked.
async function fetchExpenses(){
  if(!state.connected || !state.ledgerReady) return;
  if(!state.reportMonth) state.reportMonth = defaultReportMonth();
  state.expenseLoading = true; render();
  try{
    state.expenseEntries = await loadExpenseEntries();
    try{
      state.salesYear = await loadSalesYear(reportRange().y);
      state.reportYearTotals = state.salesYear.months;
    }catch(e){ state.salesYear = null; } // sales side of the charts is optional
  }catch(e){
    showToast('Could not load expenses: ' + e.message, true);
  }
  state.expenseLoading = false; render();
}
function expenseDate(e){
  if(e.entry_date){ const p = String(e.entry_date).split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); }
  return new Date(e.created_at);
}
function computeExpenses(){
  const r = reportRange();
  const days = {}, groups = {}, months = new Array(12).fill(0), list = [];
  let total = 0;
  state.expenseEntries.forEach(e=>{
    const d = expenseDate(e), amt = Number(e.amount_out) || 0;
    if(d.getFullYear() !== r.y) return;
    months[d.getMonth()] += amt;
    if(d.getMonth() + 1 !== r.m) return;
    total += amt;
    days[d.getDate()] = (days[d.getDate()] || 0) + amt;
    const name = (e.details || '').trim() || '(no details)';
    const g = groups[name.toLowerCase()] || (groups[name.toLowerCase()] = { name, count:0, amount:0 });
    g.count += 1; g.amount += amt;
    list.push({ date:d, e, amt });
  });
  list.sort((a,b)=> a.date - b.date);
  const items = Object.values(groups).sort((a,b)=> b.amount - a.amount);
  const biggest = list.reduce((m, x)=> (!m || x.amt > m.amt) ? x : m, null);
  return { total, count:list.length, avg: list.length ? total / list.length : 0, days, items, months, list, biggest };
}
function renderExpenses(){
  if(!state.ledgerReady){
    return `<div class="panel"><h2>Expense Report</h2><div class="setup-note">Hindi pa naka-set up ang Ledger. Pumunta sa <strong>Settings</strong> (Admin only) at i-run ang SQL sa ilalim ng "Ledger (Balance Sheet)" section, isang beses lang.</div></div>`;
  }
  const label = reportMonthLabel(), r = reportRange(), c = computeExpenses();
  const sy = state.salesYear && state.salesYear.year === r.y ? state.salesYear.months : null;
  const sm = salesMonthDays();
  const xBoth = hasSeries(sm) && hasSeries(c.days);
  const yearBlock = yearCompareBlock(sy, c.months, r.y, r.m);
  const maxAmt = c.items.length ? c.items[0].amount : 0;
  const itemRows = c.items.slice(0, 15).map(g=>
    `<div class="sale-row"><div class="head"><span>${escapeHtml(g.name)}</span><span class="amt mono">${money(g.amount)}</span></div><div class="items">${g.count} ${g.count > 1 ? 'entries' : 'entry'}, ${(g.amount / c.total * 100).toFixed(1)}% of expenses</div><div class="rpt-share"><div style="width:${Math.max(2, g.amount / maxAmt * 100)}%"></div></div></div>`
  ).join('');
  const entryRows = c.list.map(x=>
    `<div class="sale-row"><div class="head"><span>${x.date.toLocaleDateString()}${x.e.pic ? ', ' + escapeHtml(x.e.pic) : ''}</span><span class="amt mono">${money(x.amt)}</span></div><div class="items">${escapeHtml(x.e.details || '')}${x.e.qty ? ' (' + escapeHtml(x.e.qty) + ')' : ''}</div></div>`
  ).join('');
  const body = state.expenseLoading ? '<div class="empty">Loading expenses...</div>' :
    (c.count === 0 ? `<div class="empty">No expenses recorded in ${escapeHtml(label)}. Add them in the Ledger tab using the Out column.</div>${yearBlock}` : `
    <div class="rpt-stats">
      <div class="rpt-stat"><div class="lbl">Total expenses</div><div class="val mono">${money(c.total)}</div></div>
      <div class="rpt-stat"><div class="lbl">Entries</div><div class="val mono">${c.count}</div></div>
      <div class="rpt-stat"><div class="lbl">Average per entry</div><div class="val mono">${money(c.avg)}</div></div>
      <div class="rpt-stat"><div class="lbl">Biggest expense</div><div class="val mono">${money(c.biggest.amt)}</div><div class="lbl" style="margin:2px 0 0;">${escapeHtml(c.biggest.e.details || '')}</div></div>
      ${sy ? netStatBox(sy[r.m - 1] - c.total, 'Sales ' + money(sy[r.m - 1])) : ''}
    </div>
    <h2>${xBoth ? 'Sales and expenses per day' : 'Expenses per day'}</h2>
    ${xBoth ? chartLegend() : ''}
    <div style="margin-bottom:16px;">${dailyChartSvg(xBoth ? sm : null, c.days, r.y, r.m, xBoth ? 'Sales and expenses per day' : 'Expenses per day')}</div>
    ${yearBlock}
    <h2>By item${c.items.length > 15 ? ' (top 15 of ' + c.items.length + ')' : ''}</h2>
    ${itemRows}
    <h2 style="margin-top:16px;">All entries in ${escapeHtml(label)}</h2>
    ${entryRows}`);
  return `<div class="panel rc-neg">
    <h2>Expense Report: ${escapeHtml(label)}</h2>
    <div class="rpt-controls no-print">
      <button class="ghost" id="btn-rpt-prev" aria-label="Previous month">&lsaquo; Prev</button>
      <input type="month" id="rpt-month" value="${state.reportMonth || defaultReportMonth()}">
      <button class="ghost" id="btn-rpt-next" aria-label="Next month">Next &rsaquo;</button>
      <span style="flex:1"></span>
      <button class="ghost" id="btn-rpt-print">Print / Save PDF</button>
      <button class="ghost" id="btn-exp-excel">Export to Excel</button>
    </div>
    ${body}
  </div>`;
}
function exportExpensesToExcel(){
  const c = computeExpenses(), r = reportRange();
  const sy = state.salesYear && state.salesYear.year === r.y ? state.salesYear.months : null;
  if(c.count === 0){ showToast('No expenses in this month to export.', true); return; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { Item:'Month', Value: reportMonthLabel() },
    { Item:'Total expenses', Value: c.total },
    { Item:'Entries', Value: c.count },
    { Item:'Average per entry', Value: Math.round(c.avg * 100) / 100 }
  ]), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.keys(c.days).map(Number).sort((a,b)=>a-b).map(d=>
    ({ Date: new Date(r.y, r.m-1, d).toLocaleDateString(), Expenses: c.days[d] }))), 'By Day');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(c.items.map(g=>
    ({ Item: g.name, Entries: g.count, Amount: g.amount }))), 'By Item');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(c.months.map((t, i)=>
    Object.assign({ Month: new Date(r.y, i, 1).toLocaleDateString(undefined, { month:'long' }) + ' ' + r.y, Expenses: t }, sy ? { Sales: sy[i], Net: sy[i] - t } : {}))), 'By Month');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(c.list.map(x=>
    ({ Date: x.date.toLocaleDateString(), Details: x.e.details || '', Qty: x.e.qty || '', PIC: x.e.pic || '', Amount: x.amt }))), 'Entries');
  XLSX.writeFile(wb, `CCFACO-Expenses-${state.reportMonth}.xlsx`);
  showToast('Expense report downloaded.');
}

function exportReportToExcel(){
  const c = computeReport();
  if(c.count === 0 && !c.freebies.length){ showToast('No sales in this month to export.', true); return; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { Item:'Month', Value: reportMonthLabel() },
    { Item:'Total sales', Value: c.total },
    { Item:'Transactions', Value: c.count },
    { Item:'Average per sale', Value: Math.round(c.avg * 100) / 100 },
    { Item:'Consignments settled', Value: c.consignCount },
    { Item:'Consignment sold value (already in total)', Value: c.consignValue },
    { Item:'Freebies given (pcs, zero amount)', Value: c.freeQty }
  ]), 'Summary');
  const r = reportRange();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.keys(c.days).map(Number).sort((a,b)=>a-b).map(d=>
    ({ Date: new Date(r.y, r.m-1, d).toLocaleDateString(), Sales: c.days[d] }))), 'By Day');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(c.products.map(p=>
    ({ Product: p.name, 'Qty Sold': p.qty, 'Qty Free': p.free || 0, Revenue: p.revenue }))), 'By Product');
  if(c.freebies.length){
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(c.freebies.map(f=>
      ({ Date: f.date.toLocaleDateString(), Time: f.date.toLocaleTimeString(), Product: f.name, Qty: f.qty, Amount: 0, Remarks: f.remarks }))), 'Freebies');
  }
  if(state.reportYearTotals.length){
    const exm = state.ledgerReady ? computeExpenses().months : null;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.reportYearTotals.map((t, i)=>
      Object.assign({ Month: new Date(r.y, i, 1).toLocaleDateString(undefined, { month:'long' }) + ' ' + r.y, Sales: t }, exm ? { Expenses: exm[i], Net: t - exm[i] } : {}))), 'By Month');
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.reportSales.map(s=>{
    const d = new Date(s.created_at);
    return { Date: d.toLocaleDateString(), Time: d.toLocaleTimeString(),
      Items: (s.sale_items || []).map(i => `${i.qty}x ${i.product_name}${i.is_free ? ' (FREE' + (i.free_remarks ? ': ' + i.free_remarks : '') + ')' : ''}`).join(', '), Total: Number(s.total) };
  })), 'Sales');
  XLSX.writeFile(wb, `CCFACO-Sales-${state.reportMonth}.xlsx`);
  showToast('Monthly report downloaded.');
}
