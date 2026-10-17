let freeSeq = 0;
function addToCart(product){
  if(blockViewer()) return;
  const existing = state.cart.find(c=>c.id===product.id && !c.free);
  if(existing){ existing.qty += 1; }
  else{ state.cart.push({ key: product.id, id: product.id, name: product.name, price: product.price, qty: 1 }); }
  render();
}

// Freebie line: price is always zero, and a remarks note (what it is for / who it is given to) is required
function addFreeToCart(product, qty, remarks){
  if(blockViewer()) return;
  const existing = state.cart.find(c=>c.id===product.id && c.free && (c.remarks||'').toLowerCase() === remarks.toLowerCase());
  if(existing){ existing.qty += qty; }
  else{ state.cart.push({ key: 'free-' + (++freeSeq), id: product.id, name: product.name, price: 0, qty, free: true, remarks }); }
}

function openFreePrompt(productId){
  if(blockViewer()) return;
  if(!state.freeCol){
    showToast(isAdmin() ? 'I-run muna ang "Freebies" SQL sa Settings tab.' : 'Hindi pa naka-set up ang Freebies. Sabihan ang Admin.', true);
    return;
  }
  state.freePrompt = { id: productId, qty: '1', remarks: '', focus: true };
  render();
}

function confirmFreePrompt(){
  const fp = state.freePrompt;
  if(!fp) return;
  const prod = state.products.find(p=>p.id===fp.id);
  const qty = Math.floor(Number(fp.qty));
  const remarks = (fp.remarks || '').trim();
  if(!prod){ state.freePrompt = null; render(); return; }
  if(!qty || qty < 1){ showToast('Ilagay kung ilan ang ibibigay.', true); return; }
  if(remarks.length < 3){ showToast('Lagyan ng remarks kung para saan o kanino ibibigay.', true); return; }
  addFreeToCart(prod, qty, remarks);
  state.freePrompt = null;
  render();
}

function changeQty(id, delta){
  const item = state.cart.find(c=>c.key===id);
  if(!item) return;
  item.qty = (Number(item.qty)||0) + delta;
  if(item.qty <= 0){ state.cart = state.cart.filter(c=>c.key!==id); }
  if(state.cart.length === 0){ state.tendered = ''; }
  render();
}

// Typed quantity: update numbers live without re-rendering (keeps focus in the input)
function setCartQty(id, raw){
  const item = state.cart.find(c=>c.key===id);
  if(!item) return;
  const n = Math.floor(Number(raw));
  item.qty = (raw === '' || isNaN(n) || n < 0) ? 0 : n;
  updateCartDisplay();
}

function commitCartQty(id){
  const item = state.cart.find(c=>c.key===id);
  if(!item) return;
  if(!item.qty || item.qty <= 0){ state.cart = state.cart.filter(c=>c.key!==id); }
  if(state.cart.length === 0){ state.tendered = ''; }
  render();
}

function updateCartDisplay(){
  for(const c of state.cart){
    const lineEl = document.querySelector(`[data-line="${c.key}"]`);
    if(lineEl) lineEl.textContent = money(lineTotal(c));
  }
  const totalEl = document.getElementById('cart-total-amt');
  if(totalEl) totalEl.textContent = money(cartTotal());
  updateChangeDisplay();
}

// Fixed discount per product: peso amount off per piece, assigned in the Products tab
function productDiscount(productId){
  const p = state.products.find(x=>x.id===productId);
  const n = p ? Number(p.discount) : 0;
  const base = p ? (Number(p.price) || 0) : 0;
  return (isNaN(n) || n <= 0) ? 0 : Math.min(n, base);
}

// the member price for a product, regardless of whether a sale is in progress — used for informational display (Products tab)
function memberPriceOf(p){
  return Math.round((p.price - productDiscount(p.id)) * 100) / 100;
}

// price per piece actually charged for a consignment item — the discount only applies if the consignment is tagged to a Member
function consignUnitPrice(item, consignment){
  if(!consignment.member_id) return item.price;
  return Math.round(Math.max(0, item.price - productDiscount(item.product_id)) * 100) / 100;
}

// price per piece actually charged in the cart — the discount only applies when a member is picked for this sale
function discountedUnitPrice(c){
  if(c.free) return 0;
  if(!state.saleMemberId) return c.price;
  return memberPriceOf(c);
}

function lineTotal(c){
  return discountedUnitPrice(c) * (Number(c.qty)||0);
}

function cartTotal(){
  return state.cart.reduce((sum,c)=> sum + lineTotal(c), 0);
}

function updateChangeDisplay(){
  const total = cartTotal();
  const tenderedNum = Number(state.tendered) || 0;
  const change = tenderedNum - total;
  const tenderedEntered = state.tendered !== '';
  const insufficientAmount = total > 0 && (!tenderedEntered || tenderedNum < total);

  const changeEl = document.getElementById('change-amount');
  if(changeEl){
    changeEl.textContent = money(Math.max(change,0));
    changeEl.style.color = change < 0 ? 'var(--red)' : 'var(--green)';
  }
  const msgEl = document.getElementById('insufficient-msg');
  if(msgEl){
    msgEl.textContent = insufficientAmount ? (!tenderedEntered ? 'Enter the amount received before completing the sale.' : 'Amount received is less than the total.') : '';
  }
  const btn = document.getElementById('btn-checkout');
  if(btn){
    btn.disabled = insufficientAmount || state.checkingOut || state.cart.length===0;
  }
}

async function checkout(){
  if(blockViewer()) return;
  if(state.cart.length===0) return;
  if(state.checkingOut) return; // prevent double-submit from fast/repeated taps
  const total = cartTotal();
  const tenderedNum = Number(state.tendered) || 0;
  if(total > 0 && (state.tendered === '' || tenderedNum < total)){
    showToast('Enter a valid amount received (must cover the total).', true);
    return;
  }
  if(state.cart.some(c=>c.free) && !state.freeCol){
    showToast('I-run muna ang "Freebies" SQL sa Settings tab.', true);
    return;
  }
  state.checkingOut = true;
  render();
  try{
    const saleRes = await fetch(`${state.supaUrl}/rest/v1/sales`, {
      method:'POST', headers: supaHeaders(),
      body: JSON.stringify([{ total }])
    });
    if(!saleRes.ok) throw new Error('Checkout failed');
    const saleRows = await saleRes.json();
    const saleId = saleRows[0].id;

    const itemRows = state.cart.map(c => ({
      sale_id: saleId,
      product_id: c.id,
      product_name: c.name,
      price: discountedUnitPrice(c),
      qty: c.qty,
      ...(state.freeCol ? { is_free: !!c.free, free_remarks: c.free ? c.remarks : null } : {})
    }));
    const itemsRes = await fetch(`${state.supaUrl}/rest/v1/sale_items`, {
      method:'POST', headers: supaHeaders(),
      body: JSON.stringify(itemRows)
    });
    if(!itemsRes.ok) throw new Error('Failed to record sale items');

    // a product can be on two lines (paid + freebie), so add the quantities up before deducting stock
    const usedQty = {};
    for(const c of state.cart){ usedQty[c.id] = (usedQty[c.id] || 0) + (Number(c.qty) || 0); }
    for(const pid of Object.keys(usedQty)){
      const prod = state.products.find(p=>String(p.id)===pid);
      if(prod){
        const newStock = Math.max(0, (prod.stock||0) - usedQty[pid]);
        await fetch(`${state.supaUrl}/rest/v1/products?id=eq.${pid}`, {
          method:'PATCH', headers: supaHeaders(),
          body: JSON.stringify({ stock: newStock })
        });
      }
    }
    state.cart = [];
    state.tendered = '';
    state.saleMemberId = '';
    await fetchProducts();
    const itemsSummary = itemRows.map(r => `${r.qty}x ${r.product_name}${r.is_free ? ' (FREE)' : ''}`).join(', ');
    if(total > 0) await postSaleToLedger(saleId, total, itemsSummary); // all-free sales have nothing to put in the cash ledger
    if(state.tab === 'ledger') await fetchLedger();
    showToast(total > 0 ? 'Sale recorded — ' + money(total) : 'Freebie recorded — ' + money(0));
  }catch(e){
    showToast('Checkout failed: ' + e.message, true);
  }
  state.checkingOut = false;
  render();
}
