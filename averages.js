/* ---------- Averages report + full Excel export ----------
   1) "Averages" sa Report menu:
      - Average ng benta kada buwan (para sa piniling taon)
      - Average ng products kada buwan sa KILO, naka-group (Tablea lahat, Spread lahat,
        kahit anong size o gramo). Ang timbang ay kinukuha sa pangalan ng product
        (hal. "Tablea 250g", "Choco Spread 300g", "Tablea 1kg").
   2) Admin: "Export (Excel)" = mga report + Products at Supplies inventory, Members,
      Bank accounts, Ledger, Utang, Consignment.
   Walang bagong table sa database. */

Object.assign(state, {
  avgYear: null,
  avgLoading: false,
  avgData: null,
  avgError: '',
  avgGroupsText: 'Tablea, Spread',
  avgTopBy: 'value',     // 'value' | 'pcs' | 'kg'
  avgTop: null,          // { rows, untagged } kapag na-compute na
  avgExporting: false
});
try{
  const saved = localStorage.getItem('ccfaco_avg_groups');
  if(saved !== null) state.avgGroupsText = saved;
}catch(e){}

let avgRawSales = [];
let avgRawConsign = [];
const AVG_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AVG_MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ----- parsing: timbang at group galing sa pangalan ----- */
const AVG_UNIT = '(kgs?|kilos?|kilograms?|grams?|gms?|g)';
const AVG_FRAC_RE = new RegExp('(\\d+)\\s*\\/\\s*(\\d+)\\s*' + AVG_UNIT + '(?![a-z])', 'i');
const AVG_NUM_RE = new RegExp('(\\d+(?:[.,]\\d+)?)\\s*' + AVG_UNIT + '(?![a-z])', 'i');

function avgUnitToG(unit){
  return /^k/i.test(unit) ? 1000 : 1;
}
// grams per piece, or null kung walang nakasulat na timbang
function avgParseWeightG(name){
  const s = String(name || '');
  let m = s.match(AVG_FRAC_RE);
  if(m){
    const a = Number(m[1]), b = Number(m[2]);
    if(b > 0) return (a / b) * avgUnitToG(m[3]);
  }
  m = s.match(AVG_NUM_RE);
  if(m) return Number(m[1].replace(',', '.')) * avgUnitToG(m[2]);
  return null;
}
function avgStripWeight(name){
  return String(name || '').replace(AVG_FRAC_RE, ' ').replace(AVG_NUM_RE, ' ')
    .replace(/[-\u2013(),]+\s*$/g, ' ').replace(/\s+/g, ' ').trim();
}
function avgKeywords(){
  const seen = {}, out = [];
  String(state.avgGroupsText || '').split(/[,\n;]+/).forEach(k => {
    k = k.trim();
    if(k && !seen[k.toLowerCase()]){ seen[k.toLowerCase()] = 1; out.push(k); }
  });
  return out;
}
function avgGroupOf(name){
  const low = String(name || '').toLowerCase();
  const kws = avgKeywords();
  for(const k of kws){
    if(low.indexOf(k.toLowerCase()) >= 0) return k.charAt(0).toUpperCase() + k.slice(1);
  }
  const base = avgStripWeight(name) || String(name || '').trim() || '(walang pangalan)';
  return base;
}
function avgNum(n, d){
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: d === undefined ? 2 : d, maximumFractionDigits: d === undefined ? 2 : d });
}

/* ----- computation ----- */
function avgCompute(sales, year){
  const now = new Date(), curY = now.getFullYear(), curM = now.getMonth();
  const monthSales = new Array(12).fill(0);
  const groups = {};      // key -> { name, kg[12], pcs[12], unknownPcs }
  const noWeight = {};    // product name -> pcs
  let salesCount = 0;
  sales.forEach(s => {
    const d = new Date(s.created_at);
    if(isNaN(d) || d.getFullYear() !== year) return;
    const m = d.getMonth();
    const t = Number(s.total) || 0;
    monthSales[m] += t;
    if(t > 0) salesCount++;
    (s.sale_items || []).forEach(i => {
      if(i.is_free) return;                 // freebies are not sales
      const q = Number(i.qty) || 0;
      if(!q) return;
      const nm = String(i.product_name || '').trim() || '(walang pangalan)';
      const gname = avgGroupOf(nm), key = gname.toLowerCase();
      const g = groups[key] || (groups[key] = { name: gname, kg: new Array(12).fill(0), pcs: new Array(12).fill(0), unknownPcs: 0 });
      g.pcs[m] += q;
      const w = avgParseWeightG(nm);
      if(w === null){
        g.unknownPcs += q;
        noWeight[nm] = (noWeight[nm] || 0) + q;
      } else {
        g.kg[m] += (w * q) / 1000;
      }
    });
  });

  // anong mga buwan ang bibilangin sa average
  let first = -1;
  for(let m = 0; m < 12; m++){ if(monthSales[m] > 0){ first = m; break; } }
  let lastComplete = -1, lastIncl = -1;
  if(year < curY){ lastComplete = 11; lastIncl = 11; }
  else if(year === curY){ lastComplete = curM - 1; lastIncl = curM; }
  const range = (a, b) => { const r = []; if(a >= 0 && b >= a) for(let m = a; m <= b; m++) r.push(m); return r; };
  const completeMonths = range(first, lastComplete);
  const inclMonths = range(first, lastIncl);
  const avgOf = (arr, months) => months.length ? months.reduce((s, m) => s + arr[m], 0) / months.length : null;

  const list = Object.keys(groups).map(k => {
    const g = groups[k];
    return Object.assign({}, g, {
      totalKg: g.kg.reduce((a, b) => a + b, 0),
      totalPcs: g.pcs.reduce((a, b) => a + b, 0),
      avgKgComplete: avgOf(g.kg, completeMonths),
      avgKgIncl: avgOf(g.kg, inclMonths)
    });
  }).sort((a, b) => b.totalKg - a.totalKg || b.totalPcs - a.totalPcs);

  return {
    year, curY, curM, monthSales, salesCount, first,
    completeMonths, inclMonths,
    total: monthSales.reduce((a, b) => a + b, 0),
    avgComplete: avgOf(monthSales, completeMonths),
    avgIncl: avgOf(monthSales, inclMonths),
    groups: list,
    noWeight: Object.keys(noWeight).map(n => ({ name: n, pcs: noWeight[n] })).sort((a, b) => b.pcs - a.pcs)
  };
}

function avgRecompute(){
  state.avgData = avgCompute(avgRawSales, state.avgYear);
}

async function avgFetchSales(y){
  const ys = encodeURIComponent(new Date(y, 0, 1).toISOString());
  const ye = encodeURIComponent(new Date(y + 1, 0, 1).toISOString());
  const tail = `sale_items(${saleItemCols()})&created_at=gte.${ys}&created_at=lt.${ye}${notVoidedQ()}&order=created_at.asc,id.asc`;
  // kung wala pa ang member columns o utang columns, babalik sa mas simpleng select
  const attempts = [
    'created_at,total,member_id,member_name,buyer_name,is_receivable,',
    'created_at,total,member_id,buyer_name,is_receivable,',
    'created_at,total,buyer_name,is_receivable,',
    'created_at,total,'
  ];
  let lastErr;
  for(const cols of attempts){
    try{ return await fetchAllRows('sales', 'select=' + cols + tail); }catch(e){ lastErr = e; }
  }
  throw lastErr;
}

async function loadAverages(){
  if(!state.connected) return;
  if(!state.avgYear) state.avgYear = new Date().getFullYear();
  const y = state.avgYear;
  state.avgLoading = true; state.avgError = '';
  render();
  try{
    const rows = await avgFetchSales(y);
    let cons = [];
    try{ cons = await fetchAllRows('consignments', 'select=*,consignment_items(*)&order=created_at.asc'); }catch(e){ cons = []; }
    if(state.avgYear === y){
      avgRawSales = rows;
      avgRawConsign = cons;
      avgRecompute();
      avgRecomputeTop();
    }
  }catch(e){
    state.avgError = 'Hindi ma-load ang Averages: ' + (e.message || e);
  }
  state.avgLoading = false;
  render();
}

/* ----- Top Members: pinaka maraming nabenta (galing sa Consignment na naka-tag sa member) ----- */
function avgNameKey(s){ return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function avgTopCompute(consigns, year, memberList, sales){
  const by = {};
  let untagged = 0;
  const members = memberList || state.members || [];
  const mk = (id, name) => {
    const r = by[id] || (by[id] = { id, name: '', value: 0, pcs: 0, kg: 0, n: 0, cV: 0, bV: 0, uV: 0, bn: 0 });
    if(name && !r.name) r.name = name;
    return r;
  };
  // 1) Consignment na nabenta ng member
  (consigns || []).forEach(c => {
    if(c.voided) return;
    const dt = new Date(c.settled_at || c.created_at);
    if(isNaN(dt) || dt.getFullYear() !== year) return;
    const its = c.consignment_items || [];
    const sold = its.reduce((t, i) => t + (Number(i.qty_sold) || 0), 0);
    if(!sold) return;
    if(!c.member_id){ untagged += sold; return; }
    const m = members.find(x => x.id === c.member_id);
    const row = mk(c.member_id, (m && m.full_name) || c.member_name || 'Member');
    row.n++;
    its.forEach(i => {
      const q = Number(i.qty_sold) || 0;
      if(!q) return;
      row.pcs += q;
      row.cV += consignUnitPrice(i, c) * q;           // parehong presyo ng Consign tab
      const w = avgParseWeightG(i.product_name);
      if(w !== null) row.kg += (w * q) / 1000;
    });
  });
  // 2) Binili ng member sa Sell (cash at utang). member_id kung naka-tag; kung utang na walang tag, itutugma sa pangalan
  const byName = {}, dup = {};
  members.forEach(m => { const k = avgNameKey(m.full_name); if(!k) return; if(byName[k] && byName[k] !== m.id) dup[k] = 1; byName[k] = m.id; });
  (sales || []).forEach(s => {
    const dt = new Date(s.created_at);
    if(isNaN(dt) || dt.getFullYear() !== year) return;
    let mid = s.member_id || null;
    if(!mid && s.is_receivable && s.buyer_name){
      const k = avgNameKey(s.buyer_name);
      if(byName[k] && !dup[k]) mid = byName[k];
    }
    if(!mid) return;                                   // isang benta = isang bilang lang
    const m = members.find(x => x.id === mid);
    const row = mk(mid, (m && m.full_name) || s.member_name || s.buyer_name || 'Member');
    const t = Number(s.total) || 0;
    row.bV += t;
    if(s.is_receivable) row.uV += t;
    row.bn++;
    (s.sale_items || []).forEach(i => {
      if(i.is_free) return;
      const q = Number(i.qty) || 0;
      if(!q) return;
      row.pcs += q;
      const w = avgParseWeightG(i.product_name);
      if(w !== null) row.kg += (w * q) / 1000;
    });
  });
  // 3) lahat ng members, kahit walang galaw
  members.forEach(m => { if(m && m.id) mk(m.id, m.full_name || 'Member'); });
  const rows = Object.keys(by).map(k => { const r = by[k]; r.value = r.cV + r.bV; return r; });
  return { rows, untagged };
}
function avgTopSorted(top, by){
  const key = by === 'pcs' ? 'pcs' : (by === 'kg' ? 'kg' : 'value');
  return top.rows.slice().sort((a, b) => b[key] - a[key] || b.value - a.value || String(a.name).localeCompare(String(b.name)));
}
function avgRecomputeTop(){
  state.avgTop = avgTopCompute(avgRawConsign, state.avgYear, null, avgRawSales);
}

/* ----- screen ----- */
function avgMonthStatus(d, m){
  if(d.year > d.curY || (d.year === d.curY && m > d.curM)) return 'wala pa';
  if(d.year === d.curY && m === d.curM) return 'kasalukuyan';
  return '';
}

function renderAverages(){
  const y = state.avgYear || new Date().getFullYear();
  const d = state.avgData;
  const head = '<div class="panel" style="margin-bottom:16px;"><div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">' +
      '<h2 style="margin:0;">Averages</h2>' +
      '<div style="display:flex; align-items:center; gap:8px;">' +
        '<button class="ghost" data-avg-year="-1" ' + (state.avgLoading ? 'disabled' : '') + '>&#9664;</button>' +
        '<b style="min-width:52px; text-align:center; font-size:18px;">' + y + '</b>' +
        '<button class="ghost" data-avg-year="1" ' + (state.avgLoading ? 'disabled' : '') + '>&#9654;</button>' +
      '</div></div>' +
      (isAdmin() ? '<div style="margin-top:12px;"><button class="primary" id="btn-avg-export" style="width:auto; padding:9px 18px; margin-top:0;" ' + (state.avgExporting ? 'disabled' : '') + '>' + (state.avgExporting ? 'Gumagawa ng Excel...' : 'Export (Excel)') + '</button>' +
        '<div class="setup-note" style="margin-top:8px;">Kasama sa Excel: Average ng benta, Average ng kilo kada group, Products at Supplies inventory, Members, Bank accounts, Ledger, Utang, at Consignment.</div></div>' : '') +
    '</div>';

  if(state.avgLoading && !d) return head + '<div class="panel"><div class="setup-note">Loading...</div></div>';
  if(state.avgError) return head + '<div class="panel"><div class="setup-note">' + escapeHtml(state.avgError) + '</div></div>';
  if(!d) return head + '<div class="panel"><div class="setup-note">Loading...</div></div>';

  const basis = d.completeMonths.length ? d.completeMonths : d.inclMonths;
  const avg = d.completeMonths.length ? d.avgComplete : d.avgIncl;
  const basisNote = basis.length
    ? (d.completeMonths.length
        ? 'Kumpletong buwan lang ang binilang: ' + AVG_MONTHS[basis[0]] + ' hanggang ' + AVG_MONTHS[basis[basis.length - 1]] + ' (' + basis.length + ' buwan).'
        : 'Wala pang kumpletong buwan, kaya kasama ang kasalukuyang buwan.')
    : 'Wala pang benta ngayong ' + y + '.';
  const max = Math.max.apply(null, d.monthSales.concat([1]));

  const monthRows = d.monthSales.map((v, m) => {
    const st = avgMonthStatus(d, m);
    const counted = basis.indexOf(m) >= 0;
    return '<div class="product-row" style="display:block; cursor:default; padding-top:8px; padding-bottom:8px;">' +
      '<div style="display:flex; justify-content:space-between; gap:10px;">' +
        '<div><span class="name">' + AVG_MONTHS_LONG[m] + '</span>' +
          (st ? ' <span class="tag">' + st + '</span>' : '') +
          (counted ? '' : (st ? '' : ' <span class="tag">hindi kasama</span>')) + '</div>' +
        '<div class="price">' + money(v) + '</div>' +
      '</div>' +
      '<div style="height:6px; background:var(--bg-panel-2); border-radius:3px; margin-top:6px; overflow:hidden;"><div style="height:100%; width:' + Math.round(v / max * 100) + '%; background:var(--gold);"></div></div>' +
    '</div>';
  }).join('');

  const salesPanel = '<div class="panel" style="margin-bottom:16px;">' +
    '<h2>Average ng Benta kada Buwan</h2>' +
    '<div style="font-size:30px; font-weight:800; color:var(--gold); margin:6px 0;">' + (avg === null ? '\u2014' : money(avg)) + '</div>' +
    '<div class="setup-note">' + escapeHtml(basisNote) + '</div>' +
    (d.completeMonths.length && d.avgIncl !== null
      ? '<div class="setup-note" style="margin-top:4px;">Kung kasama ang kasalukuyang buwan: <b>' + money(d.avgIncl) + '</b></div>' : '') +
    '<div style="display:flex; justify-content:space-between; margin:10px 0 8px; font-weight:700;"><span>Kabuuang benta ' + y + '</span><span class="price">' + money(d.total) + '</span></div>' +
    '<div class="product-list">' + monthRows + '</div></div>';

  const gAvg = g => (d.completeMonths.length ? g.avgKgComplete : g.avgKgIncl);
  const groupCards = d.groups.length ? d.groups.map(g => {
    const a = gAvg(g);
    const cells = g.kg.map((v, m) =>
      '<div style="text-align:center; padding:4px 0;"><div class="meta" style="margin:0;">' + AVG_MONTHS[m] + '</div><div style="font-weight:600;">' + (g.pcs[m] ? avgNum(v) : '\u2014') + '</div></div>'
    ).join('');
    return '<div class="product-row" style="display:block; cursor:default;">' +
      '<div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">' +
        '<div><div class="name">' + escapeHtml(g.name) + '</div>' +
        '<div class="meta">Kabuuan: ' + avgNum(g.totalKg) + ' kg &middot; ' + avgNum(g.totalPcs, 0) + ' pcs</div>' +
        (g.unknownPcs ? '<div class="meta" style="color:var(--red);">' + avgNum(g.unknownPcs, 0) + ' pcs ay walang timbang sa pangalan (hindi nabilang sa kg)</div>' : '') + '</div>' +
        '<div style="text-align:right;"><div class="price">' + (a === null ? '\u2014' : avgNum(a) + ' kg') + '</div><div class="meta" style="margin:0;">average / buwan</div></div>' +
      '</div>' +
      '<div style="display:grid; grid-template-columns:repeat(6, 1fr); gap:2px 4px; margin-top:8px;">' + cells + '</div>' +
    '</div>';
  }).join('') : '<div class="setup-note">Wala pang nabentang product ngayong ' + y + '.</div>';

  const noW = d.noWeight.length
    ? '<div class="setup-note" style="margin-top:12px;"><b>Mga product na walang timbang sa pangalan</b> (hindi nabilang sa kg). Ilagay ang timbang sa pangalan, hal. "Tablea 250g":<br>' +
      d.noWeight.slice(0, 15).map(x => escapeHtml(x.name) + ' (' + avgNum(x.pcs, 0) + ' pcs)').join(', ') +
      (d.noWeight.length > 15 ? ', at ' + (d.noWeight.length - 15) + ' pa' : '') + '</div>' : '';

  const kgPanel = '<div class="panel" style="margin-bottom:16px;">' +
    '<h2>Average ng Products kada Buwan (kilo)</h2>' +
    '<div class="setup-note" style="margin-bottom:10px;">Naka-group ang mga product (hal. lahat ng Tablea, lahat ng Spread), kahit anong size o gramo. Ang bilang na pcs &times; timbang sa pangalan ang ginawang kilo. Hindi kasama ang mga freebie.</div>' +
    '<div class="product-list">' + groupCards + '</div>' + noW +
    '<div class="field" style="margin-top:14px;"><label>Mga group (hiwalayin ng kuwit)</label>' +
      '<div style="display:flex; gap:8px;"><input id="avg-groups" value="' + escapeHtml(state.avgGroupsText) + '" placeholder="Tablea, Spread" autocomplete="off" style="flex:1;">' +
      '<button class="ghost" id="btn-avg-groups" style="width:auto; margin-top:0;">I-save</button></div>' +
      '<div class="setup-note" style="margin-top:6px;">Lahat ng product na may ganitong salita sa pangalan ay pinagsasama. Ang iba ay naka-group ayon sa sarili nilang pangalan na walang gramo.</div></div>' +
    '</div>';

  let topPanel = '';
  if(state.avgTop){
    const rows = avgTopSorted(state.avgTop, state.avgTopBy);
    const by = state.avgTopBy;
    const keyOf = r => by === 'pcs' ? r.pcs : (by === 'kg' ? r.kg : r.value);
    const tab = (k, lbl) => '<button class="' + (by === k ? 'primary' : 'ghost') + '" data-avg-topby="' + k + '" style="width:auto; padding:6px 12px; margin-top:0; font-size:13px;">' + lbl + '</button>';
    let rank = 0;
    const list = rows.length ? rows.map((r, i) => {
      const has = keyOf(r) > 0;
      if(has) rank++;
      const isTop = has && rank <= 10;
      const sep = (i > 0 && rank > 10 && has && rank === 11) ? '<div class="setup-note" style="margin:10px 0 6px;">Iba pang members</div>' : '';
      return sep + '<div class="product-row" style="display:block; cursor:default;' + (isTop ? ' border-color:var(--gold);' : '') + (has ? '' : ' opacity:.6;') + '"><div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">' +
        '<div style="display:flex; gap:10px; align-items:center;"><div style="min-width:28px; font-weight:800; font-size:' + (isTop ? '18' : '15') + 'px; color:' + (isTop ? 'var(--gold)' : 'var(--ink-dim)') + ';">' + (has ? rank : '\u2014') + '</div>' +
          '<div><div class="name">' + escapeHtml(r.name) + '</div><div class="meta">' + avgNum(r.pcs, 0) + ' pcs &middot; ' + avgNum(r.kg) + ' kg</div>' +
          '<div class="meta">Consign ' + money(r.cV) + ' &middot; Binili ' + money(r.bV) + (r.uV ? ' (utang ' + money(r.uV) + ')' : '') + '</div></div></div>' +
        '<div class="price">' + money(r.value) + '</div>' +
      '</div></div>';
    }).join('') : '<div class="setup-note">Wala pang members.</div>';
    topPanel = '<div class="panel" style="margin-bottom:16px;"><h2>Top Members (pinaka maraming nabenta)</h2>' +
      '<div style="display:flex; gap:8px; margin:6px 0 10px; flex-wrap:wrap;">' + tab('value', 'Ayon sa halaga') + tab('pcs', 'Ayon sa pcs') + tab('kg', 'Ayon sa kilo') + '</div>' +
      '<div class="setup-note" style="margin-bottom:8px;">Lahat ng members, mula pinakamarami hanggang pinakakaunti. Kasama ang <b>nabenta nila sa Consign</b> at ang <b>binili nila sa Sell</b> (cash at utang). Ang <b style="color:var(--gold);">Top 10</b> ay may gintong border.</div>' +
      '<div class="product-list">' + list + '</div>' +
      '<div class="setup-note" style="margin-top:10px;">Consign: mga consignment na naka-tag sa member (nabenta na, hindi void), ayon sa taon ng settlement. Binili: mga benta sa Sell na may napiling Member, at ang mga utang na tugma ang pangalan sa member. Ang mga cash na benta na naitala <b>bago</b> ang pag-install ng sale-member.sql ay walang tala kung sinong member ang bumili, kaya hindi kasama.' +
      (state.avgTop.untagged ? ' May ' + avgNum(state.avgTop.untagged, 0) + ' pcs na nabenta sa consignment na hindi naka-tag sa member.' : '') + '</div></div>';
  }

  return head + salesPanel + kgPanel + topPanel;
}

function bindAverages(app){
  if(state.tab !== 'averages') return;
  app.querySelectorAll('[data-avg-year]').forEach(b => b.addEventListener('click', () => {
    state.avgYear = (state.avgYear || new Date().getFullYear()) + Number(b.dataset.avgYear);
    state.avgData = null;
    loadAverages();
  }));
  app.querySelectorAll('[data-avg-topby]').forEach(b => b.addEventListener('click', () => { state.avgTopBy = b.dataset.avgTopby; render(); }));
  const gin = document.getElementById('avg-groups');
  if(gin) gin.addEventListener('input', () => { state.avgGroupsText = gin.value; });
  const gbtn = document.getElementById('btn-avg-groups');
  if(gbtn) gbtn.addEventListener('click', () => {
    state.avgGroupsText = (gin ? gin.value : state.avgGroupsText).trim();
    try{ localStorage.setItem('ccfaco_avg_groups', state.avgGroupsText); }catch(e){}
    avgRecompute();
    render();
    showToast('Na-save ang mga group.');
  });
  const ex = document.getElementById('btn-avg-export');
  if(ex) ex.addEventListener('click', exportReportsToExcel);
}

/* ---------- Excel export ---------- */
function avgDate(v){
  if(!v) return '';
  const s = String(v);
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  return isNaN(d) ? s : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function avgFitCols(ws, rows){
  if(!rows.length) return ws;
  const keys = Object.keys(rows[0]);
  ws['!cols'] = keys.map(k => {
    let w = String(k).length;
    rows.forEach(r => { const l = String(r[k] === undefined || r[k] === null ? '' : r[k]).length; if(l > w) w = l; });
    return { wch: Math.min(Math.max(w + 2, 8), 60) };
  });
  return ws;
}
function avgSheet(rows, emptyNote){
  const data = rows.length ? rows : [{ Note: emptyNote || 'Walang laman' }];
  return avgFitCols(XLSX.utils.json_to_sheet(data), data);
}
function avgSafe(promise){
  return promise.then(rows => ({ rows, error: '' })).catch(e => ({ rows: [], error: (e && e.message) || String(e) }));
}

async function exportReportsToExcel(){
  if(!state.connected) return;
  if(!isAdmin()){ showToast('Admin lang ang puwedeng mag-export.', true); return; }
  if(state.avgExporting) return;
  state.avgExporting = true;
  const btn1 = document.getElementById('btn-avg-export'), btn2 = document.getElementById('btn-export-reports');
  [btn1, btn2].forEach(b => { if(b){ b.disabled = true; b.textContent = 'Gumagawa ng Excel...'; } });
  try{
    await ensureXLSX();
    if(!state.avgYear) state.avgYear = new Date().getFullYear();
    if(!state.avgData || state.avgData.year !== state.avgYear){
      avgRawSales = await avgFetchSales(state.avgYear);
      avgRecompute();
    }
    const d = state.avgData, y = d.year;

    const base = state.supaUrl + '/rest/v1/';
    const [products, supplies, members, contribs, banks, bankHist, ledger, recvSales, recvPays, consigns] = await Promise.all([
      avgSafe(fetchAllRows('products', 'select=*&order=name.asc')),
      avgSafe(fetchAllRows('supplies', 'select=*&order=name.asc')),
      avgSafe(fetchAllRows('members', 'select=*&order=full_name.asc')),
      avgSafe(fetchAllRows('member_contributions', 'select=*&order=entry_date.asc')),
      avgSafe(fetchAllRows('bank_accounts', 'select=*&is_active=eq.true&order=created_at.asc')),
      avgSafe(fetchAllRows('bank_account_history', 'select=*&order=created_at.asc')),
      avgSafe(fetchAllRows('ledger_entries', 'select=*&order=entry_date.asc,created_at.asc')),
      avgSafe(fetchAllRows('sales', `select=id,created_at,total,buyer_name,is_receivable,sale_items(${saleItemCols()}),receivable_payments(amount,voided)&is_receivable=is.true${notVoidedQ()}&order=created_at.asc,id.asc`)),
      avgSafe(fetchAllRows('receivable_payments', 'select=*,sales(buyer_name,created_at)&order=created_at.asc')),
      avgSafe(fetchAllRows('consignments', 'select=*,consignment_items(*)&order=created_at.asc'))
    ]);

    const wb = XLSX.utils.book_new();
    const summary = [];
    const add = (name, ws, count, error) => {
      XLSX.utils.book_append_sheet(wb, ws, name);
      summary.push({ Sheet: name, Rows: count, Status: error ? 'Na-skip: ' + error : 'OK' });
    };

    // 1) Average ng benta
    const basis = d.completeMonths.length ? d.completeMonths : d.inclMonths;
    const salesRows = d.monthSales.map((v, m) => ({
      Buwan: AVG_MONTHS_LONG[m] + ' ' + y,
      Benta: Math.round(v * 100) / 100,
      'Kasama sa average': basis.indexOf(m) >= 0 ? 'Oo' : (avgMonthStatus(d, m) === 'kasalukuyan' ? 'Hindi (kasalukuyang buwan)' : (avgMonthStatus(d, m) ? 'Hindi (wala pa)' : 'Hindi (walang benta pa)'))
    }));
    salesRows.push({ Buwan: '', Benta: '', 'Kasama sa average': '' });
    salesRows.push({ Buwan: 'KABUUANG BENTA ' + y, Benta: Math.round(d.total * 100) / 100, 'Kasama sa average': '' });
    salesRows.push({ Buwan: 'AVERAGE KADA BUWAN (' + (d.completeMonths.length ? 'kumpletong buwan' : 'kasama ang kasalukuyan') + ')',
      Benta: (d.completeMonths.length ? d.avgComplete : d.avgIncl) === null ? '' : Math.round((d.completeMonths.length ? d.avgComplete : d.avgIncl) * 100) / 100, 'Kasama sa average': basis.length + ' buwan' });
    if(d.completeMonths.length && d.avgIncl !== null)
      salesRows.push({ Buwan: 'Average kung kasama ang kasalukuyang buwan', Benta: Math.round(d.avgIncl * 100) / 100, 'Kasama sa average': d.inclMonths.length + ' buwan' });
    add('Avg Benta kada Buwan', avgSheet(salesRows), d.monthSales.length);

    // 2) Average ng kilo kada group
    const kgRows = d.groups.map(g => {
      const o = { Group: g.name };
      AVG_MONTHS.forEach((mn, m) => { o[mn + ' (kg)'] = Math.round(g.kg[m] * 1000) / 1000; });
      o['Kabuuan (kg)'] = Math.round(g.totalKg * 1000) / 1000;
      const a = d.completeMonths.length ? g.avgKgComplete : g.avgKgIncl;
      o['Average kg / buwan'] = a === null ? '' : Math.round(a * 1000) / 1000;
      o['Kabuuang pcs'] = g.totalPcs;
      o['Pcs na walang timbang'] = g.unknownPcs;
      return o;
    });
    add('Avg Kg kada Group', avgSheet(kgRows, 'Wala pang benta'), kgRows.length);
    const topAll = avgTopCompute(consigns.rows, y, members.rows, avgRawSales);
    let rk = 0;
    const topRows = avgTopSorted(topAll, 'value').map(r => {
      const has = r.value > 0 || r.pcs > 0;
      if(has) rk++;
      return {
        Rank: has ? rk : '', Member: r.name, 'Top 10': has && rk <= 10 ? 'Oo' : '',
        'Kabuuang halaga': Math.round(r.value * 100) / 100,
        'Nabenta sa Consign': Math.round(r.cV * 100) / 100,
        'Binili (Sell)': Math.round(r.bV * 100) / 100,
        'Sa utang (kasama sa Binili)': Math.round(r.uV * 100) / 100,
        Pcs: r.pcs, Kilo: Math.round(r.kg * 1000) / 1000,
        'Bilang ng consignment': r.n, 'Bilang ng bili': r.bn
      };
    });
    if(topAll.untagged) topRows.push({ Rank: '', Member: 'Consignment na hindi naka-tag sa member', 'Top 10': '', 'Kabuuang halaga': '', 'Nabenta sa Consign': '', 'Binili (Sell)': '', 'Sa utang (kasama sa Binili)': '', Pcs: topAll.untagged, Kilo: '', 'Bilang ng consignment': '', 'Bilang ng bili': '' });
    add('Top Members', avgSheet(topRows, 'Wala pang members'), topRows.length, consigns.error);
    if(d.noWeight.length)
      add('Walang Timbang', avgSheet(d.noWeight.map(x => ({ Product: x.name, Pcs: x.pcs, Tip: 'Ilagay ang timbang sa pangalan, hal. 250g' }))), d.noWeight.length);

    // 3) Products inventory
    const prodRows = products.rows.map(p => {
      const w = avgParseWeightG(p.name);
      return {
        Product: p.name, Group: avgGroupOf(p.name),
        'Timbang (g)': w === null ? '' : Math.round(w * 100) / 100,
        Presyo: Number(p.price) || 0, Discount: Number(p.discount) || 0,
        Stock: Number(p.stock) || 0, Status: (Number(p.stock) || 0) <= 5 ? 'MABABA' : 'OK'
      };
    });
    add('Products (Inventory)', avgSheet(prodRows, 'Walang product'), prodRows.length, products.error);

    // 4) Supplies inventory
    const supRows = supplies.rows.map(s => ({
      Supply: s.name, Category: s.category || '', Unit: s.unit || '',
      Stock: Number(s.stock) || 0, 'Low level': Number(s.low_level) || 0,
      Status: (Number(s.low_level) || 0) > 0 && (Number(s.stock) || 0) <= (Number(s.low_level) || 0) ? 'MABABA' : 'OK'
    }));
    add('Supplies (Inventory)', avgSheet(supRows, 'Walang supply'), supRows.length, supplies.error);

    // 5) Members (kasama ang shares at pondo)
    const byMember = {};
    contribs.rows.forEach(c => {
      const m = byMember[c.member_id] || (byMember[c.member_id] = { shares: 0, share: 0, other: 0 });
      const amt = Number(c.amount) || 0;
      if(String(c.fund || '').trim().toLowerCase() === 'share capital'){ m.share += amt; m.shares += Number(c.shares) || 0; }
      else m.other += amt;
    });
    const memRows = members.rows.map(m => {
      const b = byMember[m.id] || { shares: 0, share: 0, other: 0 };
      return {
        Pangalan: m.full_name, Contact: m.phone || '',
        'No. of Shares': b.shares, 'Share Capital': Math.round(b.share * 100) / 100,
        'Ibang Pondo': Math.round(b.other * 100) / 100, Kabuuan: Math.round((b.share + b.other) * 100) / 100
      };
    });
    if(memRows.length) memRows.push({
      Pangalan: 'KABUUAN (' + memRows.length + ' members)', Contact: '',
      'No. of Shares': memRows.reduce((s, r) => s + r['No. of Shares'], 0),
      'Share Capital': Math.round(memRows.reduce((s, r) => s + r['Share Capital'], 0) * 100) / 100,
      'Ibang Pondo': Math.round(memRows.reduce((s, r) => s + r['Ibang Pondo'], 0) * 100) / 100,
      Kabuuan: Math.round(memRows.reduce((s, r) => s + r.Kabuuan, 0) * 100) / 100
    });
    add('Members', avgSheet(memRows, 'Walang member'), members.rows.length, members.error);

    // 6) Bank accounts + history
    const label = { sales: 'Sales', share_capital: 'Share Capital', reserve_fund: 'Reserve Fund', other: 'Iba pa' };
    const acctName = {};
    banks.rows.forEach(a => { acctName[a.id] = label[a.purpose] || a.purpose; });
    const bankRows = banks.rows.map(a => ({
      Account: label[a.purpose] || a.purpose, Description: a.description || '',
      Amount: Number(a.amount) || 0, 'As of': avgDate(a.as_of)
    }));
    if(bankRows.length) bankRows.push({ Account: 'KABUUAN', Description: '', Amount: Math.round(bankRows.reduce((s, r) => s + r.Amount, 0) * 100) / 100, 'As of': '' });
    add('Bank Accounts', avgSheet(bankRows, 'Walang bank account'), banks.rows.length, banks.error);
    const kindLabel = { deposit: 'Cash Deposit (Ledger)', transfer: 'Cash Transfer (Ledger)', manual: 'Manual', adjust: 'Itinakda', void: 'Void (Ledger)' };
    const bhRows = bankHist.rows.map(h => ({
      Petsa: h.created_at ? new Date(h.created_at).toLocaleString() : '', Account: acctName[h.account_id] || '',
      Uri: kindLabel[h.kind] || h.kind, Galaw: Number(h.change) || 0,
      'Balance pagkatapos': Number(h.balance_after) || 0, Remarks: h.remarks || ''
    }));
    add('Bank History', avgSheet(bhRows, 'Wala pang galaw'), bhRows.length, bankHist.error);

    // 7) Ledger
    const ledRows = ledger.rows.map(e => ({
      Petsa: avgDate(e.entry_date || e.created_at), Detalye: e.details || '', Qty: e.qty || '', PIC: e.pic || '',
      Pasok: Number(e.amount_in) || 0, Labas: Number(e.amount_out) || 0,
      Source: e.source || '',
      Uri: e.is_deposit ? 'Cash Deposit' : (e.is_transfer ? 'Cash Transfer' : ''),
      Status: e.voided ? 'VOID' : '', 'Dahilan ng void': e.void_reason || ''
    }));
    add('Ledger', avgSheet(ledRows, 'Walang entry'), ledRows.length, ledger.error);

    // 8) Utang (receivables)
    const paidOf = s => (s.receivable_payments || []).reduce((t, p) => t + (p.voided ? 0 : (Number(p.amount) || 0)), 0);
    const utangRows = recvSales.rows.filter(s => !s.voided).map(s => {
      const total = Number(s.total) || 0, paid = paidOf(s), bal = Math.max(0, Math.round((total - paid) * 100) / 100);
      return {
        Petsa: avgDate(s.created_at), Buyer: s.buyer_name || '',
        Items: (s.sale_items || []).map(i => i.qty + 'x ' + i.product_name).join(', '),
        Total: total, Nabayaran: Math.round(paid * 100) / 100, Balance: bal, Status: bal > 0 ? 'May balance' : 'Bayad na'
      };
    });
    if(utangRows.length) utangRows.push({
      Petsa: 'KABUUAN', Buyer: '', Items: '',
      Total: Math.round(utangRows.reduce((s, r) => s + r.Total, 0) * 100) / 100,
      Nabayaran: Math.round(utangRows.reduce((s, r) => s + r.Nabayaran, 0) * 100) / 100,
      Balance: Math.round(utangRows.reduce((s, r) => s + r.Balance, 0) * 100) / 100, Status: ''
    });
    add('Utang', avgSheet(utangRows, 'Walang utang'), recvSales.rows.length, recvSales.error);
    const payRows = recvPays.rows.map(p => ({
      'Petsa ng bayad': avgDate(p.paid_on || p.created_at), Buyer: (p.sales && p.sales.buyer_name) || '',
      Halaga: Number(p.amount) || 0, Remarks: p.remarks || '', Status: p.voided ? 'VOID' : ''
    }));
    add('Utang Bayad', avgSheet(payRows, 'Wala pang bayad'), payRows.length, recvPays.error);

    // 9) Consignment
    const conRows = consigns.rows.map(c => {
      const its = c.consignment_items || [];
      const sent = its.reduce((s, i) => s + (Number(i.qty_sent) || 0), 0);
      const sold = its.reduce((s, i) => s + (Number(i.qty_sold) || 0), 0);
      const ret = its.reduce((s, i) => s + (Number(i.qty_returned) || 0), 0);
      const value = its.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty_sold) || 0), 0);
      return {
        'Petsa ng send': avgDate(c.created_at), Consignee: c.consignee || '', Member: c.member_name || '',
        Status: c.voided ? 'VOID' : (c.status || ''), 'Petsa ng settle': avgDate(c.settled_at),
        Sent: sent, Sold: sold, Returned: ret, Kulang: sent - sold - ret,
        'Halaga ng nabenta': Math.round(value * 100) / 100, Note: c.note || ''
      };
    });
    add('Consignment', avgSheet(conRows, 'Walang consignment'), conRows.length, consigns.error);
    const conItemRows = [];
    consigns.rows.forEach(c => (c.consignment_items || []).forEach(i => conItemRows.push({
      'Petsa ng send': avgDate(c.created_at), Consignee: c.consignee || '', Status: c.voided ? 'VOID' : (c.status || ''),
      Product: i.product_name || '', Presyo: Number(i.price) || 0,
      Sent: Number(i.qty_sent) || 0, Sold: Number(i.qty_sold) || 0, Returned: Number(i.qty_returned) || 0,
      Kulang: (Number(i.qty_sent) || 0) - (Number(i.qty_sold) || 0) - (Number(i.qty_returned) || 0)
    })));
    add('Consignment Items', avgSheet(conItemRows, 'Walang item'), conItemRows.length, consigns.error);

    const stamp = new Date();
    const head = [
      { Sheet: 'Ginawa', Rows: '', Status: stamp.toLocaleString() },
      { Sheet: 'Taon ng report', Rows: '', Status: String(y) },
      { Sheet: 'Paalala', Rows: '', Status: 'Ang kilo ay galing sa timbang na nakasulat sa pangalan ng product (hal. 250g). Hindi kasama ang freebies at void.' }
    ];
    XLSX.utils.book_append_sheet(wb, avgSheet(head.concat(summary)), 'Summary');
    // gawing unang sheet ang Summary
    wb.SheetNames.unshift(wb.SheetNames.pop());
    const mm = String(stamp.getMonth() + 1).padStart(2, '0'), dd = String(stamp.getDate()).padStart(2, '0');
    XLSX.writeFile(wb, `CCFACO-Reports-${stamp.getFullYear()}-${mm}-${dd}.xlsx`);
    const failed = summary.filter(x => /^Na-skip/.test(x.Status)).length;
    showToast(failed ? 'Na-download ang Excel (may na-skip na ' + failed + ', tingnan ang Summary).' : 'Na-download ang Excel.');
  }catch(e){
    showToast('Hindi nagawa ang Excel: ' + (e.message || e), true);
  }
  state.avgExporting = false;
  [document.getElementById('btn-avg-export'), document.getElementById('btn-export-reports')].forEach(b => {
    if(b){ b.disabled = false; b.textContent = b.id === 'btn-avg-export' ? 'Export (Excel)' : 'Download reports + inventory (Excel)'; }
  });
}
