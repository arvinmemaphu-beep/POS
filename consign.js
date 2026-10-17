/* ---------- Consignment ---------- */

async function fetchConsignments(){
  if(!state.connected) return;
  state.loading = true; render();
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/consignments?select=*,consignment_items(*)${state.missingReady ? ',consignment_events(*)' : ''}&order=created_at.desc&limit=50`, { headers: supaHeaders() });
    if(!res.ok) throw new Error('Failed to load consignments');
    state.consignments = await res.json();
  }catch(e){
    showToast('Could not load consignments: ' + e.message, true);
  }
  state.loading = false; render();
}

function addConsignDraft(){
  if(blockViewer()) return;
  const p = state.products.find(x=>x.id===state.consignPick);
  const qty = Math.floor(Number(state.consignPickQty));
  if(!p){ showToast('Pick a product first.', true); return; }
  if(!qty || qty <= 0){ showToast('Enter how many pieces to send.', true); return; }
  const already = state.consignDraft.filter(d=>d.product_id===p.id).reduce((s,d)=>s+d.qty,0);
  if(qty + already > (p.stock||0)){ showToast('Only ' + (p.stock||0) + ' in stock for ' + p.name + '.', true); return; }
  const existing = state.consignDraft.find(d=>d.product_id===p.id);
  if(existing){ existing.qty += qty; }
  else{ state.consignDraft.push({ product_id: p.id, name: p.name, price: p.price, qty }); }
  state.consignPickQty = '';
  render();
}

function consignDraftTotal(){
  return state.consignDraft.reduce((s,d)=> s + d.price*d.qty, 0);
}

async function sendConsignment(){
  if(blockViewer()) return;
  if(state.busy) return;
  const consignee = state.consignee.trim();
  if(!consignee){ showToast('Enter who receives the items.', true); return; }
  if(state.consignDraft.length === 0){ showToast('Add at least one item.', true); return; }
  state.busy = true; render();
  try{
    const consignRow = { consignee, note: state.consignNote.trim() || null, status: 'open' };
    if(state.consignMemberCol && state.consignMemberId) consignRow.member_id = state.consignMemberId;
    const cRes = await fetch(`${state.supaUrl}/rest/v1/consignments`, {
      method:'POST', headers: supaHeaders(),
      body: JSON.stringify([consignRow])
    });
    if(!cRes.ok) throw new Error('Could not create consignment');
    const consignmentId = (await cRes.json())[0].id;

    const itemRows = state.consignDraft.map(d => ({
      consignment_id: consignmentId,
      product_id: d.product_id,
      product_name: d.name,
      price: d.price,
      qty_sent: d.qty,
      qty_sold: 0,
      qty_returned: 0
    }));
    const iRes = await fetch(`${state.supaUrl}/rest/v1/consignment_items`, {
      method:'POST', headers: supaHeaders(), body: JSON.stringify(itemRows)
    });
    if(!iRes.ok) throw new Error('Could not save consignment items');

    // items leave the shop, so take them out of stock
    for(const d of state.consignDraft){
      const prod = state.products.find(p=>p.id===d.product_id);
      if(prod) await setStock(d.product_id, (prod.stock||0) - d.qty, 'consignment sent to ' + consignee + ' (-' + d.qty + ')', 'consign-sent');
    }

    state.consignDraft = [];
    state.consignee = '';
    state.consignNote = '';
    state.consignMemberId = '';
    await fetchProducts();
    await fetchConsignments();
    showToast('Consignment sent to ' + consignee + '.');
  }catch(e){
    showToast('Could not send consignment: ' + e.message, true);
  }
  state.busy = false; render();
}

async function settleConsignment(consignment){
  if(blockViewer()) return;
  if(state.busy) return;
  const items = consignment.consignment_items || [];
  const rows = [];
  for(const it of items){
    const s = state.settle[it.id] || {};
    const soldRaw = String(s.sold === undefined || s.sold === null ? '' : s.sold).trim();
    const retRaw = String(s.returned === undefined || s.returned === null ? '' : s.returned).trim();
    if(soldRaw === '' || retRaw === ''){
      showToast('Enter sold and returned quantities for ' + it.product_name + '.', true);
      return;
    }
    const sold = Math.floor(Number(soldRaw));
    const ret = Math.floor(Number(retRaw));
    if(isNaN(sold) || isNaN(ret)){
      showToast('Invalid quantity for ' + it.product_name + '.', true);
      return;
    }
    if(sold < 0 || ret < 0){ showToast('Quantities cannot be negative.', true); return; }
    if(sold + ret > it.qty_sent){
      showToast(it.product_name + ': sold + returned cannot be more than ' + it.qty_sent + ' sent.', true);
      return;
    }
    rows.push({ it, sold, ret });
  }
  const soldTotal = rows.reduce((s,r)=> s + consignUnitPrice(r.it, consignment)*r.sold, 0);
  state.busy = true; render();
  let settleSaleId = null;
  try{
    // record the sold pieces as a real sale so revenue reports stay correct
    if(soldTotal > 0){
      const saleRes = await fetch(`${state.supaUrl}/rest/v1/sales`, {
        method:'POST', headers: supaHeaders(), body: JSON.stringify([{ total: soldTotal }])
      });
      if(!saleRes.ok) throw new Error('Could not record the sale');
      const saleId = (await saleRes.json())[0].id;
      settleSaleId = saleId;
      const saleItems = rows.filter(r=>r.sold>0).map(r=>({
        sale_id: saleId, product_id: r.it.product_id, product_name: r.it.product_name,
        price: consignUnitPrice(r.it, consignment), qty: r.sold
      }));
      const siRes = await fetch(`${state.supaUrl}/rest/v1/sale_items`, {
        method:'POST', headers: supaHeaders(), body: JSON.stringify(saleItems)
      });
      if(!siRes.ok) throw new Error('Could not record sale items');
      // post the consignment sale to the cash ledger too, like regular checkout does
      const itemsSummary = rows.filter(r=>r.sold>0).map(r=> r.sold + 'x ' + r.it.product_name).join(', ');
      await postSaleToLedger(saleId, soldTotal, 'Consignment – ' + (consignment.consignee || 'consignee') + ': ' + itemsSummary);
      if(state.tab === 'ledger') await fetchLedger();
    }

    for(const r of rows){
      const pRes = await fetch(`${state.supaUrl}/rest/v1/consignment_items?id=eq.${r.it.id}`, {
        method:'PATCH', headers: supaHeaders(),
        body: JSON.stringify({ qty_sold: r.sold, qty_returned: r.ret })
      });
      if(!pRes.ok) throw new Error('Could not update the tally');
      // returned pieces go back to shop stock
      if(r.ret > 0){
        const prod = state.products.find(p=>p.id===r.it.product_id);
        if(prod) await setStock(r.it.product_id, (prod.stock||0) + r.ret, 'consignment return from ' + (consignment.consignee || 'consignee') + ' (+' + r.ret + ')', 'consign-return');
      }
    }

    const cRes = await fetch(`${state.supaUrl}/rest/v1/consignments?id=eq.${consignment.id}`, {
      method:'PATCH', headers: supaHeaders(),
      body: JSON.stringify(Object.assign({ status: 'closed', settled_at: new Date().toISOString() }, state.voidCol ? { settle_sale_id: settleSaleId } : {}))
    });
    if(!cRes.ok) throw new Error('Could not close the consignment');

    state.settle = {};
    await fetchProducts();
    await fetchConsignments();
    showToast('Consignment settled \u2014 sold ' + money(soldTotal) + '.');
  }catch(e){
    showToast('Could not settle: ' + e.message, true);
  }
  state.busy = false; render();
}

// A settled consignment that still has pieces not accounted for stays "Missing". Later the consignee can PAY for
// them (a new sale + Ledger entry) and/or they can be FOUND (returned to stock). Closed only when none are missing.
async function settleMissing(consignment){
  if(blockViewer()) return;
  if(state.busy) return;
  if(!state.missingReady){ showToast('I-run muna ang "Missing items" SQL sa Settings tab.', true); return; }
  const lines = [];
  for(const it of (consignment.consignment_items || [])){
    const left = consignLeftQty(it);
    if(left <= 0) continue;
    const s2 = state.missInput[it.id] || {};
    const pay = Math.floor(Number(s2.pay) || 0);
    const found = Math.floor(Number(s2.found) || 0);
    if(pay < 0 || found < 0){ showToast('Hindi puwedeng negatibo ang quantity.', true); return; }
    if(pay + found > left){ showToast(it.product_name + ': Bayad + Nakita ay hindi puwedeng lampas sa ' + left + ' na kulang.', true); return; }
    if(pay + found > 0) lines.push({ it, pay, found });
  }
  if(!lines.length){ showToast('Maglagay ng Bayad o Nakita na quantity.', true); return; }
  const payLines = lines.filter(l => l.pay > 0);
  const foundLines = lines.filter(l => l.found > 0);
  const payTotal = payLines.reduce((sum,l)=> sum + consignUnitPrice(l.it, consignment) * l.pay, 0);
  state.busy = true; render();
  try{
    let saleId = null;
    if(payTotal > 0){
      const saleRes = await fetch(`${state.supaUrl}/rest/v1/sales`, { method:'POST', headers: supaHeaders(), body: JSON.stringify([{ total: payTotal }]) });
      if(!saleRes.ok) throw new Error('Could not record the sale');
      saleId = (await saleRes.json())[0].id;
      const siRes = await fetch(`${state.supaUrl}/rest/v1/sale_items`, {
        method:'POST', headers: supaHeaders(),
        body: JSON.stringify(payLines.map(l => ({ sale_id: saleId, product_id: l.it.product_id, product_name: l.it.product_name, price: consignUnitPrice(l.it, consignment), qty: l.pay })))
      });
      if(!siRes.ok) throw new Error('Could not record sale items');
      const summary = payLines.map(l => l.pay + 'x ' + l.it.product_name).join(', ');
      await postSaleToLedger(saleId, payTotal, 'Consignment bayad (kulang) \u2013 ' + (consignment.consignee || 'consignee') + ': ' + summary);
      if(state.tab === 'ledger') await fetchLedger();
    }
    // keep a record of this transaction so it can be voided later
    const who = (state.user && state.user.email) ? state.user.email : null;
    const evRows = [];
    if(payLines.length) evRows.push({ consignment_id: consignment.id, kind: 'paid', sale_id: saleId, total: payTotal, created_by: who,
      items: payLines.map(l => ({ item_id: l.it.id, product_id: l.it.product_id, name: l.it.product_name, qty: l.pay, price: consignUnitPrice(l.it, consignment) })) });
    if(foundLines.length) evRows.push({ consignment_id: consignment.id, kind: 'found', sale_id: null, total: 0, created_by: who,
      items: foundLines.map(l => ({ item_id: l.it.id, product_id: l.it.product_id, name: l.it.product_name, qty: l.found, price: l.it.price })) });
    const evRes = await fetch(`${state.supaUrl}/rest/v1/consignment_events`, { method:'POST', headers: supaHeaders(), body: JSON.stringify(evRows) });
    if(!evRes.ok) throw new Error('Could not save the record (run the Missing items SQL?)');

    for(const l of lines){
      const pRes = await fetch(`${state.supaUrl}/rest/v1/consignment_items?id=eq.${l.it.id}`, {
        method:'PATCH', headers: supaHeaders(),
        body: JSON.stringify({ qty_sold: (Number(l.it.qty_sold)||0) + l.pay, qty_returned: (Number(l.it.qty_returned)||0) + l.found })
      });
      if(!pRes.ok) throw new Error('Could not update the tally');
      if(l.found > 0){
        const prod = state.products.find(p => p.id === l.it.product_id);
        if(prod) await setStock(l.it.product_id, (prod.stock||0) + l.found, 'consignment found/return from ' + (consignment.consignee || 'consignee') + ' (+' + l.found + ')', 'consign-return');
      }
    }
    lines.forEach(l => { delete state.missInput[l.it.id]; });
    await fetchProducts();
    await fetchConsignments();
    const fresh = state.consignments.find(x => x.id === consignment.id);
    const stillMissing = fresh ? consignMissingQty(fresh) : 0;
    showToast((payTotal > 0 ? 'Bayad ' + money(payTotal) + ' na-record. ' : '') + (stillMissing > 0 ? stillMissing + ' pa ang kulang (Missing).' : 'Kumpleto na \u2014 Settled na ang consignment.'));
  }catch(e){
    showToast('Could not record: ' + e.message, true);
  }
  state.busy = false; render();
}

function missingPanelHtml(c, missing, voided){
  if(voided) return '';
  let h = '';
  if(missing){
    h += state.missingReady
      ? `<div class="setup-note">Hindi pa closed ito \u2014 may kulang pa. Ilagay ang <b>Bayad</b> (binayaran ng kumuha) at/o <b>Nakita</b> (naibalik na sa shop), tapos pindutin ang button. Puwedeng paunti-unti.</div>
         <button class="primary" data-miss-go="${c.id}" ${state.busy?'disabled':''}>${state.busy ? 'Saving...' : 'Record bayad / nakita'}</button>`
      : `<div class="setup-note">May kulang pa. I-run ang <b>Missing items</b> SQL sa Settings para ma-record ang bayad/nakita.</div>`;
  }
  const evs = (c.consignment_events || []).slice().sort((a,b)=> new Date(a.created_at) - new Date(b.created_at));
  if(evs.length){
    h += '<div class="items" style="margin-top:8px;">' + evs.map(ev => {
      const what = (Array.isArray(ev.items) ? ev.items : []).map(x => x.qty + 'x ' + escapeHtml(x.name || '')).join(', ');
      const label = (ev.kind === 'paid' ? 'Binayaran ' + money(ev.total) : 'Nakita / naibalik') + ': ' + what;
      const voidBtn = (isAdmin() && state.voidCol && !ev.voided) ? ` <button class="ghost void-btn" data-void-event="${ev.id}">Void</button>` : '';
      return `<div class="sub" style="margin-top:4px;">${new Date(ev.created_at).toLocaleString()} \u00B7 ${label}${ev.voided ? ' <span class="tag void">VOIDED</span>' : ''}${voidBtn}</div>`;
    }).join('') + '</div>';
  }
  return h;
}

function renderConsign(){
  const opts = ['<option value="">Pick a product\u2026</option>'].concat(
    state.products.map(p=>`<option value="${p.id}" ${state.consignPick===p.id?'selected':''}>${p.name} \u2014 ${p.stock} in stock</option>`)
  ).join('');

  const draftRows = state.consignDraft.map(d => `
    <div class="cons-item">
      <div class="nm">${d.name}<div class="sub">${d.qty} pcs \u00D7 ${money(d.price)}</div></div>
      <div class="mono">${money(d.price*d.qty)}</div>
      <button class="icon-btn" data-draft-del="${d.product_id}" title="Remove">\u2715</button>
    </div>`).join('') || `<div class="empty">No items added yet.</div>`;

  const history = state.consignments.map(c => {
    const items = c.consignment_items || [];
    const dt = new Date(c.created_at);
    const voided = !!c.voided;
    const open = !voided && c.status !== 'closed';
    const missQty = consignMissingQty(c);
    const missing = missQty > 0;
    // search filter: consignee, product names, member name, note
    if(state.consignSearch.trim()){
      const cq = state.consignSearch.trim().toLowerCase();
      const linkedForSearch = c.member_id ? state.members.find(m=>m.id===c.member_id) : null;
      const hay = `${c.consignee||''} ${c.note||''} ${linkedForSearch ? linkedForSearch.full_name : ''} ${items.map(i=>i.product_name||'').join(' ')}`.toLowerCase();
      if(!hay.includes(cq)) return '';
    }
    const sent = items.reduce((s,i)=> s + (i.qty_sent||0), 0);
    const sold = items.reduce((s,i)=> s + (i.qty_sold||0), 0);
    const ret = items.reduce((s,i)=> s + (i.qty_returned||0), 0);
    const soldValue = items.reduce((s,i)=> s + consignUnitPrice(i, c)*(i.qty_sold||0), 0);
    const linkedMember = c.member_id ? state.members.find(m=>m.id===c.member_id) : null;

    const itemRows = items.map(i => {
      const disc = linkedMember ? productDiscount(i.product_id) : 0;
      const priceLabel = disc > 0
        ? '<span class="strike">' + money(i.price) + '</span> ' + money(consignUnitPrice(i, c))
        : money(i.price);
      const editingThis = isAdmin() && state.editingConsignItem && state.editingConsignItem.id === i.id;
      if(editingThis){
        return `
        <div class="cons-item">
          <div class="field" style="flex:1; margin:0;"><label>Product name</label><input id="eci-name" value="${escapeHtml(state.editingConsignItem.product_name)}"></div>
          <div style="display:flex; gap:8px;">
            <button class="primary" id="btn-save-consign-item">Save</button>
            <button class="ghost" id="btn-cancel-consign-item">Cancel</button>
          </div>
        </div>`;
      }
      const nameLabel = i.product_name + (isAdmin() ? ` <button class="icon-btn" data-edit-consign-item="${i.id}" title="Correct product name">\u270E</button>` : '');
      if(open){
        const st = state.settle[i.id] || {};
        const remaining = (i.qty_sent||0) - (Number(st.sold)||0) - (Number(st.returned)||0);
        return `
        <div class="cons-item">
          <div class="nm">${nameLabel}
            <div class="sub">${i.qty_sent} sent @ ${priceLabel} \u00B7 <span data-remain="${i.id}">${remaining}</span> not yet accounted</div>
          </div>
          <div>
            <label>Sold</label>
            <input class="num-sm" type="number" min="0" step="1" data-sold="${i.id}" value="${st.sold === undefined ? '' : st.sold}">
          </div>
          <div>
            <label>Returned</label>
            <input class="num-sm" type="number" min="0" step="1" data-ret="${i.id}" value="${st.returned === undefined ? '' : st.returned}">
          </div>
        </div>`;
      }
      const left = voided ? 0 : (i.qty_sent||0) - (i.qty_sold||0) - (i.qty_returned||0);
      if(missing && left > 0 && state.missingReady){
        const mi = state.missInput[i.id] || {};
        return `
        <div class="cons-item">
          <div class="nm">${nameLabel}
            <div class="sub">${i.qty_sent} sent \u00B7 ${i.qty_sold||0} sold \u00B7 ${i.qty_returned||0} returned \u00B7 <b style="color:var(--red);">${left} missing</b> @ ${priceLabel}</div>
          </div>
          <div>
            <label>Bayad</label>
            <input class="num-sm" type="number" min="0" max="${left}" step="1" data-mpay="${i.id}" value="${mi.pay === undefined ? '' : mi.pay}">
          </div>
          <div>
            <label>Nakita</label>
            <input class="num-sm" type="number" min="0" max="${left}" step="1" data-mfound="${i.id}" value="${mi.found === undefined ? '' : mi.found}">
          </div>
        </div>`;
      }
      return `
        <div class="cons-item">
          <div class="nm">${nameLabel}
            <div class="sub">${i.qty_sent} sent \u00B7 ${i.qty_sold||0} sold \u00B7 ${i.qty_returned||0} returned${left>0 ? ' \u00B7 ' + left + ' missing' : ''}</div>
          </div>
          <div class="mono">${money(consignUnitPrice(i, c)*(i.qty_sold||0))}</div>
        </div>`;
    }).join('');

    return `
    <div class="sale-row">
      <div class="head">
        <span>${c.consignee}${linkedMember ? ' \u00B7 <span class="tag" style="border-color:var(--gold-dim); color:var(--gold);">Member: ' + escapeHtml(linkedMember.full_name) + '</span>' : ''} ${voided ? '<span class="tag void">VOIDED</span>' : `<span class="tag ${open?'open':(missing?'miss':'closed')}">${open?'Out':(missing?'Missing':'Settled')}</span>`}</span>
        <span class="amt mono">${money(soldValue)}</span>
      </div>
      <div class="items">${dt.toLocaleString()} \u00B7 ${sent} pcs sent${(open || voided) ? '' : ' \u00B7 ' + sold + ' sold \u00B7 ' + ret + ' returned' + (missing ? ' \u00B7 ' + missQty + ' missing' : '')}${c.note ? ' \u00B7 ' + c.note : ''}</div>
      ${itemRows}
      ${missingPanelHtml(c, missing, voided)}
      ${open ? `<button class="primary" data-settle="${c.id}" ${state.busy?'disabled':''}>${state.busy ? 'Saving...' : 'Record sold / returned'}</button>` : ''}
      ${voided ? voidNoteHtml(c) : ((isAdmin() && state.voidCol) ? (open
        ? `<button class="ghost void-btn" data-void-consign="${c.id}" data-void-mode="sent">Void consignment</button>`
        : `<button class="ghost void-btn" data-void-consign="${c.id}" data-void-mode="settle">Void settlement (ibalik sa Out)</button>`) : '')}
    </div>`;
  }).join('') || (state.consignSearch.trim() ? `<div class="empty">No consignments match your search.</div>` : `<div class="empty">No consignments yet.</div>`);

  return `
  <div class="grid">
    <div class="panel">
      <h2>Send items out</h2>
      <div class="field">
        <label>Who receives it (person or branch)</label>
        <input id="cs-consignee" placeholder="e.g. Ate Mhel / Branch 2" value="${state.consignee}">
      </div>
      ${state.consignMemberCol ? `
      <div class="field">
        <label>Member (discount applies when this is settled)</label>
        <select id="cs-member">
          <option value="">None \u2014 no discount</option>
          ${state.members.map(m => `<option value="${m.id}" ${state.consignMemberId===m.id?'selected':''}>${escapeHtml(m.full_name)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="field">
        <label>Note (optional)</label>
        <input id="cs-note" placeholder="e.g. bazaar sa Sabado" value="${state.consignNote}">
      </div>
      <div class="field">
        <label>Product</label>
        <select id="cs-product">${opts}</select>
        ${(() => {
          const picked = state.products.find(x => x.id === state.consignPick);
          if(!picked) return '';
          return `<div id="cs-stock-callout" class="stock-callout${picked.stock<=5?' stock-low':''}">${picked.stock} in stock</div>`;
        })()}
      </div>
      <div class="row2">
        <div class="field">
          <label>Quantity</label>
          <input id="cs-qty" type="number" min="1" step="1" placeholder="0" value="${state.consignPickQty}">
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="ghost" id="btn-cs-add" style="width:100%; padding:9px;">Add item</button>
        </div>
      </div>
      <div style="border-top:1px solid var(--line); margin:6px 0 10px;"></div>
      <div>${draftRows}</div>
      <div class="cart-total">
        <span>Value sent out</span>
        <span class="amt mono">${money(consignDraftTotal())}</span>
      </div>
      <button class="primary" id="btn-cs-send" ${state.busy || state.consignDraft.length===0 ? 'disabled' : ''}>${state.busy ? 'Saving...' : 'Send consignment'}</button>
      <div class="setup-note">Sent pieces are taken out of shop stock. Pag-return, ilagay lang kung ilan ang nabenta at ilan ang nagbalik \u2014 ang nabenta ay masasama sa sales, at ang nagbalik ay babalik sa stock.</div>
    </div>
    <div class="panel">
      <h2>Consignment history</h2>
      <div class="field"><input id="in-consign-search" placeholder="Search consignee, product, member..." value="${escapeHtml(state.consignSearch)}"></div>
      <div>${history}</div>
    </div>
  </div>`;
}
