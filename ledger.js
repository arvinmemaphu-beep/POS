/* ---------- Ledger (Balance Sheet) ---------- */

async function fetchLedger(){
  if(!state.connected || !state.ledgerReady) return;
  state.loading = true; render();
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/ledger_entries?select=*&order=created_at.asc&limit=1000`, { headers: supaHeaders() });
    if(!res.ok) throw new Error('Failed to load ledger');
    state.ledgerEntries = await res.json();
  }catch(e){
    showToast('Could not load ledger: ' + e.message, true);
  }
  state.loading = false; render();
}

// Returns ledger entries in display order (oldest first) each tagged with its
// running balance, computed client-side: previous balance + in - out.
function ledgerWithBalances(){
  let bal = 0;
  return state.ledgerEntries.map(e => {
    if(!e.voided) bal += (Number(e.amount_in)||0) - (Number(e.amount_out)||0); // voided entries do not count
    return Object.assign({}, e, { balance: bal });
  });
}

async function addLedgerEntry(){
  if(blockViewer()) return;
  const d = state.ledgerDraft;
  const details = (d.details||'').trim();
  if(!details){ showToast('Enter the item/details.', true); return; }
  // optional link to a Supply (packaging, sticker, ingredient): a purchase adds to that supply's stock
  const supplyId = (state.suppliesReady && d.supply_id) ? d.supply_id : '';
  const supplyQty = supplyId ? Number(d.supply_qty) : 0;
  if(supplyId){
    if(!(supplyQty > 0)){ showToast('Ilagay kung ilan ang idadagdag sa stock ng supply.', true); return; }
    if(!(Number(d.out) > 0)){ showToast('Ilagay ang halaga ng binili sa Out.', true); return; }
    if(Number(d.in) > 0){ showToast('Out lang ang puwede kapag may piniling supply.', true); return; }
  }
  const row = {
    entry_date: d.date || null,
    qty: (d.qty||'').trim() || null,
    details,
    pic: (d.pic||'').trim() || null,
    amount_in: Number(d.in) || 0,
    amount_out: Number(d.out) || 0,
    source: 'manual'
  };
  if(state.ledgerDepositCol) row.is_deposit = !!d.deposit;
  if(supplyId){ row.supply_id = supplyId; row.supply_qty = supplyQty; }
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/ledger_entries`, {
      method:'POST', headers: supaHeaders(),
      body: JSON.stringify([row])
    });
    if(!res.ok) throw new Error('Could not save entry');
    let saved = null;
    try{ saved = (await res.json())[0]; }catch(e){}
    state.ledgerDraft = { date: '', qty: '', details: '', pic: '', in: '', out: '', deposit: false, supply_id: '', supply_qty: '' };
    let stockOk = true;
    if(supplyId) stockOk = await supplyAfterLedgerBuy(saved, supplyId, supplyQty, Number(d.out));
    await fetchLedger();
    if(supplyId) await fetchSupplies();
    if(!supplyId) showToast('Ledger entry added.');
    else if(stockOk) showToast('Ledger entry added. Nadagdagan ang stock ng supply.');
  }catch(e){
    showToast('Could not add entry: ' + e.message, true);
  }
}

// Admin-only: retroactively mark/unmark a past Out entry as a cash deposit
// (a transfer, not an expense) so it drops out of the Expense Report.
async function toggleLedgerDeposit(id, makeDeposit){
  if(!isAdmin()) return;
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/ledger_entries?id=eq.${id}`, {
      method:'PATCH', headers: supaHeaders(),
      body: JSON.stringify({ is_deposit: makeDeposit })
    });
    if(!res.ok) throw new Error('Could not update entry');
    await fetchLedger();
    showToast(makeDeposit ? 'Marked as cash deposit.' : 'Unmarked as deposit.');
  }catch(e){
    showToast('Could not update entry: ' + e.message, true);
  }
}

// Posts one auto-generated "in" entry to the ledger for a completed sale.
// Silently skipped if the ledger table hasn't been set up yet (see Settings SQL).
async function postSaleToLedger(saleId, total, itemsSummary){
  if(!state.ledgerReady) return;
  try{
    await fetch(`${state.supaUrl}/rest/v1/ledger_entries`, {
      method:'POST', headers: supaHeaders(),
      body: JSON.stringify([{
        entry_date: localDateStr(),
        details: 'Sale: ' + itemsSummary,
        amount_in: total,
        amount_out: 0,
        source: 'sale',
        sale_id: saleId
      }])
    });
  }catch(e){
    // non-fatal — the sale itself already succeeded, just log a soft warning
    console.warn('Could not post sale to ledger:', e.message);
  }
}
