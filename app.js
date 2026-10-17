function setThemeOpen(open){
  state.themeOpen = open;
  document.querySelectorAll('.theme-pop, .theme-scrim').forEach(n=> n.classList.toggle('open', open));
  const b = document.getElementById('btn-theme');
  if(b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function themeMarkup(){
  const cur = currentTheme();
  const opts = Object.keys(THEMES).map(k=>{
    const t = THEMES[k];
    return '<button type="button" class="theme-opt' + (k === cur ? ' active' : '') + '" data-theme-pick="' + k + '">' +
      '<span class="theme-chip" style="background:' + t.bg + '; border-color:' + t.accent + ';"><i style="background:' + t.accent + ';"></i></span>' +
      '<span>' + t.label + '</span><span class="theme-check">\u2713</span></button>';
  }).join('');
  return '<div class="theme-wrap">' +
    '<button class="theme-btn" id="btn-theme" type="button" aria-label="Change color theme" title="Change color theme" aria-expanded="' + (state.themeOpen ? 'true' : 'false') + '">\uD83C\uDFA8</button>' +
    '<button class="theme-scrim' + (state.themeOpen ? ' open' : '') + '" type="button" aria-label="Close" tabindex="-1"></button>' +
    '<div class="theme-pop' + (state.themeOpen ? ' open' : '') + '"><h3>Color theme</h3><p class="theme-note">Saved on this device only.</p>' + opts + '</div>' +
  '</div>';
}

function freeModalMarkup(){
  const fp = state.freePrompt;
  if(!fp) return '';
  const prod = state.products.find(p=>p.id===fp.id);
  const chips = ['Free token', 'Gift', 'Free taste'].map(t => `<button type="button" class="chip" data-free-chip="${t}">${t}</button>`).join('');
  return `
  <div class="free-scrim" id="free-scrim"></div>
  <div class="free-modal" role="dialog" aria-modal="true" aria-label="Freebie">
    <h2>\uD83C\uDF81 Freebie (libre)</h2>
    <div class="setup-note" style="margin-bottom:12px;"><b>${prod ? escapeHtml(prod.name) : ''}</b> \u2014 \u20B10.00 ang halaga. Isulat kung para saan o kanino ibibigay; lalabas ito sa reports.</div>
    <div class="field"><label>Quantity</label><input id="fp-qty" type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(fp.qty)}"></div>
    <div class="field"><label>Remarks (kailangan)</label><input id="fp-remarks" placeholder="hal. Free token para sa..., Gift kay..., Free taste" value="${escapeHtml(fp.remarks)}" autocomplete="off"></div>
    <div class="chips">${chips}</div>
    <div style="display:flex; gap:8px; margin-top:14px;">
      <button class="primary" id="fp-add" style="flex:1; margin-top:0;">Add to cart</button>
      <button class="ghost" id="fp-cancel" style="flex:1;">Cancel</button>
    </div>
  </div>`;
}

function render(){
  const app = document.getElementById('app');
  if(state.connected && state.tab === 'settings' && !isAdmin()) state.tab = 'pos';
  if(state.connected && state.tab === 'report' && !canSeeReport()) state.tab = 'pos';
  let body;
  if(!state.supaUrl || !state.supaKey){
    body = renderSetup();
  } else if(!state.connected){
    body = renderLogin();
  } else if(state.tab === 'pos'){
    body = renderPOS();
  } else if(state.tab === 'products'){
    body = renderProducts();
  } else if(state.tab === 'members'){
    body = renderMembers();
  } else if(state.tab === 'settings'){
    body = isAdmin() ? renderSettings() : renderPOS();
  } else if(state.tab === 'items'){
    body = renderSaleItems();
  } else if(state.tab === 'consign'){
    body = renderConsign();
  } else if(state.tab === 'ledger'){
    body = renderLedger();
  } else if(state.tab === 'report'){
    body = renderReport();
  } else if(state.tab === 'expenses'){
    body = renderExpenses();
  } else {
    body = renderHistory();
  }

  const active = tab => state.tab === tab ? 'active' : '';
  const mobileUser = state.connected ?
    '<div class="m-userbar"><span class="role-badge">' + escapeHtml(roleLabel()) + '</span><span>' + escapeHtml(state.user && state.user.email ? state.user.email : 'Signed in') + '</span><button class="ghost" data-chpw="1" style="padding:5px 9px;">\uD83D\uDD11 Password</button><button class="ghost" id="btn-logout-m" style="padding:5px 9px;">Sign out</button></div>' : '';
  const nav = state.connected ?
    '<nav class="tabs' + (state.menuOpen ? ' open' : '') + '">' +
      (isViewer() ? '' : '<button data-tab="pos" class="' + active('pos') + '">Sell</button>') +
      '<button data-tab="products" class="' + active('products') + '">Products</button>' +
      '<button data-tab="consign" class="' + active('consign') + '">Consign</button>' +
      // discount is a fixed peso amount per product, set in the Products tab
      '<button data-tab="members" class="' + active('members') + '">Members</button>' +
      '<div class="nav-group' + (state.reportMenuOpen ? ' open' : '') + '">' +
        '<button data-group="report" class="' + (['items','report','expenses','history'].indexOf(state.tab) >= 0 ? 'active' : '') + '" aria-haspopup="true" aria-expanded="' + (state.reportMenuOpen ? 'true' : 'false') + '">Report &#9662;</button>' +
        '<div class="nav-sub">' +
          '<button data-tab="items" class="' + active('items') + '">Daily</button>' +
          '<button data-tab="report" class="' + active('report') + '">Monthly</button>' +
          '<button data-tab="expenses" class="' + active('expenses') + '">Expenses</button>' +
          '<button data-tab="history" class="' + active('history') + '">History</button>' +
        '</div>' +
      '</div>' +
      '<button data-tab="ledger" class="' + active('ledger') + '">Ledger</button>' +
      (isAdmin() ? '<button data-tab="settings" class="' + active('settings') + '">Settings</button>' : '') +
      mobileUser +
    '</nav>' : '';
  const burger = state.connected ? '<button class="burger" id="btn-burger" aria-label="Menu">☰</button>' : '';
  const scrim = state.connected ? '<button class="scrim' + (state.menuOpen ? ' open' : '') + '" aria-label="Close menu" tabindex="-1"></button>' : '';
  const userBar = state.connected ?
    '<div class="user-bar"><span class="role-badge">' + escapeHtml(roleLabel()) + '</span><span>' + escapeHtml(state.user && state.user.email ? state.user.email : 'Signed in') + '</span><button class="ghost" data-chpw="1" style="padding:5px 9px;">\uD83D\uDD11 Password</button><button class="ghost" id="btn-logout" style="padding:5px 9px;">Sign out</button></div>' : '';

  app.innerHTML =
    '<header class="top"><div style="display:flex;align-items:center;gap:14px;"><img src="CCFACO.png" alt="CCFACO Management System logo" width="56" height="52" style="filter: drop-shadow(0 2px 6px rgba(0,0,0,0.4));"><div><h1><span class="brand-gold">CCFACO</span> <span class="brand-dim">Management System</span></h1><div class="sub">Designed by Arvin B.</div></div></div>' +
    '<div class="hdr-right"><div class="hdr-col">' + nav + userBar + '</div>' + themeMarkup() + burger + '</div></header>' +
    scrim +
    body +
    freeModalMarkup() +
    voidModalMarkup() +
    pwModalMarkup() +
    (state.toast ? '<div class="toast ' + (state.toast.isErr ? 'err' : '') + '">' + escapeHtml(state.toast.msg) + '</div>' : '');

  if(isViewer() && state.tab === 'pos'){
    state.tab = 'products';
    render();
    return;
  }
  if(isViewer() && state.tab === 'products'){
    const productEditor = app.querySelector('.grid > .panel');
    if(productEditor) productEditor.style.display = 'none';
    app.querySelectorAll('[data-del]').forEach(button=>{ button.style.display = 'none'; });
  }
  if(isViewer() && state.tab === 'consign'){
    const consignEditor = app.querySelector('.grid > .panel');
    if(consignEditor) consignEditor.style.display = 'none';
    app.querySelectorAll('[data-sold], [data-ret], [data-settle], [data-draft-del], [data-mpay], [data-mfound], [data-miss-go]').forEach(control=>{ control.style.display = 'none'; control.disabled = true; });
  }

  // wire events
  const themeBtnEl = document.getElementById('btn-theme');
  if(themeBtnEl) themeBtnEl.addEventListener('click', ()=> setThemeOpen(!state.themeOpen));
  const themeScrimEl = app.querySelector('.theme-scrim');
  if(themeScrimEl) themeScrimEl.addEventListener('click', ()=> setThemeOpen(false));
  app.querySelectorAll('[data-theme-pick]').forEach(b=>{
    b.addEventListener('click', ()=>{ applyTheme(b.dataset.themePick, true); });
  });
  app.querySelectorAll('nav.tabs button[data-tab]').forEach(b=>{
    b.addEventListener('click', ()=> switchTab(b.dataset.tab));
  });
  app.querySelectorAll('nav.tabs button[data-group]').forEach(b=>{
    b.addEventListener('click', ()=>{ state.reportMenuOpen = !state.reportMenuOpen; render(); });
  });

  const connectBtn = document.getElementById('btn-connect');
  if(connectBtn){
    connectBtn.addEventListener('click', async ()=>{
      const previousUrl = state.supaUrl;
      const previousKey = state.supaKey;
      state.supaUrl = document.getElementById('in-url').value.trim().replace(/\/$/,'');
      state.supaKey = document.getElementById('in-key').value.trim();
      await saveConfig();
      const changed = previousUrl !== state.supaUrl || previousKey !== state.supaKey;
      if(changed || !state.connected){
        clearSession();
        state.session = null;
        state.user = null;
        state.role = null;
        state.connected = false;
        state.authError = '';
        render();
        showToast('Supabase connection saved. Sign in to continue.');
      }else{
        showToast('Supabase connection saved.');
      }
    });
  }

  const loginBtn = document.getElementById('btn-login');
  if(loginBtn){
    loginBtn.addEventListener('click', async ()=>{
      state.loginEmail = document.getElementById('in-email').value.trim();
      const password = document.getElementById('in-password').value;
      await login(state.loginEmail, password);
    });
  }
  const emailInput = document.getElementById('in-email');
  if(emailInput) emailInput.addEventListener('keydown', ev=>{ if(ev.key === 'Enter') document.getElementById('in-password').focus(); });
  const passwordInput = document.getElementById('in-password');
  const pwEye = document.getElementById('btn-pw-eye');
  if(pwEye && passwordInput){
    pwEye.addEventListener('click', ()=>{
      const show = passwordInput.type === 'password';
      passwordInput.type = show ? 'text' : 'password';
      pwEye.innerHTML = show ? EYE_OFF_ICON : EYE_ICON;
      pwEye.classList.toggle('on', show);
      const label = show ? 'Hide password' : 'Show password';
      pwEye.setAttribute('aria-label', label);
      pwEye.title = label;
      passwordInput.focus();
    });
  }
  if(passwordInput) passwordInput.addEventListener('keydown', ev=>{ if(ev.key === 'Enter') loginBtn.click(); });

  const logoutBtn = document.getElementById('btn-logout');
  if(logoutBtn) logoutBtn.addEventListener('click', logout);
  const logoutBtnM = document.getElementById('btn-logout-m');
  if(logoutBtnM) logoutBtnM.addEventListener('click', logout);

  const burgerBtn = document.getElementById('btn-burger');
  if(burgerBtn) burgerBtn.addEventListener('click', ()=>{ state.menuOpen = !state.menuOpen; render(); });
  const scrimEl = app.querySelector('.scrim');
  if(scrimEl) scrimEl.addEventListener('click', ()=>{ state.menuOpen = false; render(); });

  app.querySelectorAll('.product-row[data-id]').forEach(r=>{
    r.addEventListener('click', ()=>{
      const p = state.products.find(x=>x.id===r.dataset.id);
      if(p) addToCart(p);
    });
  });

  app.querySelectorAll('[data-free]').forEach(b=>{
    b.addEventListener('click', (ev)=>{ ev.stopPropagation(); openFreePrompt(b.dataset.free); });
  });
  if(state.freePrompt){
    const fpRem = document.getElementById('fp-remarks');
    const fpQty = document.getElementById('fp-qty');
    if(fpRem){
      fpRem.addEventListener('input', ()=>{ state.freePrompt.remarks = fpRem.value; });
      fpRem.addEventListener('keydown', ev=>{ if(ev.key === 'Enter') confirmFreePrompt(); });
      if(state.freePrompt.focus){ state.freePrompt.focus = false; fpRem.focus(); }
    }
    if(fpQty) fpQty.addEventListener('input', ()=>{ state.freePrompt.qty = fpQty.value; });
    app.querySelectorAll('[data-free-chip]').forEach(b=>{
      b.addEventListener('click', ()=>{
        const t = b.dataset.freeChip + ': ';
        state.freePrompt.remarks = t;
        if(fpRem){ fpRem.value = t; fpRem.focus(); fpRem.setSelectionRange(t.length, t.length); }
      });
    });
    const fpAdd = document.getElementById('fp-add');
    if(fpAdd) fpAdd.addEventListener('click', confirmFreePrompt);
    const fpCancel = document.getElementById('fp-cancel');
    if(fpCancel) fpCancel.addEventListener('click', ()=>{ state.freePrompt = null; render(); });
    const fpScrim = document.getElementById('free-scrim');
    if(fpScrim) fpScrim.addEventListener('click', ()=>{ state.freePrompt = null; render(); });
  }

  if(state.voidPrompt){
    const vr = document.getElementById('void-reason');
    if(vr){
      vr.addEventListener('input', ()=>{ state.voidPrompt.reason = vr.value; });
      vr.addEventListener('keydown', ev=>{ if(ev.key === 'Enter') confirmVoid(); });
      if(state.voidPrompt.focus){ state.voidPrompt.focus = false; vr.focus(); }
    }
    app.querySelectorAll('[data-void-chip]').forEach(b=>{
      b.addEventListener('click', ()=>{
        state.voidPrompt.reason = b.dataset.voidChip;
        if(vr){ vr.value = b.dataset.voidChip; vr.focus(); }
      });
    });
    const vc = document.getElementById('void-confirm');
    if(vc) vc.addEventListener('click', confirmVoid);
    const vx = document.getElementById('void-cancel');
    if(vx) vx.addEventListener('click', ()=>{ state.voidPrompt = null; render(); });
    const vs = document.getElementById('void-scrim');
    if(vs) vs.addEventListener('click', ()=>{ if(!state.voidPrompt.busy){ state.voidPrompt = null; render(); } });
  }
  app.querySelectorAll('[data-void-sale]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const sv = state.sales.find(x=>x.id===b.dataset.voidSale);
      if(sv) openVoidPrompt('sale', sv.id, new Date(sv.created_at).toLocaleString() + ' \u00B7 ' + money(sv.total));
    });
  });
  app.querySelectorAll('[data-void-consign]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const cv = state.consignments.find(x=>x.id===b.dataset.voidConsign);
      if(cv) openVoidPrompt(b.dataset.voidMode === 'settle' ? 'consign-settle' : 'consign-sent', cv.id, (cv.consignee || 'consignee') + ' \u00B7 ' + new Date(cv.created_at).toLocaleDateString());
    });
  });
  app.querySelectorAll('[data-void-event]').forEach(b=>{
    b.addEventListener('click', ()=>{
      let ev = null, cc = null;
      for(const c of state.consignments){
        ev = (c.consignment_events || []).find(x => x.id === b.dataset.voidEvent);
        if(ev){ cc = c; break; }
      }
      if(ev) openVoidPrompt('consign-event', ev.id, (cc.consignee || 'consignee') + ' \u00B7 ' + (ev.kind === 'paid' ? 'Bayad ' + money(ev.total) : 'Nakita / naibalik'));
    });
  });
  app.querySelectorAll('[data-void-ledger-sale]').forEach(b=>{
    b.addEventListener('click', ()=> openVoidPrompt('sale', b.dataset.voidLedgerSale, b.dataset.voidLabel || 'Sale'));
  });
  app.querySelectorAll('[data-void-ledger]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const lv = state.ledgerEntries.find(x=>x.id===b.dataset.voidLedger);
      if(lv) openVoidPrompt('ledger', lv.id, (lv.entry_date || '') + ' \u00B7 ' + (lv.details || ''));
    });
  });

  app.querySelectorAll('[data-inc]').forEach(b=> b.addEventListener('click', ()=> changeQty(b.dataset.inc, 1)));
  app.querySelectorAll('[data-dec]').forEach(b=> b.addEventListener('click', ()=> changeQty(b.dataset.dec, -1)));

  const checkoutBtn = document.getElementById('btn-checkout');
  if(checkoutBtn) checkoutBtn.addEventListener('click', checkout);

  const posSearchInput = document.getElementById('in-pos-search');
  if(posSearchInput){
    posSearchInput.addEventListener('input', ()=>{
      state.posSearch = posSearchInput.value;
      const list = app.querySelector('.product-list');
      if(list){
        const q = state.posSearch.trim().toLowerCase();
        let any = false;
        list.querySelectorAll('.product-row').forEach(r=>{
          const n = r.querySelector('.name');
          const show = !q || (n && n.textContent.toLowerCase().includes(q));
          r.style.display = show ? '' : 'none';
          if(show) any = true;
        });
        let empty = list.querySelector('.empty');
        if(!any && !empty){
          empty = document.createElement('div'); empty.className='empty'; empty.textContent='No products match your search.'; list.appendChild(empty);
        } else if(empty && any){ empty.remove(); }
      }
    });
  }

  const saleMemberSelect = document.getElementById('in-sale-member');
  if(saleMemberSelect){
    saleMemberSelect.addEventListener('change', ()=>{
      state.saleMemberId = saleMemberSelect.value;
      render();
    });
  }

  const tenderedInput = document.getElementById('in-tendered');
  if(tenderedInput){
    tenderedInput.addEventListener('input', ()=>{
      state.tendered = tenderedInput.value;
      updateChangeDisplay();
    });
  }

  const addProdBtn = document.getElementById('btn-add-product');
  if(addProdBtn){
    addProdBtn.addEventListener('click', async ()=>{
      const name = document.getElementById('np-name').value.trim();
      const price = document.getElementById('np-price').value;
      const stock = document.getElementById('np-stock').value || 0;
      const discInput = document.getElementById('np-disc');
      const discount = discInput ? discInput.value : 0;
      if(!name || !price){ showToast('Enter a name and price.', true); return; }
      await addProduct(name, price, stock, discount);
    });
  }

  app.querySelectorAll('[data-del]').forEach(b=>{
    b.addEventListener('click', (ev)=>{ ev.stopPropagation(); deleteProduct(b.dataset.del); });
  });

  /* typed cart quantity */
  app.querySelectorAll('[data-qty]').forEach(inp=>{
    inp.addEventListener('input', ()=> setCartQty(inp.dataset.qty, inp.value));
    inp.addEventListener('blur', ()=> commitCartQty(inp.dataset.qty));
    inp.addEventListener('keydown', (ev)=>{ if(ev.key === 'Enter') inp.blur(); });
  });

  /* edit + restock */
  app.querySelectorAll('[data-edit]').forEach(r=>{
    r.addEventListener('click', (ev)=>{
      if(blockViewer()) return;
      if(ev.target.hasAttribute('data-del')) return;
      const p = state.products.find(x=>x.id===r.dataset.edit);
      if(p){ state.editing = { id: p.id, name: p.name, price: p.price, discount: Number(p.discount) || 0 }; state.restockQty = ''; render(); }
    });
  });
  const saveProdBtn = document.getElementById('btn-save-product');
  if(saveProdBtn){
    saveProdBtn.addEventListener('click', ()=>{
      const discInput = document.getElementById('ep-disc');
      updateProduct(state.editing.id, document.getElementById('ep-name').value.trim(), document.getElementById('ep-price').value, discInput ? discInput.value : 0);
    });
  }
  const cancelEditBtn = document.getElementById('btn-cancel-edit');
  if(cancelEditBtn) cancelEditBtn.addEventListener('click', ()=>{ state.editing = null; render(); });
  const restockBtn = document.getElementById('btn-restock');
  if(restockBtn){
    restockBtn.addEventListener('click', ()=>{
      restockProduct(state.editing.id, document.getElementById('rs-qty').value);
    });
  }

  /* sale item name correction (Admin-only) */
  app.querySelectorAll('[data-edit-sale-item]').forEach(b=>{
    b.addEventListener('click', ()=>{
      if(!isAdmin()) return;
      const it = state.saleItems.find(x=>x.id===b.dataset.editSaleItem);
      if(it){ state.editingSaleItem = { id: it.id, product_name: it.product_name }; render(); }
    });
  });
  const saveSaleItemBtn = document.getElementById('btn-save-sale-item');
  if(saveSaleItemBtn){
    saveSaleItemBtn.addEventListener('click', ()=>{
      updateSaleItemName(state.editingSaleItem.id, document.getElementById('esi-name').value);
    });
  }
  const cancelSaleItemBtn = document.getElementById('btn-cancel-sale-item');
  if(cancelSaleItemBtn) cancelSaleItemBtn.addEventListener('click', ()=>{ state.editingSaleItem = null; render(); });

  /* ledger: mark/unmark a past entry as a cash deposit (Admin-only) */
  app.querySelectorAll('[data-toggle-deposit]').forEach(b=>{
    b.addEventListener('click', ()=>{
      if(!isAdmin()) return;
      toggleLedgerDeposit(b.dataset.toggleDeposit, b.dataset.depositNow !== '1');
    });
  });

  /* members */
  wireMemberRows();
  const memberSearchInput = document.getElementById('in-member-search');
  if(memberSearchInput){
    memberSearchInput.addEventListener('input', ()=>{
      state.memberSearch = memberSearchInput.value;
      updateMemberList();
    });
  }

  const productSearchInput = document.getElementById('in-product-search');
  if(productSearchInput){
    productSearchInput.addEventListener('input', ()=>{
      state.productSearch = productSearchInput.value;
      const list = app.querySelector('.product-list');
      if(list){
        const q = state.productSearch.trim().toLowerCase();
        const items = list.querySelectorAll('.product-row .name');
        let any = false;
        list.querySelectorAll('.product-row').forEach(r=>{
          const n = r.querySelector('.name');
          const show = !q || (n && n.textContent.toLowerCase().includes(q));
          r.style.display = show ? '' : 'none';
          if(show) any = true;
        });
        let empty = list.querySelector('.empty');
        if(!any && !empty){
          empty = document.createElement('div'); empty.className='empty'; empty.textContent='No products match your search.'; list.appendChild(empty);
        } else if(empty && any){ empty.remove(); }
      }
    });
  }

  const deductBtn = document.getElementById('btn-deduct');
  if(deductBtn){
    deductBtn.addEventListener('click', ()=>{
      deductProduct(state.editing.id, document.getElementById('rd-qty').value);
    });
  }

  const showPlogsBtn = document.getElementById('btn-show-plogs');
  if(showPlogsBtn){ showPlogsBtn.addEventListener('click', ()=>{ state.showProductLogs = true; fetchProductLogs(); }); }
  const hidePlogsBtn = document.getElementById('btn-hide-plogs');
  if(hidePlogsBtn){ hidePlogsBtn.addEventListener('click', ()=>{ state.showProductLogs = false; render(); }); }
  const addMemberBtn = document.getElementById('btn-add-member');
  if(addMemberBtn){
    addMemberBtn.addEventListener('click', async ()=>{
      const name = document.getElementById('nm-name').value.trim();
      const phone = document.getElementById('nm-phone').value.trim();
      if(!name){ showToast('Enter the member name.', true); return; }
      await addMember(name, phone);
    });
  }
  const saveMemberBtn = document.getElementById('btn-save-member');
  if(saveMemberBtn){
    saveMemberBtn.addEventListener('click', ()=>{
      updateMember(state.editingMember.id, document.getElementById('em-name').value.trim(), document.getElementById('em-phone').value.trim());
    });
  }
  const memberFileInput = document.getElementById('in-member-file');
  if(memberFileInput){
    memberFileInput.addEventListener('change', ()=>{
      const f = memberFileInput.files && memberFileInput.files[0];
      if(f) importMembersFile(f);
    });
  }
  const memberTplBtn = document.getElementById('btn-member-template');
  if(memberTplBtn) memberTplBtn.addEventListener('click', downloadMemberTemplate);
  const cancelMemberBtn = document.getElementById('btn-cancel-member');
  if(cancelMemberBtn) cancelMemberBtn.addEventListener('click', ()=>{ state.editingMember = null; render(); });

  /* users (admin-only) */
  app.querySelectorAll('[data-chpw]').forEach(b=> b.addEventListener('click', openPwPrompt));
  if(state.pwPrompt){
    const pc = document.getElementById('pw-cur'), pn = document.getElementById('pw-new'), pf = document.getElementById('pw-confirm');
    if(pc) pc.addEventListener('input', ()=>{ state.pwPrompt.cur = pc.value; });
    if(pn) pn.addEventListener('input', ()=>{ state.pwPrompt.next = pn.value; });
    if(pf){
      pf.addEventListener('input', ()=>{ state.pwPrompt.confirm = pf.value; });
      pf.addEventListener('keydown', ev=>{ if(ev.key === 'Enter') changeOwnPassword(); });
    }
    if(state.pwPrompt.focus){ state.pwPrompt.focus = false; if(pc) pc.focus(); }
    const showCb = document.getElementById('pw-show');
    if(showCb) showCb.addEventListener('change', ()=>{ [pc, pn, pf].forEach(i=>{ if(i) i.type = showCb.checked ? 'text' : 'password'; }); });
    const pwSave = document.getElementById('pw-save');
    if(pwSave) pwSave.addEventListener('click', changeOwnPassword);
    const pwCancel = document.getElementById('pw-cancel');
    if(pwCancel) pwCancel.addEventListener('click', ()=>{ state.pwPrompt = null; render(); });
    const pwScrim = document.getElementById('pw-scrim');
    if(pwScrim) pwScrim.addEventListener('click', ()=>{ state.pwPrompt = null; render(); });
  }
  [['nu-name','name'],['nu-email','email'],['nu-password','password'],['nu-role','role']].forEach(([id, key])=>{
    const f = document.getElementById(id);
    if(f) f.addEventListener(key === 'role' ? 'change' : 'input', ()=>{ state.userDraft[key] = f.value; });
  });
  const reloadUsersBtn = document.getElementById('btn-reload-users');
  if(reloadUsersBtn) reloadUsersBtn.addEventListener('click', fetchAppUsers);
  const addUserBtn = document.getElementById('btn-add-user');
  if(addUserBtn){
    addUserBtn.addEventListener('click', async ()=>{
      const email = document.getElementById('nu-email').value.trim();
      const password = document.getElementById('nu-password').value;
      const name = document.getElementById('nu-name').value.trim();
      const role = document.getElementById('nu-role').value;
      await createUser(email, password, name, role);
    });
  }
  app.querySelectorAll('[data-role-user]').forEach(sel=>{
    sel.addEventListener('change', ()=> updateUserRole(sel.dataset.roleUser, sel.value));
  });
  app.querySelectorAll('[data-remove-user]').forEach(b=>{
    b.addEventListener('click', ()=> removeUserAccess(b.dataset.removeUser));
  });

  /* consignment */
  const csConsignee = document.getElementById('cs-consignee');
  if(csConsignee) csConsignee.addEventListener('input', ()=>{ state.consignee = csConsignee.value; });
  const csMember = document.getElementById('cs-member');
  if(csMember) csMember.addEventListener('change', ()=>{ state.consignMemberId = csMember.value; });
  const csNote = document.getElementById('cs-note');
  if(csNote) csNote.addEventListener('input', ()=>{ state.consignNote = csNote.value; });
  const csProduct = document.getElementById('cs-product');
  if(csProduct) csProduct.addEventListener('change', ()=>{ state.consignPick = csProduct.value; render(); });
  const csQty = document.getElementById('cs-qty');
  if(csQty) csQty.addEventListener('input', ()=>{ state.consignPickQty = csQty.value; });
  const csAddBtn = document.getElementById('btn-cs-add');
  if(csAddBtn) csAddBtn.addEventListener('click', addConsignDraft);
  const csSendBtn = document.getElementById('btn-cs-send');
  if(csSendBtn) csSendBtn.addEventListener('click', sendConsignment);
  app.querySelectorAll('[data-draft-del]').forEach(b=>{
    b.addEventListener('click', ()=>{
      state.consignDraft = state.consignDraft.filter(d=>d.product_id !== b.dataset.draftDel);
      render();
    });
  });

  function bindSettleInput(inp, id, key){
    inp.addEventListener('input', ()=>{
      if(!state.settle[id]) state.settle[id] = {};
      state.settle[id][key] = inp.value;
      const item = state.consignments
        .flatMap(c=> c.consignment_items || [])
        .find(i=> i.id === id);
      const span = document.querySelector(`[data-remain="${id}"]`);
      if(item && span){
        const s = state.settle[id];
        span.textContent = (item.qty_sent||0) - (Number(s.sold)||0) - (Number(s.returned)||0);
      }
    });
  }
  app.querySelectorAll('[data-sold]').forEach(inp=> bindSettleInput(inp, inp.dataset.sold, 'sold'));
  app.querySelectorAll('[data-ret]').forEach(inp=> bindSettleInput(inp, inp.dataset.ret, 'returned'));
  app.querySelectorAll('[data-settle]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const c = state.consignments.find(x=>x.id === b.dataset.settle);
      if(c) settleConsignment(c);
    });
  });

  app.querySelectorAll('[data-mpay]').forEach(inp=> inp.addEventListener('input', ()=>{ const id = inp.dataset.mpay; (state.missInput[id] = state.missInput[id] || {}).pay = inp.value; }));
  app.querySelectorAll('[data-mfound]').forEach(inp=> inp.addEventListener('input', ()=>{ const id = inp.dataset.mfound; (state.missInput[id] = state.missInput[id] || {}).found = inp.value; }));
  app.querySelectorAll('[data-miss-go]').forEach(b=> b.addEventListener('click', ()=>{
    const c = state.consignments.find(x => x.id === b.dataset.missGo);
    if(c) settleMissing(c);
  }));

  /* consignment item name correction (Admin-only) */
  app.querySelectorAll('[data-edit-consign-item]').forEach(b=>{
    b.addEventListener('click', ()=>{
      if(!isAdmin()) return;
      let found = null;
      for(const c of state.consignments){
        found = (c.consignment_items || []).find(x=>x.id===b.dataset.editConsignItem);
        if(found) break;
      }
      if(found){ state.editingConsignItem = { id: found.id, product_name: found.product_name }; render(); }
    });
  });
  const saveConsignItemBtn = document.getElementById('btn-save-consign-item');
  if(saveConsignItemBtn){
    saveConsignItemBtn.addEventListener('click', ()=>{
      updateConsignItemName(state.editingConsignItem.id, document.getElementById('eci-name').value);
    });
  }
  const cancelConsignItemBtn = document.getElementById('btn-cancel-consign-item');
  if(cancelConsignItemBtn) cancelConsignItemBtn.addEventListener('click', ()=>{ state.editingConsignItem = null; render(); });

  const backupBtn = document.getElementById('btn-backup');
  if(backupBtn) backupBtn.addEventListener('click', backupToExcel);
  const exportExcelBtn = document.getElementById('btn-export-excel');
  if(exportExcelBtn) exportExcelBtn.addEventListener('click', exportHistoryToExcel);

  const consignSearchInput = document.getElementById('in-consign-search');
  if(consignSearchInput){
    consignSearchInput.addEventListener('input', ()=>{
      state.consignSearch = consignSearchInput.value;
      const q = state.consignSearch.trim().toLowerCase();
      const list = consignSearchInput.closest('.panel');
      if(list){
        let any = false;
        list.querySelectorAll('.sale-row').forEach(r=>{
          const show = !q || r.textContent.toLowerCase().includes(q);
          r.style.display = show ? '' : 'none';
          if(show) any = true;
        });
        let empty = list.querySelector('.empty');
        if(!any && !empty){
          empty = document.createElement('div'); empty.className='empty'; empty.textContent='No consignments match your search.'; list.appendChild(empty);
        } else if(empty && any){ empty.remove(); }
      }
    });
  }

  const historySearchInput = document.getElementById('in-history-search');
  if(historySearchInput){
    historySearchInput.addEventListener('input', ()=>{
      state.dailySearch = historySearchInput.value;
      const q = state.dailySearch.trim().toLowerCase();
      const list = historySearchInput.closest('.panel');
      if(list){
        let any = false;
        list.querySelectorAll('.sale-row').forEach(r=>{
          const show = !q || r.textContent.toLowerCase().includes(q);
          r.style.display = show ? '' : 'none';
          if(show) any = true;
        });
        let empty = list.querySelector('.empty');
        if(!any && !empty){
          empty = document.createElement('div'); empty.className='empty'; empty.textContent='No sales match your search.'; list.appendChild(empty);
        } else if(empty && any){ empty.remove(); }
      }
    });
  }

  const ledgerSearchInput = document.getElementById('in-ledger-search');
  if(ledgerSearchInput){
    ledgerSearchInput.addEventListener('input', ()=>{
      state.ledgerSearch = ledgerSearchInput.value;
      const q = state.ledgerSearch.trim().toLowerCase();
      const list = ledgerSearchInput.closest('.panel');
      if(list){
        let any = false;
        list.querySelectorAll('.sale-row').forEach(r=>{
          const show = !q || r.textContent.toLowerCase().includes(q);
          r.style.display = show ? '' : 'none';
          if(show) any = true;
        });
        let empty = list.querySelector('.empty');
        if(!any && !empty){
          empty = document.createElement('div'); empty.className='empty'; empty.textContent='No ledger entries match your search.'; list.appendChild(empty);
        } else if(empty && any){ empty.remove(); }
      }
    });
  }

  /* monthly report */
  const rptMonth = document.getElementById('rpt-month');
  if(rptMonth) rptMonth.addEventListener('change', ()=>{ state.reportMonth = rptMonth.value || defaultReportMonth(); reloadReportTab(); });
  app.querySelectorAll('[data-rpt-month]').forEach(el=> el.addEventListener('click', ()=>{ state.reportMonth = el.dataset.rptMonth; reloadReportTab(); }));
  const rptPrev = document.getElementById('btn-rpt-prev');
  if(rptPrev) rptPrev.addEventListener('click', ()=> shiftReportMonth(-1));
  const rptNext = document.getElementById('btn-rpt-next');
  if(rptNext) rptNext.addEventListener('click', ()=> shiftReportMonth(1));
  const rptPrint = document.getElementById('btn-rpt-print');
  if(rptPrint) rptPrint.addEventListener('click', ()=> window.print());
  const expExcel = document.getElementById('btn-exp-excel');
  if(expExcel) expExcel.addEventListener('click', exportExpensesToExcel);
  const rptExcel = document.getElementById('btn-rpt-excel');
  if(rptExcel) rptExcel.addEventListener('click', exportReportToExcel);

  /* ledger */
  const lgDate = document.getElementById('lg-date');
  if(lgDate) lgDate.addEventListener('input', ()=>{ state.ledgerDraft.date = lgDate.value; });
  const lgQty = document.getElementById('lg-qty');
  if(lgQty) lgQty.addEventListener('input', ()=>{ state.ledgerDraft.qty = lgQty.value; });
  const lgDetails = document.getElementById('lg-details');
  if(lgDetails) lgDetails.addEventListener('input', ()=>{ state.ledgerDraft.details = lgDetails.value; });
  const lgPic = document.getElementById('lg-pic');
  if(lgPic) lgPic.addEventListener('input', ()=>{ state.ledgerDraft.pic = lgPic.value; });
  const lgIn = document.getElementById('lg-in');
  if(lgIn) lgIn.addEventListener('input', ()=>{ state.ledgerDraft.in = lgIn.value; });
  const lgOut = document.getElementById('lg-out');
  if(lgOut) lgOut.addEventListener('input', ()=>{ state.ledgerDraft.out = lgOut.value; });
  const lgDeposit = document.getElementById('lg-deposit');
  if(lgDeposit) lgDeposit.addEventListener('change', ()=>{ state.ledgerDraft.deposit = lgDeposit.checked; });
  const addLedgerBtn = document.getElementById('btn-add-ledger');
  if(addLedgerBtn) addLedgerBtn.addEventListener('click', addLedgerEntry);
}

async function init(){
  await loadConfig();
  if(state.supaUrl && state.supaKey) await restoreAuth();
  render();
}

document.addEventListener('click', ev=>{
  if(state.reportMenuOpen && !ev.target.closest('.nav-group')){ state.reportMenuOpen = false; render(); }
});
document.addEventListener('keydown', ev=>{ if(ev.key === 'Escape' && state.reportMenuOpen){ state.reportMenuOpen = false; render(); } });
document.addEventListener('keydown', ev=>{ if(ev.key === 'Escape' && state.themeOpen) setThemeOpen(false); });

// ===== Mobile Back button =====
// Back closes popups first, then returns to the previous tab, and only
// leaves the app when pressed twice on the main tab.
const navStack = [];
let lastBackAt = 0;
function pushGuard(){ try{ history.pushState({ccfaco:1}, ''); }catch(e){} }
function closeTopOverlay(){
  if(state.voidPrompt){ if(!state.voidPrompt.busy){ state.voidPrompt = null; render(); } return true; }
  if(state.pwPrompt){ state.pwPrompt = null; render(); return true; }
  if(state.freePrompt){ state.freePrompt = null; render(); return true; }
  if(state.themeOpen){ setThemeOpen(false); return true; }
  if(state.menuOpen){ state.menuOpen = false; render(); return true; }
  if(state.reportMenuOpen){ state.reportMenuOpen = false; render(); return true; }
  if(state.editingSaleItem){ state.editingSaleItem = null; render(); return true; }
  if(state.editingConsignItem){ state.editingConsignItem = null; render(); return true; }
  if(state.editingMember){ state.editingMember = null; render(); return true; }
  if(state.editing){ state.editing = null; render(); return true; }
  if(state.showProductLogs){ state.showProductLogs = false; render(); return true; }
  return false;
}
try{ history.replaceState({ccfaco:0}, ''); }catch(e){}
pushGuard();
window.addEventListener('popstate', ()=>{
  // We just landed on the base entry; decide what Back should do.
  if(Date.now() - lastBackAt < 2000 && lastBackAt){
    // second Back on the main tab -> really leave
    lastBackAt = 0;
    history.back();
    return;
  }
  if(closeTopOverlay()){ pushGuard(); return; }
  if(navStack.length){
    const prev = navStack.pop();
    switchTab(prev, true);
    pushGuard();
    return;
  }
  const home = isViewer() ? state.tab : 'pos';
  if(state.connected && state.tab !== home){
    switchTab(home, true);
    pushGuard();
    return;
  }
  lastBackAt = Date.now();
  showToast('Pindot ulit ang Back para lumabas');
  pushGuard();
});

init();

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
