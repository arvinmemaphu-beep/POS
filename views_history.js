function renderHistory(){
  const q = state.dailySearch.trim().toLowerCase();
  const visibleSales = q ? state.sales.filter(s => {
    const d = new Date(s.created_at);
    const itemsStr = (s.sale_items||[]).map(saleItemLabel).join(', ');
    return itemsStr.toLowerCase().includes(q) || d.toLocaleString().toLowerCase().includes(q) || money(s.total).includes(q);
  }) : state.sales;
  const rows = visibleSales.map(s => {
    const d = new Date(s.created_at);
    const itemsStr = (s.sale_items||[]).map(saleItemLabel).join(', ');
    const vd = !!s.voided;
    return `
    <div class="sale-row" ${vd ? 'style="opacity:0.65;"' : ''}>
      <div class="head">
        <span>${d.toLocaleString()}${vd ? ' <span class="tag void">VOIDED</span>' : ''}</span>
        <span class="amt mono" ${vd ? 'style="text-decoration:line-through;"' : ''}>${money(s.total)}</span>
      </div>
      <div class="items">${itemsStr}</div>
      ${vd ? voidNoteHtml(s) : ((isAdmin() && state.voidCol) ? `<button class="ghost void-btn" data-void-sale="${s.id}">Void</button>` : '')}
    </div>`;
  }).join('') || (q ? `<div class="empty">No sales match your search.</div>` : `<div class="empty">No sales yet.</div>`);

  return `<div class="panel">
    <h2 style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
      <span>Sales History</span>
      <button class="ghost" id="btn-export-excel" style="padding:7px 12px; white-space:nowrap;">Export to Excel</button>
    </h2>
    <div class="field"><input id="in-history-search" placeholder="Search sales (product, date, amount)..." value="${escapeHtml(state.dailySearch)}"></div>
    <div class="setup-note" style="margin-bottom:10px;">Ini-export ang LAHAT ng report sa isang Excel file (.xlsx) na may 4 sheets: Sales Summary, Sale Items, Consignments, at Consignment Items \u2014 buong history, hindi lang itong nakikita dito.</div>
    ${rows}
  </div>`;
}

function renderSaleItems(){
  const byProduct = {};
  for(const it of state.saleItems){
    const key = it.product_name;
    if(!byProduct[key]) byProduct[key] = { qty: 0, free: 0, revenue: 0 };
    if(it.is_free) byProduct[key].free += it.qty; else byProduct[key].qty += it.qty;
    byProduct[key].revenue += it.price * it.qty;
  }
  const summaryRows = Object.entries(byProduct)
    .sort((a,b)=> b[1].revenue - a[1].revenue)
    .map(([name, s]) => `
      <div class="product-row">
        <div>
          <div class="name">${name}</div>
          <div class="meta">${s.qty} sold${s.free ? ' \u00B7 \uD83C\uDF81 ' + s.free + ' free' : ''}</div>
        </div>
        <div class="price mono">${money(s.revenue)}</div>
      </div>
    `).join('') || `<div class="empty">No sale items yet.</div>`;

  const editing = state.editingSaleItem;
  const listRows = state.saleItems.map(it => {
    const d = it.sales && it.sales.created_at ? new Date(it.sales.created_at) : null;
    if(isAdmin() && editing && editing.id === it.id){
      return `
      <div class="sale-row">
        <div class="field"><label>Product name</label><input id="esi-name" value="${escapeHtml(editing.product_name)}"></div>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="primary" id="btn-save-sale-item" style="flex:1;">Save</button>
          <button class="ghost" id="btn-cancel-sale-item" style="flex:1;">Cancel</button>
        </div>
      </div>`;
    }
    return `
    <div class="sale-row">
      <div class="head">
        <span>${d ? d.toLocaleString() : ''}</span>
        <span class="amt mono">${money(it.price * it.qty)}</span>
      </div>
      <div class="items" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <span>${it.is_free ? '<span class="tag free">\uD83C\uDF81 FREE</span> ' : ''}${it.qty}\u00D7 ${it.product_name} @ ${money(it.price)}${it.is_free ? '<div class="free-note">Remarks: ' + escapeHtml(it.free_remarks || '(walang remarks)') + '</div>' : ''}</span>
        ${isAdmin() ? `<button class="icon-btn" data-edit-sale-item="${it.id}" title="Correct product name">\u270E</button>` : ''}
      </div>
    </div>`;
  }).join('') || `<div class="empty">No sale items yet.</div>`;

  return `
  <div class="grid">
    <div class="panel">
      <h2>Total sold per product</h2>
      <div class="product-list">${summaryRows}</div>
    </div>
    <div class="panel">
      <h2>All sale items${isAdmin() ? ' <span style="font-weight:400; color:var(--ink-dim);">\u2014 tap \u270E to correct a name</span>' : ''}</h2>
      <div>${listRows}</div>
    </div>
  </div>`;
}
