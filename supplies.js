/* ---------- Supplies (packaging, stickers, ingredients) ----------
   Separate inventory for things we BUY (not sell).
   - Buying: add a Ledger "Out" entry and pick the supply + qty  -> stock goes up automatically.
   - Using:  Supplies tab -> "Gamitin"                          -> stock goes down.
   - Admin + cashier: Edit (rename, category, unit, low level) + Adjust stock (add / remove) in one panel, same as Products. Only Admin can Delete a supply or Void a "use" record.
   Needs the "Supplies" SQL in Settings (supplies, supply_logs, ledger columns, supply_adjust function). */

Object.assign(state, {
  suppliesReady: false,   // true once the supplies table + ledger columns exist (Settings SQL: Supplies)
  supplies: [],
  supplyLogs: [],
  supplySearch: '',
  supplyDraft: { name: '', category: 'Packaging', unit: 'pcs', stock: '', low: '' },
  supplyPanel: null,      // { id, mode: 'use' | 'history' | 'edit', ... }  (edit = fields + addQty/remQty)
  supplyBusy: false
});

const SUPPLY_CATEGORIES = ['Packaging', 'Sticker', 'Ingredient', 'Other'];
const SUPPLY_KIND_LABEL = { opening: 'Panimulang stock', buy: 'Bili (Ledger)', use: 'Gamit', adjust: 'Adjust', 'void-buy': 'Void ng bili', edit: 'Edit' };

function supplyById(id){ return state.supplies.find(s => s.id === id); }
// Admin and cashier can Edit / Adjust stock; only Admin can Delete. Viewers can do neither.
function canEditSupply(){ return isAdmin() || state.role === 'cashier'; }
function fmtSupplyQty(n){ return String(Math.round((Number(n) || 0) * 1000) / 1000); }

async function checkSuppliesReady(){
  try{
    const [a, b] = await Promise.all([
      fetch(`${state.supaUrl}/rest/v1/supplies?select=id&limit=1`, { headers: supaHeaders() }),
      fetch(`${state.supaUrl}/rest/v1/ledger_entries?select=supply_id&limit=1`, { headers: supaHeaders() })
    ]);
    state.suppliesReady = a.ok && b.ok;
  }catch(e){
    state.suppliesReady = false;
  }
}

async function loadSuppliesData(){
  if(!state.suppliesReady) await checkSuppliesReady();
  if(state.suppliesReady) await fetchSupplies();
}

async function fetchSupplies(){
  if(!state.connected || !state.suppliesReady) return;
  try{
    const [r1, r2] = await Promise.all([
      fetch(`${state.supaUrl}/rest/v1/supplies?select=*&order=name.asc&limit=1000`, { headers: supaHeaders() }),
      fetch(`${state.supaUrl}/rest/v1/supply_logs?select=*&order=created_at.desc&limit=400`, { headers: supaHeaders() })
    ]);
    if(!r1.ok) throw new Error('Failed to load supplies');
    const supplyRows = await r1.json();
    state.supplies = supplyRows;
    if(r2.ok) state.supplyLogs = await r2.json();
  }catch(e){
    showToast('Could not load supplies: ' + e.message, true);
  }
  render();
}

// Atomic +/- on the stock (the database refuses to go below zero)
async function supplyAdjustRpc(id, delta){
  const res = await fetch(`${state.supaUrl}/rest/v1/rpc/supply_adjust`, {
    method: 'POST', headers: supaHeaders(),
    body: JSON.stringify({ p_supply: id, p_delta: delta })
  });
  let body = null;
  try{ body = await res.json(); }catch(e){}
  if(!res.ok){
    const msg = (body && body.message) ? body.message : ('HTTP ' + res.status);
    throw new Error(/stock/i.test(msg) ? 'Hindi sapat ang stock.' : msg);
  }
  return Number(body);
}

async function addSupplyLog(row){
  const res = await fetch(`${state.supaUrl}/rest/v1/supply_logs`, {
    method: 'POST', headers: supaHeaders(),
    body: JSON.stringify([Object.assign({ created_by: (state.user && state.user.email) ? state.user.email : null }, row)])
  });
  if(!res.ok) throw new Error('Could not save the supply history');
}

async function addSupply(){
  if(blockViewer()) return;
  if(state.supplyBusy) return;
  const d = state.supplyDraft;
  const name = (d.name || '').trim();
  if(!name){ showToast('Isulat ang pangalan ng supply.', true); return; }
  if(state.supplies.some(s => (s.name || '').trim().toLowerCase() === name.toLowerCase())){ showToast('Meron nang supply na ganyan ang pangalan.', true); return; }
  const stock = Number(d.stock) || 0;
  const low = Number(d.low) || 0;
  if(stock < 0 || low < 0){ showToast('Hindi puwedeng negatibo.', true); return; }
  state.supplyBusy = true;
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/supplies`, {
      method: 'POST', headers: supaHeaders(),
      body: JSON.stringify([{ name, category: d.category || 'Other', unit: (d.unit || '').trim() || 'pcs', stock, low_level: low }])
    });
    if(!res.ok) throw new Error('Could not save the supply');
    const row = (await res.json())[0];
    if(stock > 0 && row){
      try{ await addSupplyLog({ supply_id: row.id, kind: 'opening', delta: stock, balance_after: stock, remarks: 'Panimulang stock' }); }catch(e){}
    }
    state.supplyDraft = { name: '', category: d.category, unit: d.unit, stock: '', low: '' };
    await fetchSupplies();
    showToast('Nadagdag ang supply.');
  }catch(e){
    showToast('Could not add supply: ' + e.message, true);
  }
  state.supplyBusy = false;
}

async function submitSupplyPanel(){
  const p = state.supplyPanel;
  if(!p || p.busy || blockViewer()) return;
  const s = supplyById(p.id);
  if(!s) return;
  const qty = Number(p.qty);
  const remarks = (p.remarks || '').trim();
  if(p.mode !== 'use') return;
  if(!(qty > 0)){ showToast('Ilagay kung ilan ang ginamit.', true); return; }
  if(qty > Number(s.stock)){ showToast('Kulang ang stock: ' + fmtSupplyQty(s.stock) + ' ' + s.unit + ' lang ang natitira.', true); return; }
  p.busy = true; render();
  try{
    const delta = -qty;
    const newStock = await supplyAdjustRpc(s.id, delta);
    await addSupplyLog({ supply_id: s.id, kind: p.mode, delta, balance_after: newStock, remarks: remarks || null });
    state.supplyPanel = null;
    await fetchSupplies();
    showToast('Nabawasan ng ' + fmtSupplyQty(qty) + ' ' + s.unit + '. Natitira: ' + fmtSupplyQty(newStock) + '.');
  }catch(e){
    if(state.supplyPanel) state.supplyPanel.busy = false;
    showToast('Could not save: ' + e.message, true);
    render();
  }
}

// Admin/cashier: add or remove stock from the Edit panel (like Products: "Add to stock" / "Deduct from stock"). Logged in supply history as "Adjust".
async function changeSupplyStock(sign){
  const p = state.supplyPanel;
  if(!p || p.mode !== 'edit' || p.busy || blockViewer()) return;
  if(!canEditSupply()){ showToast('Walang permission mag-adjust ng stock.', true); return; }
  const s = supplyById(p.id);
  if(!s) return;
  const qty = Number(sign > 0 ? p.addQty : p.remQty);
  if(!(qty > 0)){ showToast(sign > 0 ? 'Ilagay kung ilan ang idadagdag.' : 'Ilagay kung ilan ang ibabawas.', true); return; }
  if(sign < 0 && qty > Number(s.stock)){
    showToast('Hindi puwede: ' + fmtSupplyQty(s.stock) + ' ' + (s.unit || '') + ' lang ang stock.', true); return;
  }
  p.busy = true; render();
  try{
    const delta = sign > 0 ? qty : -qty;
    const newStock = await supplyAdjustRpc(s.id, delta);
    try{
      await addSupplyLog({ supply_id: s.id, kind: 'adjust', delta, balance_after: newStock,
        remarks: sign > 0 ? 'Dagdag sa stock (Edit)' : 'Bawas sa stock (inventory correction)' });
    }catch(e){
      showToast('Nabago ang stock, pero hindi naitala sa history.', true);
    }
    if(state.supplyPanel && state.supplyPanel.id === s.id){
      state.supplyPanel.busy = false;
      if(sign > 0) state.supplyPanel.addQty = ''; else state.supplyPanel.remQty = '';
    }
    await fetchSupplies();
    showToast((sign > 0 ? '+' : '-') + fmtSupplyQty(qty) + ' ' + s.name + ' \u2014 ' + fmtSupplyQty(newStock) + ' ' + (s.unit || '') + ' na ngayon.');
  }catch(e){
    if(state.supplyPanel) state.supplyPanel.busy = false;
    showToast('Could not adjust stock: ' + e.message, true);
    render();
  }
}

// Admin/cashier: rename / edit a supply (name, category, unit, low-stock level). Stock is changed by "Add/Deduct" in the same panel, Gamitin, or Ledger.
async function saveSupplyEdit(){
  const p = state.supplyPanel;
  if(!p || p.mode !== 'edit' || p.busy) return;
  if(!canEditSupply()){ showToast('Walang permission mag-edit ng supply.', true); return; }
  const s = supplyById(p.id);
  if(!s) return;
  const name = (p.name || '').trim();
  const unit = (p.unit || '').trim() || 'pcs';
  const low = Number(p.low) || 0;
  if(!name){ showToast('Isulat ang pangalan ng supply.', true); return; }
  if(low < 0){ showToast('Hindi puwedeng negatibo.', true); return; }
  if(state.supplies.some(x => x.id !== s.id && (x.name || '').trim().toLowerCase() === name.toLowerCase())){
    showToast('Meron nang ibang supply na ganyan ang pangalan.', true); return;
  }
  p.busy = true; render();
  try{
    await patchRows(`supplies?id=eq.${s.id}`, { name, category: p.category || 'Other', unit, low_level: low }, true);
    const changes = [];
    if(name !== s.name) changes.push('pangalan: "' + s.name + '" \u2192 "' + name + '"');
    if((p.category || 'Other') !== s.category) changes.push('category: ' + s.category + ' \u2192 ' + (p.category || 'Other'));
    if(unit !== s.unit) changes.push('unit: ' + s.unit + ' \u2192 ' + unit);
    if(low !== (Number(s.low_level) || 0)) changes.push('low-stock: ' + fmtSupplyQty(s.low_level) + ' \u2192 ' + fmtSupplyQty(low));
    if(changes.length){
      try{ await addSupplyLog({ supply_id: s.id, kind: 'edit', delta: 0, balance_after: Number(s.stock) || 0, remarks: changes.join('; ') }); }catch(e){}
    }
    state.supplyPanel = null;
    await fetchSupplies();
    showToast('Na-update ang supply.');
  }catch(e){
    if(state.supplyPanel) state.supplyPanel.busy = false;
    showToast('Could not update supply: ' + e.message, true);
    render();
  }
}

// Admin: delete a supply. Its history (supply_logs) goes with it; Ledger entries stay but lose the supply link.
async function deleteSupply(id){
  if(blockViewer()) return;
  if(!isAdmin()){ showToast('Admin lang ang puwedeng mag-delete ng supply.', true); return; }
  const s = supplyById(id);
  if(!s) return;
  const logCount = state.supplyLogs.filter(x => x.supply_id === id).length;
  const msg = 'Sigurado ka bang buburahin ang supply na "' + s.name + '"?'
    + (logCount ? '\n\nMabubura rin ang ' + logCount + ' na history record niya (bili/gamit/adjust).' : '')
    + (Number(s.stock) > 0 ? '\nMay stock pa na ' + fmtSupplyQty(s.stock) + ' ' + (s.unit || '') + '.' : '')
    + '\n\nHindi na ito maibabalik.';
  if(!confirm(msg)) return;
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/supplies?id=eq.${id}`, { method: 'DELETE', headers: supaHeaders() });
    let rows = [];
    try{ rows = await res.json(); }catch(e){}
    if(!res.ok) throw new Error((rows && rows.message) || ('HTTP ' + res.status));
    if(!Array.isArray(rows) || rows.length === 0) throw new Error('Walang nabura. Kulang ang permission \u2014 i-run ang "Supplies: Admin edit/delete" SQL sa Settings.');
    if(state.supplyPanel && state.supplyPanel.id === id) state.supplyPanel = null;
    await fetchSupplies();
    showToast('Nabura ang supply.');
  }catch(e){
    showToast('Could not delete supply: ' + e.message, true);
  }
}

// Admin: void a "Gamit" record -> the quantity goes back to stock
async function voidSupplyUse(logId, reason){
  if(!isAdmin()) throw new Error('Admin lang ang puwedeng mag-void.');
  const lg = state.supplyLogs.find(x => x.id === logId);
  if(!lg) throw new Error('Hindi mahanap ang record. I-refresh ang Supplies tab.');
  if(lg.voided) throw new Error('Na-void na ang record na ito.');
  if(lg.kind !== 'use') throw new Error('Gamit lang ang puwedeng i-void dito.');
  const back = -Number(lg.delta);
  await supplyAdjustRpc(lg.supply_id, back);
  try{
    await patchRows(`supply_logs?id=eq.${logId}`, voidStamp(reason), true);
  }catch(e){
    try{ await supplyAdjustRpc(lg.supply_id, -back); }catch(e2){}
    throw e;
  }
  await fetchSupplies();
  showToast('Na-void. Bumalik sa stock ang ' + fmtSupplyQty(back) + '.');
  return true;
}

/* ----- Ledger link: buying a supply through a Ledger "Out" entry ----- */

// called by addLedgerEntry after the ledger row was saved
async function supplyAfterLedgerBuy(entry, supplyId, qty, outAmount){
  try{
    const newStock = await supplyAdjustRpc(supplyId, qty);
    await addSupplyLog({
      supply_id: supplyId, kind: 'buy', delta: qty, balance_after: newStock,
      unit_cost: qty > 0 ? Math.round((outAmount / qty) * 10000) / 10000 : null,
      ledger_id: entry && entry.id ? entry.id : null, remarks: entry && entry.details ? entry.details : null
    });
    return true;
  }catch(e){
    showToast('Naitala ang Ledger, pero hindi nadagdagan ang stock (' + e.message + '). Gamitin ang Edit / Adjust sa Supplies tab.', true);
    return false;
  }
}

// called by voidLedgerEntry: take the bought quantity back out of stock (refuses if already used)
async function supplyUndoLedgerBuy(e, reason){
  if(!e.supply_id || !(Number(e.supply_qty) > 0)) return null;
  const qty = Number(e.supply_qty);
  let newStock;
  try{
    newStock = await supplyAdjustRpc(e.supply_id, -qty);
  }catch(err){
    throw new Error('Hindi ma-void: nagamit na ang bahagi ng supply na ito (kulang ang stock para bawiin ang ' + fmtSupplyQty(qty) + '). I-adjust muna sa Supplies tab (Edit / Adjust).');
  }
  try{ await addSupplyLog({ supply_id: e.supply_id, kind: 'void-buy', delta: -qty, balance_after: newStock, ledger_id: e.id, remarks: reason }); }catch(err){}
  return qty;
}
async function supplyRestoreLedgerBuy(e){
  try{ await supplyAdjustRpc(e.supply_id, Number(e.supply_qty)); }catch(err){}
}

// extra fields in the Ledger "Add entry" form
function ledgerSupplyFieldsHtml(d){
  if(!state.suppliesReady || isViewer()) return '';
  const opts = ['<option value="">\u2014 hindi supply \u2014</option>'].concat(state.supplies.map(s =>
    `<option value="${s.id}" ${d.supply_id === s.id ? 'selected' : ''}>${escapeHtml(s.name)} (${escapeHtml(s.unit || 'pcs')}) \u00B7 stock ${fmtSupplyQty(s.stock)}</option>`)).join('');
  return `
      <div class="row2 ledger-supply-row">
        <div class="field"><label for="lg-supply">Supply</label><select id="lg-supply">${opts}</select></div>
        <div class="field"><label for="lg-supply-qty">Quantity</label><input id="lg-supply-qty" type="number" step="any" min="0" placeholder="0" value="${escapeHtml(d.supply_qty || '')}"></div>
      </div>
      ${d.supply_id ? '<div class="setup-note" style="margin:-4px 0 10px;">Ilagay ang halaga sa <b>Out</b>. Madadagdag ang stock pag na-save, at makikita ang presyo bawat piraso sa history.</div>' : ''}`;
}

function supplyTagHtml(e){
  if(!e.supply_id || !(Number(e.supply_qty) > 0)) return '';
  const s = supplyById(e.supply_id);
  return ' <span class="tag">+' + fmtSupplyQty(e.supply_qty) + ' ' + escapeHtml(s ? s.name : 'supply') + '</span>';
}

/* ----- The Supplies tab ----- */

function supplyLastCost(id){
  const lg = state.supplyLogs.find(x => x.supply_id === id && x.kind === 'buy' && !x.voided && x.unit_cost != null);
  return lg ? Number(lg.unit_cost) : null;
}

function supplyHistoryHtml(s){
  const rows = state.supplyLogs.filter(x => x.supply_id === s.id);
  if(!rows.length) return '<div class="empty">Wala pang history.</div>';
  return rows.map(lg => {
    const d = Number(lg.delta) || 0;
    const when = lg.created_at ? new Date(lg.created_at).toLocaleString() : '';
    const canVoid = isAdmin() && state.voidCol && lg.kind === 'use' && !lg.voided;
    if(lg.kind === 'edit'){
      return `
      <div class="sub" style="margin-top:6px;">
        ${escapeHtml(when)} \u00B7 <b>Edit</b>${lg.remarks ? ' \u00B7 ' + escapeHtml(lg.remarks) : ''}${lg.created_by ? ' \u00B7 ' + escapeHtml(lg.created_by) : ''}
      </div>`;
    }
    return `
      <div class="sub" style="margin-top:6px; ${lg.voided ? 'opacity:0.6;' : ''}">
        ${escapeHtml(when)} \u00B7 <b>${escapeHtml(SUPPLY_KIND_LABEL[lg.kind] || lg.kind)}</b>
        <span class="mono" style="color:${d >= 0 ? 'var(--pos)' : 'var(--neg)'};">${d >= 0 ? '+' : ''}${fmtSupplyQty(d)}</span>
        \u2192 ${fmtSupplyQty(lg.balance_after)} ${escapeHtml(s.unit || '')}
        ${lg.kind === 'buy' && lg.unit_cost != null ? ' \u00B7 ' + money(lg.unit_cost) + ' bawat ' + escapeHtml(s.unit || 'pc') : ''}
        ${lg.remarks ? ' \u00B7 ' + escapeHtml(lg.remarks) : ''}
        ${lg.created_by ? ' \u00B7 ' + escapeHtml(lg.created_by) : ''}
        ${lg.voided ? ' <span class="tag void">VOIDED</span>' : ''}
        ${canVoid ? ` <button class="ghost void-btn" data-void-supply-log="${lg.id}">Void</button>` : ''}
      </div>`;
  }).join('');
}

function supplyPanelHtml(s){
  const p = state.supplyPanel;
  if(!p || p.id !== s.id) return '';
  if(p.mode === 'history'){
    return `<div style="margin-top:8px;">${supplyHistoryHtml(s)}<button class="ghost" data-supply-cancel="1" style="margin-top:8px;">Isara</button></div>`;
  }
  if(p.mode === 'edit'){
    const eCat = SUPPLY_CATEGORIES.map(c => `<option ${p.category === c ? 'selected' : ''}>${c}</option>`).join('');
    const dis = p.busy ? 'disabled' : '';
    return `
    <div style="margin-top:8px; padding:10px; border:1px solid var(--line, #3a4a44); border-radius:10px;">
      <h2 style="margin-top:0;">Edit ${escapeHtml(s.name)}</h2>
      <div class="field"><label>Pangalan</label><input id="sp-edit-name" value="${escapeHtml(p.name || '')}" autocomplete="off"></div>
      <div class="row2">
        <div class="field"><label>Category</label><select id="sp-edit-cat">${eCat}</select></div>
        <div class="field"><label>Unit</label><input id="sp-edit-unit" value="${escapeHtml(p.unit || '')}"></div>
      </div>
      <div class="field"><label>Low-stock level</label><input id="sp-edit-low" type="number" step="any" min="0" placeholder="0" value="${escapeHtml(p.low || '')}"></div>
      <button class="primary" data-supply-save="1" ${dis}>${p.busy ? 'Saving...' : 'Save changes'}</button>
      <div style="border-top:1px solid var(--line, #3a4a44); margin:18px 0 14px;"></div>
      <h2 style="margin-top:0;">Adjust stock</h2>
      <div class="meta" style="font-size:12px; color:var(--ink-dim); margin-bottom:10px;">Current stock: <span class="mono">${fmtSupplyQty(s.stock)} ${escapeHtml(s.unit || '')}</span>. Bumababa ito sa <b>Gamitin</b> at tumataas sa Ledger bili. Lahat ng adjust ay nasa History.</div>
      <div class="row2">
        <div class="field"><label>Add (${escapeHtml(s.unit || 'pcs')})</label><input id="sp-add-qty" type="number" step="any" min="0" placeholder="0" value="${escapeHtml(p.addQty || '')}"></div>
        <div class="field"><label>&nbsp;</label><button class="ghost" data-supply-add="1" style="width:100%; padding:9px;" ${dis}>Add to stock</button></div>
      </div>
      <div class="row2">
        <div class="field"><label>Remove (inventory correction)</label><input id="sp-rem-qty" type="number" step="any" min="0" placeholder="0" value="${escapeHtml(p.remQty || '')}"></div>
        <div class="field"><label>&nbsp;</label><button class="ghost" data-supply-rem="1" style="width:100%; padding:9px;" ${dis}>Deduct from stock</button></div>
      </div>
      <button class="ghost" data-supply-cancel="1" style="width:100%;" ${dis}>Done</button>
    </div>`;
  }
  const isUse = p.mode === 'use';
  return `
    <div style="margin-top:8px; padding:10px; border:1px solid var(--line, #3a4a44); border-radius:10px;">
      <div class="row2">
        <div class="field"><label>${isUse ? 'Ilan ang ginamit' : 'Bagong bilang (physical count)'} (${escapeHtml(s.unit || 'pcs')})</label>
          <input id="sp-qty" type="number" step="any" min="0" placeholder="0" value="${escapeHtml(p.qty || '')}"></div>
        <div class="field"><label>${isUse ? 'Remarks (optional, hal. pagbote ng 20kg)' : 'Dahilan (kailangan)'}</label>
          <input id="sp-remarks" value="${escapeHtml(p.remarks || '')}" autocomplete="off"></div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="primary" data-supply-go="1" style="flex:1; margin-top:0;" ${p.busy ? 'disabled' : ''}>${p.busy ? 'Saving...' : (isUse ? 'Ibawas sa stock' : 'I-adjust')}</button>
        <button class="ghost" data-supply-cancel="1" style="flex:1;" ${p.busy ? 'disabled' : ''}>Cancel</button>
      </div>
    </div>`;
}

function renderSupplies(){
  if(!state.suppliesReady){
    return `<div class="panel">
      <h2>Supplies</h2>
      <div class="setup-note">Hindi pa naka-set up ang Supplies. Pumunta sa <strong>Settings</strong> (Admin only) at i-run ang SQL sa ilalim ng \"Supplies\" section, isang beses lang.</div>
    </div>`;
  }
  const d = state.supplyDraft;
  const catOpts = SUPPLY_CATEGORIES.map(c => `<option ${d.category === c ? 'selected' : ''}>${c}</option>`).join('');
  const addForm = isViewer() ? '' : `
    <div class="panel" style="margin-bottom:14px;">
      <h2>Magdagdag ng supply</h2>
      <div class="setup-note" style="margin-bottom:10px;">Dito ilista ang mga binibili (hindi binebenta). Ang pagdagdag ng stock ay sa <b>Ledger</b> (Out entry + piliin ang supply), at ang pagbawas ay sa <b>Gamitin</b> dito.</div>
      <div class="field"><label>Pangalan</label><input id="sp-new-name" placeholder="hal. Bote 300g, Sticker label, Asukal" value="${escapeHtml(d.name)}" autocomplete="off"></div>
      <div class="row2">
        <div class="field"><label>Category</label><select id="sp-new-cat">${catOpts}</select></div>
        <div class="field"><label>Unit</label><input id="sp-new-unit" placeholder="pcs, kg, roll" value="${escapeHtml(d.unit)}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Panimulang stock (optional)</label><input id="sp-new-stock" type="number" step="any" min="0" placeholder="0" value="${escapeHtml(d.stock)}"></div>
        <div class="field"><label>Low-stock level (optional)</label><input id="sp-new-low" type="number" step="any" min="0" placeholder="0" value="${escapeHtml(d.low)}"></div>
      </div>
      <button class="primary" id="btn-add-supply" ${state.supplyBusy ? 'disabled' : ''}>Add supply</button>
    </div>`;

  const q = state.supplySearch.trim().toLowerCase();
  const list = state.supplies.filter(s => !q || `${s.name} ${s.category} ${s.unit}`.toLowerCase().includes(q));
  const lowCount = state.supplies.filter(s => Number(s.low_level) > 0 && Number(s.stock) <= Number(s.low_level)).length;

  const rows = list.map(s => {
    const low = Number(s.low_level) > 0 && Number(s.stock) <= Number(s.low_level);
    const cost = supplyLastCost(s.id);
    const open = state.supplyPanel && state.supplyPanel.id === s.id;
    return `
    <div class="sale-row supply-row" data-supply-text="${escapeHtml((s.name + ' ' + s.category + ' ' + s.unit).toLowerCase())}">
      <div class="head">
        <span><b>${escapeHtml(s.name)}</b> <span class="tag">${escapeHtml(s.category || '')}</span>${low ? ' <span class="tag void">LOW</span>' : ''}</span>
        <span class="amt mono" style="${low ? 'color:var(--neg);' : ''}">${fmtSupplyQty(s.stock)} ${escapeHtml(s.unit || '')}</span>
      </div>
      <div class="items">
        ${Number(s.low_level) > 0 ? 'Low-stock: ' + fmtSupplyQty(s.low_level) : ''}${cost != null ? (Number(s.low_level) > 0 ? ' \u00B7 ' : '') + 'Huling bili: ' + money(cost) + ' bawat ' + escapeHtml(s.unit || 'pc') : ''}
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
        ${isViewer() ? '' : `<button class="primary" data-supply-use="${s.id}" style="margin-top:0; width:auto; padding:8px 14px;">Gamitin</button>`}
        <button class="ghost" data-supply-hist="${s.id}">History</button>
        ${canEditSupply() ? `<button class="ghost" data-supply-edit="${s.id}">Edit / Adjust</button>` : ''}
        ${isAdmin() ? `<button class="ghost void-btn" data-supply-del="${s.id}">Delete</button>` : ''}
      </div>
      ${open ? supplyPanelHtml(s) : ''}
    </div>`;
  }).join('') || `<div class="empty">${q ? 'Walang tugma sa search.' : 'Wala pang supply. Magdagdag sa itaas.'}</div>`;

  return `
  <div class="grid">
    <div class="panel">${addForm}</div>
    <div class="panel">
      <h2>Supplies${lowCount ? ` <span class="tag void">${lowCount} low</span>` : ''}</h2>
      <div class="field"><input id="in-supply-search" placeholder="Search supplies..." value="${escapeHtml(state.supplySearch)}"></div>
      ${rows}
    </div>
  </div>`;
}

function bindSupplies(app){
  const val = (id, fn) => { const el = document.getElementById(id); if(el) el.addEventListener('input', ()=> fn(el.value)); };

  /* Ledger form: supply link */
  const lgSupply = document.getElementById('lg-supply');
  if(lgSupply) lgSupply.addEventListener('change', ()=>{ state.ledgerDraft.supply_id = lgSupply.value; render(); });
  val('lg-supply-qty', v => { state.ledgerDraft.supply_qty = v; });

  /* Supplies tab */
  val('sp-new-name', v => { state.supplyDraft.name = v; });
  val('sp-new-unit', v => { state.supplyDraft.unit = v; });
  val('sp-new-stock', v => { state.supplyDraft.stock = v; });
  val('sp-new-low', v => { state.supplyDraft.low = v; });
  const cat = document.getElementById('sp-new-cat');
  if(cat) cat.addEventListener('change', ()=>{ state.supplyDraft.category = cat.value; });
  const addBtn = document.getElementById('btn-add-supply');
  if(addBtn) addBtn.addEventListener('click', addSupply);

  const search = document.getElementById('in-supply-search');
  if(search) search.addEventListener('input', ()=>{
    state.supplySearch = search.value;
    const q = search.value.trim().toLowerCase();
    app.querySelectorAll('.supply-row').forEach(r => { r.style.display = (!q || (r.dataset.supplyText || '').includes(q)) ? '' : 'none'; });
  });

  const openPanel = (id, mode) => { state.supplyPanel = { id, mode, qty: '', remarks: '', busy: false }; render(); };
  app.querySelectorAll('[data-supply-use]').forEach(b => b.addEventListener('click', ()=> openPanel(b.dataset.supplyUse, 'use')));
  app.querySelectorAll('[data-supply-hist]').forEach(b => b.addEventListener('click', ()=> openPanel(b.dataset.supplyHist, 'history')));
  app.querySelectorAll('[data-supply-edit]').forEach(b => b.addEventListener('click', ()=>{
    const s = supplyById(b.dataset.supplyEdit);
    if(!s) return;
    state.supplyPanel = { id: s.id, mode: 'edit', name: s.name || '', category: s.category || 'Other', unit: s.unit || '', low: Number(s.low_level) > 0 ? String(s.low_level) : '', addQty: '', remQty: '', busy: false };
    render();
  }));
  app.querySelectorAll('[data-supply-save]').forEach(b => b.addEventListener('click', saveSupplyEdit));
  app.querySelectorAll('[data-supply-add]').forEach(b => b.addEventListener('click', ()=> changeSupplyStock(1)));
  app.querySelectorAll('[data-supply-rem]').forEach(b => b.addEventListener('click', ()=> changeSupplyStock(-1)));
  val('sp-add-qty', v => { if(state.supplyPanel) state.supplyPanel.addQty = v; });
  val('sp-rem-qty', v => { if(state.supplyPanel) state.supplyPanel.remQty = v; });
  app.querySelectorAll('[data-supply-del]').forEach(b => b.addEventListener('click', ()=> deleteSupply(b.dataset.supplyDel)));
  val('sp-edit-name', v => { if(state.supplyPanel) state.supplyPanel.name = v; });
  val('sp-edit-unit', v => { if(state.supplyPanel) state.supplyPanel.unit = v; });
  val('sp-edit-low', v => { if(state.supplyPanel) state.supplyPanel.low = v; });
  const eCat = document.getElementById('sp-edit-cat');
  if(eCat) eCat.addEventListener('change', ()=>{ if(state.supplyPanel) state.supplyPanel.category = eCat.value; });
  app.querySelectorAll('[data-supply-cancel]').forEach(b => b.addEventListener('click', ()=>{ state.supplyPanel = null; render(); }));
  val('sp-qty', v => { if(state.supplyPanel) state.supplyPanel.qty = v; });
  val('sp-remarks', v => { if(state.supplyPanel) state.supplyPanel.remarks = v; });
  app.querySelectorAll('[data-supply-go]').forEach(b => b.addEventListener('click', submitSupplyPanel));
  app.querySelectorAll('[data-void-supply-log]').forEach(b => b.addEventListener('click', ()=>{
    const lg = state.supplyLogs.find(x => x.id === b.dataset.voidSupplyLog);
    const s = lg ? supplyById(lg.supply_id) : null;
    if(lg) openVoidPrompt('supply-use', lg.id, (s ? s.name : 'Supply') + ' \u00B7 gamit ' + fmtSupplyQty(-Number(lg.delta)));
  }));
}
