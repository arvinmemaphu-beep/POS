/* ---------- Void (Admin-only) ---------- */
// Nothing is deleted: a voided sale / ledger entry / consignment stays in the database
// marked VOIDED with a reason, who did it and when. Reports and the Ledger balance skip it.

async function checkVoidColumn(){
  try{
    const a = await fetch(`${state.supaUrl}/rest/v1/sales?select=voided&limit=1`, { headers: supaHeaders() });
    const b = await fetch(`${state.supaUrl}/rest/v1/consignments?select=voided,settle_sale_id&limit=1`, { headers: supaHeaders() });
    let c = true;
    if(state.ledgerReady){
      const r = await fetch(`${state.supaUrl}/rest/v1/ledger_entries?select=voided&limit=1`, { headers: supaHeaders() });
      c = r.ok;
    }
    state.voidCol = a.ok && b.ok && c;
  }catch(e){
    state.voidCol = false;
  }
}
async function checkMissingReady(){
  try{
    const r = await fetch(`${state.supaUrl}/rest/v1/consignment_events?select=id&limit=1`, { headers: supaHeaders() });
    state.missingReady = r.ok;
  }catch(e){
    state.missingReady = false;
  }
}
function notVoidedQ(){ return state.voidCol ? '&voided=is.false' : ''; }
function voidStamp(reason){
  return { voided: true, void_reason: reason, voided_at: new Date().toISOString(), voided_by: (state.user && state.user.email) ? state.user.email : null };
}
function voidNoteHtml(r){
  const when = r.voided_at ? new Date(r.voided_at).toLocaleString() : '';
  return `<div class="void-note">VOID: ${escapeHtml(r.void_reason || '(walang dahilan)')}${r.voided_by ? ' \u00B7 ' + escapeHtml(r.voided_by) : ''}${when ? ' \u00B7 ' + escapeHtml(when) : ''}</div>`;
}
// PATCH helper. With needRow it also fails loudly if the database silently updated nothing (blocked by RLS).
async function patchRows(path, body, needRow){
  const res = await fetch(`${state.supaUrl}/rest/v1/${path}`, { method:'PATCH', headers: supaHeaders(), body: JSON.stringify(body) });
  let rows = [];
  try{ rows = await res.json(); }catch(e){}
  if(!res.ok) throw new Error((rows && rows.message) || ('HTTP ' + res.status));
  if(needRow && (!Array.isArray(rows) || rows.length === 0)) throw new Error('Walang na-update. Kulang ang permission \u2014 i-run ang "Void" SQL sa Settings.');
  return rows;
}
// map: product_id -> qty. sign +1 puts stock back, -1 takes it out. One stock change per product.
async function adjustStockMap(map, sign, noteFn, action){
  for(const pid of Object.keys(map)){
    const prod = state.products.find(p => String(p.id) === String(pid));
    if(!prod || !map[pid]) continue;
    const next = Math.max(0, Math.floor((prod.stock || 0) + sign * map[pid]));
    await setStock(prod.id, next, noteFn(map[pid]), action);
    prod.stock = next;
  }
}
// pieces still not accounted for (not sold, not returned) on a settled consignment => it stays "Missing", not Settled
function consignLeftQty(i){ return Math.max(0, (Number(i.qty_sent)||0) - (Number(i.qty_sold)||0) - (Number(i.qty_returned)||0)); }
function consignMissingQty(c){
  if(!c || c.voided || c.status !== 'closed') return 0;
  return (c.consignment_items || []).reduce((s,i)=> s + consignLeftQty(i), 0);
}
// value of the original settlement sale only (late "bayad" sales of missing pieces are separate sales)
function consignSettleValue(c){
  const paid = (c.consignment_events || []).filter(e => e.kind === 'paid' && !e.voided).reduce((s,e)=> s + (Number(e.total)||0), 0);
  return Math.max(0, consignSoldValue(c) - paid);
}
function consignSoldValue(c){
  return (c.consignment_items || []).reduce((sum, i) => sum + consignUnitPrice(i, c) * (i.qty_sold || 0), 0);
}
// Is this sale the one a settled consignment produced? (old settlements have no saved link, so match by time + total)
function saleMatchesConsign(sale, c){
  if(!c.settled_at || c.status !== 'closed' || c.voided) return false;
  const dt = new Date(c.settled_at).getTime() - new Date(sale.created_at).getTime();
  return dt > -5*60000 && dt < 15*60000 && Math.abs(consignSettleValue(c) - Number(sale.total)) < 0.01;
}
async function findSettleSale(c, wantVal){
  if(c.settle_sale_id) return { id: c.settle_sale_id };
  if(!c.settled_at) return null;
  const t = new Date(c.settled_at).getTime();
  const from = encodeURIComponent(new Date(t - 15*60000).toISOString());
  const to = encodeURIComponent(new Date(t + 5*60000).toISOString());
  const res = await fetch(`${state.supaUrl}/rest/v1/sales?select=id,total,created_at&created_at=gte.${from}&created_at=lte.${to}&voided=is.false`, { headers: supaHeaders() });
  if(!res.ok) return null;
  const want = (wantVal !== undefined) ? wantVal : consignSettleValue(c);
  const hits = (await res.json()).filter(x => Math.abs(Number(x.total) - want) < 0.01);
  return hits.length === 1 ? hits[0] : null;
}
// Marks the Ledger entry of a sale as VOIDED. Looks it up by sale_id first; if that finds nothing, falls back to
// matching amount + time. Returns false when no entry could be updated (so the caller can warn).
async function voidLedgerForSale(saleId, total, createdAt, reason){
  if(!state.ledgerReady) return true;
  if(!(Number(total) > 0)) return true; // all-free sales have no ledger entry
  let rows = await patchRows(`ledger_entries?sale_id=eq.${saleId}&voided=is.false`, voidStamp(reason));
  if(rows.length) return true;
  if(!createdAt) return false;
  const t = new Date(createdAt).getTime();
  const from = encodeURIComponent(new Date(t - 3*60000).toISOString());
  const to = encodeURIComponent(new Date(t + 3*60000).toISOString());
  const res = await fetch(`${state.supaUrl}/rest/v1/ledger_entries?select=id,amount_in&source=eq.sale&voided=is.false&created_at=gte.${from}&created_at=lte.${to}`, { headers: supaHeaders() });
  if(!res.ok) return false;
  const hits = (await res.json()).filter(x => Math.abs(Number(x.amount_in) - Number(total)) < 0.01);
  if(hits.length !== 1) return false;
  rows = await patchRows(`ledger_entries?id=eq.${hits[0].id}`, voidStamp(reason));
  return rows.length > 0;
}
async function refreshAfterVoid(){
  await fetchProducts();
  await fetchSales();
  await fetchSaleItems();
  await fetchConsignments();
  if(state.ledgerReady) await fetchLedger();
}

function openVoidPrompt(kind, id, label){
  if(!isAdmin()){ showToast('Admin lang ang puwedeng mag-void.', true); return; }
  if(!state.voidCol){ showToast('I-run muna ang "Void" SQL sa Settings tab.', true); return; }
  state.voidPrompt = { kind, id, label: label || '', reason: '', busy: false, focus: true };
  render();
}
async function confirmVoid(){
  const vp = state.voidPrompt;
  if(!vp || vp.busy) return;
  const reason = (vp.reason || '').trim();
  if(!reason){ showToast('Isulat muna ang dahilan (remarks) ng void.', true); return; }
  vp.busy = true; render();
  let ok = false;
  try{
    if(vp.kind === 'sale') ok = await voidSale(vp.id, reason);
    else if(vp.kind === 'consign-sent') ok = await voidConsignSent(vp.id, reason);
    else if(vp.kind === 'consign-settle') ok = await voidConsignSettlement(vp.id, reason);
    else if(vp.kind === 'consign-event') ok = await voidConsignEvent(vp.id, reason);
    else if(vp.kind === 'ledger') ok = await voidLedgerEntry(vp.id, reason);
  }catch(e){
    showToast('Void failed: ' + e.message, true);
  }
  if(ok) state.voidPrompt = null; else if(state.voidPrompt) state.voidPrompt.busy = false;
  render();
}

async function voidSale(saleId, reason){
  if(!isAdmin()) throw new Error('Admin lang ang puwedeng mag-void.');
  let sale = state.sales.find(s => s.id === saleId);
  if(!sale){
    const r0 = await fetch(`${state.supaUrl}/rest/v1/sales?select=*&id=eq.${saleId}`, { headers: supaHeaders() });
    if(r0.ok){ const a0 = await r0.json(); sale = a0[0]; }
  }
  if(!sale) throw new Error('Hindi mahanap ang sale. I-refresh ang History.');
  if(sale.voided){
    // the sale itself is already voided; only (re)try its Ledger entry
    const okL = await voidLedgerForSale(saleId, sale.total, sale.created_at, reason);
    if(!okL) throw new Error('Na-void na ang sale, pero hindi ma-void ang Ledger entry (baka naka-block ng permission). I-run ang "Ledger fix" SQL.');
    await refreshAfterVoid();
    showToast('Ledger entry na-void.');
    return true;
  }

  // a sale made by paying for MISSING consignment pieces is voided together with that record
  const evOwner = state.consignments.flatMap(c => (c.consignment_events || []).map(e => ({ c, e }))).find(x => x.e.sale_id === saleId && !x.e.voided);
  if(evOwner) return await voidConsignEvent(evOwner.e.id, reason);
  // a sale made by settling a consignment is voided together with that settlement
  const linked = state.consignments.find(c => c.settle_sale_id === saleId && !c.voided && c.status === 'closed')
    || state.consignments.find(c => saleMatchesConsign(sale, c));
  if(linked) return await voidConsignSettlement(linked.id, reason);

  // an older consignment sale with no saved link: void the sale + ledger but do NOT touch stock
  // (consignment pieces were taken out of stock when sent, not when settled)
  let isConsignSale = false;
  if(state.ledgerReady){
    const r = await fetch(`${state.supaUrl}/rest/v1/ledger_entries?select=details&sale_id=eq.${saleId}`, { headers: supaHeaders() });
    if(r.ok) isConsignSale = (await r.json()).some(x => /^Sale: Consignment/i.test(x.details || ''));
  }

  await patchRows(`sales?id=eq.${saleId}`, voidStamp(reason), true);
  const ledgerOk = await voidLedgerForSale(saleId, sale.total, sale.created_at, reason);

  if(!isConsignSale){
    const r = await fetch(`${state.supaUrl}/rest/v1/sale_items?select=product_id,product_name,qty&sale_id=eq.${saleId}`, { headers: supaHeaders() });
    if(!r.ok) throw new Error('Na-void ang sale pero hindi ma-load ang items para ibalik ang stock. Ibalik ang stock manual.');
    const map = {};
    (await r.json()).forEach(i => {
      let pid = i.product_id;
      if(!pid){ const p = state.products.find(x => x.name === i.product_name); pid = p ? p.id : null; }
      if(pid) map[pid] = (map[pid] || 0) + (Number(i.qty) || 0);
    });
    await adjustStockMap(map, +1, q => 'Sale voided (+' + q + ')', 'void-sale');
  }
  await refreshAfterVoid();
  if(!ledgerOk){ showToast('Na-void ang sale at naibalik ang stock, PERO hindi na-void ang Ledger entry. Pindutin ang "Void sale" sa Ledger row para subukan ulit.', true); return true; }
  showToast(isConsignSale
    ? 'Sale at Ledger na-void. Hindi ginalaw ang stock (consignment sale ito); i-void ang settlement sa Consign tab kung kailangang i-reopen.'
    : 'Sale na-void. Naibalik ang stock.');
  return true;
}

async function voidConsignSent(consignId, reason){
  if(!isAdmin()) throw new Error('Admin lang ang puwedeng mag-void.');
  const c = state.consignments.find(x => x.id === consignId);
  if(!c) throw new Error('Hindi mahanap ang consignment. I-refresh ang Consign tab.');
  if(c.voided) throw new Error('Na-void na ang consignment na ito.');
  if(c.status === 'closed') throw new Error('Settled na ito \u2014 gamitin ang "Void settlement".');
  await patchRows(`consignments?id=eq.${consignId}`, voidStamp(reason), true);
  const map = {};
  (c.consignment_items || []).forEach(i => { if(i.product_id) map[i.product_id] = (map[i.product_id] || 0) + (Number(i.qty_sent) || 0); });
  await adjustStockMap(map, +1, q => 'Consignment - voided (+' + q + ')', 'void-consign');
  await refreshAfterVoid();
  showToast('Consignment na-void. Naibalik sa stock ang lahat ng naipadala.');
  return true;
}

async function voidConsignSettlement(consignId, reason){
  if(!isAdmin()) throw new Error('Admin lang ang puwedeng mag-void.');
  const c = state.consignments.find(x => x.id === consignId);
  if(!c) throw new Error('Hindi mahanap ang consignment. I-refresh ang Consign tab.');
  if(c.voided || c.status !== 'closed') throw new Error('Hindi pa settled ang consignment na ito.');
  const items = c.consignment_items || [];
  const settleVal = consignSettleValue(c);

  // 0) also void the late bayad/nakita records of the missing pieces (their qty/stock are reset below)
  for(const ev of (c.consignment_events || [])){
    if(ev.voided) continue;
    if(ev.kind === 'paid' && ev.sale_id){
      await patchRows(`sales?id=eq.${ev.sale_id}`, voidStamp(reason), true);
      await voidLedgerForSale(ev.sale_id, ev.total, ev.created_at, reason);
    }
    await patchRows(`consignment_events?id=eq.${ev.id}`, voidStamp(reason), true);
  }

  // 1) void the sale + ledger entry that the settlement created
  let sale = null, ledgerOk2 = true;
  if(settleVal > 0){
    sale = await findSettleSale(c, settleVal);
    if(sale){
      await patchRows(`sales?id=eq.${sale.id}`, voidStamp(reason), true);
      ledgerOk2 = await voidLedgerForSale(sale.id, settleVal, sale.created_at, reason);
    }
  }
  // 2) take back the pieces that were returned to stock at settlement
  const map = {};
  items.forEach(i => { if(i.product_id && i.qty_returned) map[i.product_id] = (map[i.product_id] || 0) + (Number(i.qty_returned) || 0); });
  await adjustStockMap(map, -1, q => 'Consignment return voided (-' + q + ')', 'void-consign');
  // 3) clear the tally and reopen the consignment so it can be settled again, correctly
  for(const i of items){
    await patchRows(`consignment_items?id=eq.${i.id}`, { qty_sold: 0, qty_returned: 0 });
  }
  const stampNote = (c.note ? c.note + ' \u00B7 ' : '') + 'Settlement voided ' + new Date().toLocaleDateString() + ': ' + reason;
  await patchRows(`consignments?id=eq.${consignId}`, { status: 'open', settled_at: null, settle_sale_id: null, note: stampNote }, true);
  items.forEach(i => { delete state.settle[i.id]; });

  await refreshAfterVoid();
  if(!ledgerOk2){ showToast('Na-reopen ang consignment, PERO hindi na-void ang Ledger entry. Pindutin ang "Void sale" sa Ledger row nito para subukan ulit.', true); return true; }
  showToast(settleVal > 0 && !sale
    ? 'Na-reopen ang consignment, pero hindi ko mahanap ang sale/Ledger nito. I-void iyon manual sa History.'
    : 'Settlement na-void. Naka-"Out" ulit ang consignment \u2014 i-settle ulit nang tama.');
  return true;
}

async function voidConsignEvent(eventId, reason){
  if(!isAdmin()) throw new Error('Admin lang ang puwedeng mag-void.');
  let ev = null, c = null;
  for(const x of state.consignments){
    ev = (x.consignment_events || []).find(e => e.id === eventId);
    if(ev){ c = x; break; }
  }
  if(!ev || !c) throw new Error('Hindi mahanap ang record. I-refresh ang Consign tab.');
  if(ev.voided) throw new Error('Na-void na ang record na ito.');
  if(c.voided) throw new Error('Na-void na ang consignment na ito.');
  const lines = Array.isArray(ev.items) ? ev.items : [];
  if(ev.kind === 'paid'){
    if(ev.sale_id){
      await patchRows(`sales?id=eq.${ev.sale_id}`, voidStamp(reason), true);
      const okL = await voidLedgerForSale(ev.sale_id, ev.total, ev.created_at, reason);
      if(!okL) showToast('Na-void ang sale, pero hindi na-void ang Ledger entry. Pindutin ang "Void sale" sa Ledger row nito.', true);
    }
    for(const l of lines){
      const it = (c.consignment_items || []).find(x => x.id === l.item_id);
      if(it) await patchRows(`consignment_items?id=eq.${it.id}`, { qty_sold: Math.max(0, (Number(it.qty_sold)||0) - (Number(l.qty)||0)) });
    }
  }else{
    const map = {};
    for(const l of lines){
      if(l.product_id) map[l.product_id] = (map[l.product_id] || 0) + (Number(l.qty) || 0);
      const it = (c.consignment_items || []).find(x => x.id === l.item_id);
      if(it) await patchRows(`consignment_items?id=eq.${it.id}`, { qty_returned: Math.max(0, (Number(it.qty_returned)||0) - (Number(l.qty)||0)) });
    }
    await adjustStockMap(map, -1, q => 'Consignment found/return voided (-' + q + ')', 'void-consign');
  }
  await patchRows(`consignment_events?id=eq.${eventId}`, voidStamp(reason), true);
  await refreshAfterVoid();
  showToast('Na-void ang record. Bumalik sa Missing ang mga piraso nito.');
  return true;
}

async function voidLedgerEntry(id, reason){
  if(!isAdmin()) throw new Error('Admin lang ang puwedeng mag-void.');
  const e = state.ledgerEntries.find(x => x.id === id);
  if(!e) throw new Error('Hindi mahanap ang entry. I-refresh ang Ledger.');
  if(e.voided) throw new Error('Na-void na ang entry na ito.');
  if(e.source === 'sale') throw new Error('Ito ay galing sa Sale \u2014 i-void ang sale sa History o Consign.');
  await patchRows(`ledger_entries?id=eq.${id}`, voidStamp(reason), true);
  state.expenseEntries = state.expenseEntries.filter(x => x.id !== id);
  await fetchLedger();
  showToast('Ledger entry na-void.');
  return true;
}

function voidModalMarkup(){
  const vp = state.voidPrompt;
  if(!vp) return '';
  const titles = { 'sale':'Void sale', 'consign-sent':'Void consignment', 'consign-settle':'Void settlement', 'consign-event':'Void bayad / nakita', 'ledger':'Void ledger entry' };
  const notes = {
    'sale': 'Ibabalik sa stock ang mga item nito, at hindi na isasama sa Daily, Monthly report at Ledger. Mananatili ito sa History bilang VOIDED.',
    'consign-sent': 'Ibabalik sa stock ang lahat ng naipadala. Mamarkahang VOIDED ang consignment at hindi na ito puwedeng i-settle.',
    'consign-settle': 'Ibabalik ang consignment sa "Out" para ma-settle ulit nang tama. Ive-void ang sale at Ledger entry nito, at babawiin sa stock ang mga ibinalik.',
    'consign-event': 'Ive-void ang bayad (sale at Ledger entry) o ang pagbalik sa stock ng nakitang piraso, at babalik sa "Missing" ang mga ito.',
    'ledger': 'Hindi na isasama sa Ledger balance at Expense report. Mananatili sa listahan bilang VOIDED.'
  };
  const chips = ['Maling encode', 'Dapat Member pala', 'Maling presyo/discount', 'Test lang'].map(t => `<button type="button" class="chip" data-void-chip="${t}">${t}</button>`).join('');
  return `
  <div class="free-scrim" id="void-scrim"></div>
  <div class="free-modal" role="dialog" aria-modal="true" aria-label="Void">
    <h2>\u26D4 ${titles[vp.kind] || 'Void'}</h2>
    <div class="setup-note" style="margin-bottom:12px;"><b>${escapeHtml(vp.label)}</b><br>${notes[vp.kind] || ''}</div>
    <div class="field"><label>Dahilan / Remarks (kailangan)</label><input id="void-reason" placeholder="hal. Maling encode, dapat Member pala" value="${escapeHtml(vp.reason)}" autocomplete="off"></div>
    <div class="chips">${chips}</div>
    <div style="display:flex; gap:8px; margin-top:14px;">
      <button class="primary" id="void-confirm" style="flex:1; margin-top:0;" ${vp.busy ? 'disabled' : ''}>${vp.busy ? 'Voiding...' : 'Confirm void'}</button>
      <button class="ghost" id="void-cancel" style="flex:1;" ${vp.busy ? 'disabled' : ''}>Cancel</button>
    </div>
  </div>`;
}
