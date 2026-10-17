/* ---------- Edit product / Restock ---------- */

/* ---------- Product edit logs ---------- */

async function logProductAction(action, productId, productName, details){
  try{
    const send = (act) => fetch(`${state.supaUrl}/rest/v1/product_logs`, {
      method:'POST', headers: supaHeaders(),
      body: JSON.stringify({
        product_id: productId || null,
        product_name: productName,
        action: act,
        details,
        changed_by: state.user && state.user.email ? state.user.email : null
      })
    });
    const res = await send(action);
    // if the database only allows the older action names, fall back so the log is never lost
    if(!res.ok && /^(consign|void)-/.test(String(action))) await send('stock-set');
  }catch(e){ /* logging failure should never block a product operation */ }
}

async function fetchProductLogs(){
  if(!state.connected) return;
  state.productLogsLoading = true; render();
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/product_logs?select=*&order=created_at.desc&limit=100`, { headers: supaHeaders() });
    if(!res.ok) throw new Error('Fetch failed');
    state.productLogs = await res.json();
  }catch(e){
    state.productLogs = [];
    showToast('Could not load product logs. Did you run the product_logs SQL?', true);
  }
  state.productLogsLoading = false; render();
}

const PRODUCT_LOG_LABEL = { add:'Added', edit:'Edited', restock:'Restocked', 'stock-set':'Stock set', 'consign-sent':'Consignment - sent', 'consign-return':'Consignment return', delete:'Deleted' };

function renderProductLogs(){
  if(!state.showProductLogs){
    return `<div class="panel" style="margin-bottom:14px;"><button class="ghost" id="btn-show-plogs" style="width:100%; padding:11px;">\uD83D\uDCCB Show product history logs</button></div>`;
  }
  if(state.productLogsLoading){
    return `<div class="panel" style="margin-bottom:14px;"><div class="empty">Loading logs...</div></div>`;
  }
  const rows = state.productLogs.map(l => {
    const d = new Date(l.created_at);
    const lbl = PRODUCT_LOG_LABEL[l.action] || l.action;
    return `<div class="sale-row"><div class="head"><span><span class="tag">${escapeHtml(lbl)}</span> <strong>${escapeHtml(l.product_name)}</strong></span><span class="amt mono" style="font-size:12px;">${d.toLocaleString()}</span></div><div class="items">${escapeHtml(l.details)}${l.changed_by ? ' \u00B7 by ' + escapeHtml(l.changed_by) : ''}</div></div>`;
  }).join('') || `<div class="empty">No product changes logged yet.</div>`;
  return `<div class="panel" style="margin-bottom:14px;">
    <h2>\uD83D\uDCCB Product history logs <span style="font-weight:400; color:var(--ink-dim);">— last 100 changes</span></h2>
    ${rows}
    <button class="ghost" id="btn-hide-plogs" style="width:100%; margin-top:12px;">Hide logs</button>
  </div>`;
}

async function updateProduct(id, name, price, discount){
  if(blockViewer()) return;
  if(!name){ showToast('Enter a product name.', true); return; }
  const patch = { name, price: Number(price) };
  if(state.discountCol) patch.discount = Math.max(0, Number(discount) || 0);
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/products?id=eq.${id}`, {
      method:'PATCH', headers: supaHeaders(),
      body: JSON.stringify(patch)
    });
    if(!res.ok) throw new Error('Update failed');
    state.editing = null;
    const discTxt = state.discountCol ? `, discount ${money(Math.max(0, Number(discount) || 0))}` : '';
    await logProductAction('edit', id, name, `name: "${name}", price: ${money(Number(price))}${discTxt}`);
    await fetchProducts();
    showToast('Product updated.');
  }catch(e){
    showToast('Could not update product: ' + e.message, true);
  }
}

async function restockProduct(id, addQty){
  if(blockViewer()) return;
  const prod = state.products.find(p=>p.id===id);
  if(!prod) return;
  const add = Math.floor(Number(addQty));
  if(!add || add <= 0){ showToast('Enter how many pieces to add.', true); return; }
  try{
    const newStock = (prod.stock||0) + add;
    const res = await fetch(`${state.supaUrl}/rest/v1/products?id=eq.${id}`, {
      method:'PATCH', headers: supaHeaders(),
      body: JSON.stringify({ stock: newStock })
    });
    if(!res.ok) throw new Error('Restock failed');
    state.restockQty = '';
    await logProductAction('restock', id, prod.name, `+${add} pieces (${prod.stock||0} \u2192 ${newStock})`);
    await fetchProducts();
    showToast('+' + add + ' ' + prod.name + ' \u2014 ' + newStock + ' in stock now.');
  }catch(e){
    showToast('Could not restock: ' + e.message, true);
  }
}

async function deductProduct(id, deductQty){
  if(blockViewer()) return;
  const prod = state.products.find(p=>p.id===id);
  if(!prod) return;
  const rem = Math.floor(Number(deductQty));
  if(!rem || rem <= 0){ showToast('Enter how many pieces to remove.', true); return; }
  const cur = prod.stock||0;
  if(rem > cur){ showToast('Cannot remove ' + rem + ' — only ' + cur + ' in stock.', true); return; }
  try{
    const newStock = cur - rem;
    const res = await fetch(`${state.supaUrl}/rest/v1/products?id=eq.${id}`, {
      method:'PATCH', headers: supaHeaders(),
      body: JSON.stringify({ stock: newStock })
    });
    if(!res.ok) throw new Error('Deduct failed');
    state.deductQty = '';
    await logProductAction('stock-set', id, prod.name, `-${rem} pieces (inventory correction: ${cur} \u2192 ${newStock})`);
    await fetchProducts();
    showToast('-' + rem + ' ' + prod.name + ' \u2014 ' + newStock + ' in stock now.');
  }catch(e){
    showToast('Could not deduct stock: ' + e.message, true);
  }
}

async function setStock(id, newStock, note, action){
  if(blockViewer()) return;
  const prod = state.products.find(p=>p.id===id);
  const old = prod ? (prod.stock||0) : 0;
  const res = await fetch(`${state.supaUrl}/rest/v1/products?id=eq.${id}`, {
    method:'PATCH', headers: supaHeaders(),
    body: JSON.stringify({ stock: Math.max(0, Math.floor(newStock)) })
  });
  if(!res.ok) throw new Error('Could not update stock');
  await logProductAction(action || 'stock-set', id, prod ? prod.name : '(product)', `${note || 'stock manually set'}: ${old} \u2192 ${Math.max(0, Math.floor(newStock))}`);
}
