function renderSetup(){
  return '<div class="auth-shell"><div class="panel auth-card">' +
    '<h2>Connect to Supabase</h2>' +
    '<div class="field"><label>Project URL</label><input id="in-url" placeholder="https://xxxx.supabase.co" value="' + escapeHtml(state.supaUrl) + '"></div>' +
    '<div class="field"><label>Anon public key</label><input id="in-key" placeholder="eyJhbGciOi..." value="' + escapeHtml(state.supaKey) + '"></div>' +
    '<button class="primary" id="btn-connect" style="width:auto; padding:9px 18px;">Save connection</button>' +
    '<div class="setup-note">After connecting, sign in with a Supabase Auth account. The account must have a row in the <code>profiles</code> table with role <code>admin</code>, <code>cashier</code>, or <code>viewer</code>.</div>' +
  '</div></div>';
}

const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
function renderLogin(){
  return '<div class="auth-shell"><div class="panel auth-card">' +
    '<div class="login-logo"><img src="CCFACO.png" alt="CCFACO Management System logo" width="96" height="90"></div><h2 class="login-title"><span class="brand-gold">CCFACO</span> <span class="brand-dim">Management System</span></h2><div class="login-sub">Sign in to continue</div>' +
    '<div class="setup-note">Gamitin ang email at Password na ibinigay ng Administrator.</div>' +
    '<div class="field" style="margin-top:16px;"><label>Email</label><input id="in-email" type="email" autocomplete="username" placeholder="you@example.com" value="' + escapeHtml(state.loginEmail) + '"></div>' +
    '<div class="field"><label>Password</label><div class="pw-wrap"><input id="in-password" type="password" autocomplete="current-password" placeholder="Your password"><button type="button" class="pw-eye" id="btn-pw-eye" aria-label="Show password" title="Show password">' + EYE_ICON + '</button></div></div>' +
    '<button class="primary" id="btn-login">' + (state.authLoading ? 'Signing in...' : 'Sign in') + '</button>' +
    (state.authError ? '<div class="auth-error">' + escapeHtml(state.authError) + '</div>' : '') +
  '</div></div>';
}

function renderSettings(){ return renderAdminSettings(); }

function renderPOS(){
  const memberActive = !!state.saleMemberId;
  const q = state.posSearch.trim().toLowerCase();
  // Render ALL products and only hide the non-matches, so clearing/changing the search
  // can show them again without needing to re-open the Sell tab.
  const matchCount = q ? state.products.filter(p => String(p.name||'').toLowerCase().includes(q)).length : state.products.length;
  const rows = state.products.map(p => {
    const hidden = q && !String(p.name||'').toLowerCase().includes(q);
    const disc = (state.discountCol && memberActive) ? productDiscount(p.id) : 0;
    const priceHtml = disc > 0
      ? '<span class="strike">' + money(p.price) + '</span> ' + money(discountedUnitPrice(p))
      : money(p.price);
    const discMeta = disc > 0 ? ' · ' + money(disc) + ' off' : '';
    return `
    <div class="product-row" data-id="${p.id}"${hidden ? ' style="display:none"' : ''}>
      <div>
        <div class="name">${p.name}</div>
        <div class="meta"><span class="stock-num${p.stock<=5?' stock-low':''}">${p.stock}</span> in stock${discMeta}</div>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <div class="price mono">${priceHtml}</div>
        ${isViewer() ? '' : `<button class="free-btn" data-free="${p.id}" title="Freebie (libre)" aria-label="Freebie">\uD83C\uDF81 Free</button>`}
      </div>
    </div>`;
  }).join('') + ((q && matchCount === 0) ? `<div class="empty">No products match your search.</div>` : '');
  const rowsOrEmpty = state.products.length ? rows : `<div class="empty">No products yet. Add some in the Products tab.</div>`;

  const cartRows = state.cart.map(c => `
    <div class="cart-row${c.free ? ' free' : ''}">
      <div class="name">${c.name}${c.free ? ' <span class="tag free">\uD83C\uDF81 FREE</span><div class="free-note">' + escapeHtml(c.remarks) + '</div>' : ''}</div>
      <div class="qty-controls">
        <button data-dec="${c.key}">\u2212</button>
        <input class="qty-input mono" data-qty="${c.key}" type="number" min="0" step="1" inputmode="numeric" value="${c.qty}">
        <button data-inc="${c.key}">+</button>
      </div>
      <div class="mono" data-line="${c.key}" style="width:70px; text-align:right;">${money(lineTotal(c))}</div>
    </div>
  `).join('') || `<div class="empty">Cart is empty. Tap a product to add it.</div>`;

  const total = cartTotal();
  const tenderedNum = Number(state.tendered) || 0;
  const change = tenderedNum - total;
  const hasCart = state.cart.length > 0;
  const tenderedEntered = state.tendered !== '';
  const insufficientAmount = hasCart && total > 0 && (!tenderedEntered || tenderedNum < total);
  const canCheckout = hasCart && !state.checkingOut && !insufficientAmount;

  return `
  <div class="grid">
    <div class="panel">
      <h2>Products</h2>
      <div class="field"><input id="in-pos-search" placeholder="Search products..." value="${escapeHtml(state.posSearch)}"></div>
      <div class="product-list">${rowsOrEmpty}</div>
    </div>
    <div class="panel">
      <h2>Current sale</h2>
      <div class="field">
        <label>Buyer</label>
        <select id="in-sale-member">
          <option value="">Walk-in (no discount)</option>
          ${state.members.map(m => `<option value="${m.id}" ${state.saleMemberId===m.id?'selected':''}>${escapeHtml(m.full_name)}</option>`).join('')}
        </select>
      </div>
      <div>${cartRows}</div>
      <div class="cart-total">
        <span>Total</span>
        <span class="amt mono" id="cart-total-amt">${money(total)}</span>
      </div>
      ${hasCart && total > 0 ? `
      <div class="field" style="margin-top:14px;">
        <label>Amount received</label>
        <input id="in-tendered" type="number" step="0.01" inputmode="decimal" placeholder="0.00" value="${state.tendered}">
      </div>
      <div class="cart-total" style="border-top:none; padding-top:0; margin-top:0;">
        <span>Change (sukli)</span>
        <span class="amt mono" id="change-amount" style="color:${change < 0 ? 'var(--red)' : 'var(--green)'};">${money(Math.max(change,0))}</span>
      </div>
      <div id="insufficient-msg" style="color:var(--red); font-size:12.5px; margin-top:8px;">${insufficientAmount ? (!tenderedEntered ? 'Enter the amount received before completing the sale.' : 'Amount received is less than the total.') : ''}</div>
      ` : ''}
      ${hasCart && total === 0 ? '<div class="setup-note" style="margin-top:12px;">Libre lahat ng nasa cart \u2014 walang babayaran. Mare-record ito na \u20B10.00 kasama ang remarks.</div>' : ''}
      <button class="primary" id="btn-checkout" ${!canCheckout?'disabled':''}>${state.checkingOut ? 'Saving...' : (hasCart && total === 0 ? 'Record freebie' : 'Complete sale')}</button>
    </div>
  </div>`;
}

function productDiscountLabel(p){
  const d = productDiscount(p.id);
  return d > 0 ? ' \u00B7 ' + money(d) + ' off' : '';
}

function renderProducts(){
  const q = state.productSearch.trim().toLowerCase();
  // Render ALL products and only hide non-matches, so clearing the search shows them again.
  const matchCount = q ? state.products.filter(p => String(p.name||'').toLowerCase().includes(q)).length : state.products.length;
  const rowsHtml = state.products.map(p =>     '<div class="product-row" data-edit="' + p.id + '" style="' + (isViewer() ? 'cursor:default;' : '') + ((q && !String(p.name||'').toLowerCase().includes(q)) ? 'display:none;' : '') + '">' +
      '<div><div class="name">' + p.name + '</div><div class="meta"><span class="stock-num' + (p.stock<=5?' stock-low':'') + '">' + p.stock + '</span> in stock' + (state.discountCol ? productDiscountLabel(p) : '') + '</div></div>' +
      '<div style="display:flex; align-items:center; gap:10px;"><div class="price mono">' + (state.discountCol && productDiscount(p.id) > 0 ? '<span class="strike">' + money(p.price) + '</span> ' + money(memberPriceOf(p)) : money(p.price)) + '</div>' +
      (isViewer() ? '' : (isAdmin() ? '<button class="icon-btn" data-del="' + p.id + '" title="Delete">\u2715</button>' : '')) + '</div></div>'
  ).join('');
  const rows = state.products.length
    ? rowsHtml + ((q && matchCount === 0) ? '<div class="empty">No products match your search.</div>' : '')
    : '<div class="empty">No products yet.</div>';

  const ed = state.editing;
  const current = ed ? state.products.find(p=>p.id===ed.id) : null;
  const leftPanel = isViewer() ?
    '<h2>Products</h2><div class="setup-note">Regular access is view-only. Product details can be reviewed, but products and stock cannot be changed.</div>' :
    (ed ?
      '<h2>Edit ' + ed.name + '</h2>' +
      '<div class="field"><label>Name</label><input id="ep-name" value="' + ed.name + '"></div>' +
      '<div class="field"><label>Price</label><input id="ep-price" type="number" step="0.01" value="' + ed.price + '"></div>' +
      (state.discountCol ? '<div class="field"><label>Discount (₱ off per piece)</label><input id="ep-disc" type="number" min="0" step="0.01" placeholder="0" value="' + (ed.discount || 0) + '"></div>' : '') +
      '<button class="primary" id="btn-save-product">Save changes</button>' +
      '<div style="border-top:1px solid var(--line); margin:18px 0 14px;"></div>' +
      '<h2>Adjust stock</h2>' +
      '<div class="meta" style="font-size:12px; color:var(--ink-dim); margin-bottom:10px;">Current stock: <span class="mono">' + (current ? current.stock : 0) + '</span>. Stock goes down automatically on every sale.</div>' +
      '<div class="row2"><div class="field"><label>Add pieces</label><input id="rs-qty" type="number" min="1" step="1" placeholder="0" value="' + state.restockQty + '"></div>' +
      '<div class="field"><label>&nbsp;</label><button class="ghost" id="btn-restock" style="width:100%; padding:9px;">Add to stock</button></div></div>' +
      '<div class="row2"><div class="field"><label>Remove pieces (inventory correction)</label><input id="rd-qty" type="number" min="1" step="1" placeholder="0" value="' + (state.deductQty || '') + '"></div>' +
      '<div class="field"><label>&nbsp;</label><button class="ghost" id="btn-deduct" style="width:100%; padding:9px;">Deduct from stock</button></div></div>' +
      '<button class="ghost" id="btn-cancel-edit" style="width:100%;">Done</button>' :
      '<h2>Add a product</h2>' +
      '<div class="field"><label>Name</label><input id="np-name" placeholder="e.g. Band shirt"></div>' +
      '<div class="row2"><div class="field"><label>Price</label><input id="np-price" type="number" step="0.01" placeholder="0.00"></div>' +
      '<div class="field"><label>Starting stock</label><input id="np-stock" type="number" placeholder="0"></div></div>' +
      (state.discountCol ? '<div class="field"><label>Discount (₱ off per piece)</label><input id="np-disc" type="number" min="0" step="0.01" placeholder="0"></div>' : '') +
      '<button class="primary" id="btn-add-product">Add product</button>');

  return '<div class="grid"><div class="panel">' + leftPanel + '</div><div class="panel">' +
    '<h2>All products <span style="font-weight:400; color:var(--ink-dim);">— ' + (isViewer() ? 'view only' : 'tap one to edit or restock') + '</span></h2>' +
    '<div class="field"><input id="in-product-search" placeholder="Search products..." value="' + escapeHtml(state.productSearch) + '"></div>' +
    '<div class="product-list">' + rows + '</div></div></div>' +
    '<div id="plogs-slot">' + renderProductLogs() + '</div>';
}

function renderLedger(){
  if(!state.ledgerReady){
    return `<div class="panel">
      <h2>Ledger</h2>
      <div class="setup-note">Hindi pa naka-set up ang Ledger. Pumunta sa <strong>Settings</strong> (Admin only) at i-run ang SQL sa ilalim ng "Ledger (Balance Sheet)" section, isang beses lang.</div>
    </div>`;
  }

  const allRows = ledgerWithBalances();
  const lq = state.ledgerSearch.trim().toLowerCase();
  const rows = lq ? allRows.filter(e => {
    const hay = `${e.entry_date||''} ${e.details||''} ${e.qty||''} ${e.pic||''} ${e.balance||''}`.toLowerCase();
    return hay.includes(lq);
  }) : allRows;
  const d = state.ledgerDraft;

  const addForm = isViewer() ? '' : `
    <div class="panel" style="margin-bottom:14px;">
      <h2>Add entry</h2>
      <div class="row2">
        <div class="field"><label>Date</label><input id="lg-date" type="date" value="${d.date}"></div>
        <div class="field"><label>Qty (optional, e.g. 5 or 1.8kg)</label><input id="lg-qty" value="${escapeHtml(d.qty)}"></div>
      </div>
      <div class="field"><label>Details</label><input id="lg-details" placeholder="e.g. tablea sahod, bills, salary" value="${escapeHtml(d.details)}"></div>
      <div class="row2">
        <div class="field"><label>PIC (person/branch)</label><input id="lg-pic" value="${escapeHtml(d.pic)}"></div>
        <div></div>
      </div>
      ${typeof ledgerSupplyFieldsHtml === 'function' ? ledgerSupplyFieldsHtml(d) : ''}
      <div class="row2">
        <div class="field"><label>In (\u20B1)</label><input id="lg-in" type="number" step="0.01" placeholder="0" value="${d.in}"></div>
        <div class="field"><label>Out (\u20B1)</label><input id="lg-out" type="number" step="0.01" placeholder="0" value="${d.out}"></div>
      </div>
      ${state.ledgerDepositCol ? `<label style="display:flex; align-items:center; gap:10px; margin:8px 0 14px; padding:10px 12px; border-radius:10px; background:#FFD8A8; color:#7A3E00; font-weight:700; font-size:14px; cursor:pointer;"><input id="lg-deposit" type="checkbox" ${d.deposit ? 'checked' : ''} style="width:22px; height:22px; accent-color:#7A3E00; flex-shrink:0;"> CASH DEPOSIT &mdash; i click ito kung for deposit sa bangko</label>` : ''}
      <button class="primary" id="btn-add-ledger">Add to ledger</button>
    </div>`;

  const currentBalance = rows.length ? rows[rows.length-1].balance : 0;

  const listRows = rows.slice().reverse().map(e => {
    const dateLabel = e.entry_date ? e.entry_date : '';
    return `
    <div class="sale-row" ${e.voided ? 'style="opacity:0.65;"' : ''}>
      <div class="head">
        <span>${escapeHtml(dateLabel)}${e.qty ? ' \u00B7 ' + escapeHtml(e.qty) : ''}${e.pic ? ' \u00B7 ' + escapeHtml(e.pic) : ''}${e.source === 'sale' ? ' <span class="tag closed">Sale</span>' : ''}${e.is_deposit ? ' <span class="tag">Deposit</span>' : ''}${typeof supplyTagHtml === 'function' ? supplyTagHtml(e) : ''}${e.voided ? ' <span class="tag void">VOIDED</span>' : ''}</span>
        <span class="amt mono">${money(e.balance)}</span>
      </div>
      <div class="items" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <span ${e.voided ? 'style="text-decoration:line-through;"' : ''}>${escapeHtml(e.details)}${Number(e.amount_in)>0 ? ' \u00B7 <span style="color:var(--pos);">+' + money(e.amount_in) + '</span>' : ''}${Number(e.amount_out)>0 ? ' \u00B7 <span style="color:var(--neg);">-' + money(e.amount_out) + '</span>' : ''}</span>
        ${(isAdmin() && !e.voided && state.ledgerDepositCol && Number(e.amount_out) > 0) ? `<button class="icon-btn" data-toggle-deposit="${e.id}" data-deposit-now="${e.is_deposit ? '1' : '0'}" title="${e.is_deposit ? 'Unmark as deposit' : 'Mark as cash deposit (exclude from Expense Report)'}">${e.is_deposit ? '\u2713' : '\u270E'}</button>` : ''}
      </div>
      ${e.voided ? voidNoteHtml(e) : ((isAdmin() && state.voidCol) ? (e.source !== 'sale'
        ? `<button class="ghost void-btn" data-void-ledger="${e.id}">Void entry</button>`
        : (e.sale_id ? `<button class="ghost void-btn" data-void-ledger-sale="${e.sale_id}" data-void-label="${escapeHtml((e.entry_date || '') + ' \u00B7 ' + (e.details || ''))}">Void sale</button>` : '')) : '')}
    </div>`;
  }).join('') || (lq ? `<div class="empty">No ledger entries match your search.</div>` : `<div class="empty">No ledger entries yet.</div>`);

  return `
  <div class="grid">
    <div class="panel">
      ${addForm}
    </div>
    <div class="panel">
      <h2 style="display:flex; align-items:center; justify-content:space-between;">
        <span>Ledger${lq ? ` <span style="font-weight:400; color:var(--ink-dim); font-size:14px;">(search: ${escapeHtml(state.ledgerSearch)} — balance shown is the last visible entry)</span>` : ''}</span>
        <span class="amt mono">${money(rows.length ? rows[rows.length-1].balance : currentBalance)}</span>
      </h2>
      <div class="field"><input id="in-ledger-search" placeholder="Search ledger (details, date, PIC, amount)..." value="${escapeHtml(state.ledgerSearch)}"></div>
      <div class="setup-note" style="margin-bottom:10px;">Awtomatikong pumapasok dito ang bawat Sale (\u201cin\u201d). Manual na idinadagdag ang ibang items \u2014 bills, salary, atbp. Running balance: nakaraang balance + In \u2212 Out.</div>
      ${listRows}
    </div>
  </div>`;
}
