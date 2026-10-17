async function fetchProducts(){
  if(!state.connected) return;
  state.loading = true; render();
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/products?select=*&order=name.asc`, { headers: supaHeaders() });
    if(!res.ok) throw new Error('Failed to load products');
    state.products = await res.json();
  }catch(e){
    showToast('Could not load products: ' + e.message, true);
  }
  state.loading = false; render();
}

async function fetchSales(){
  if(!state.connected) return;
  state.loading = true; render();
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/sales?select=*,sale_items(${saleItemCols()})&order=created_at.desc&limit=50`, { headers: supaHeaders() });
    if(!res.ok) throw new Error('Failed to load sales');
    state.sales = await res.json();
  }catch(e){
    showToast('Could not load sales: ' + e.message, true);
  }
  state.loading = false; render();
}

async function fetchSaleItems(){
  if(!state.connected) return;
  state.loading = true; render();
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/sale_items?select=*,sales(created_at${state.voidCol ? ',voided' : ''})&order=created_at.desc&limit=500`, { headers: supaHeaders() });
    if(!res.ok) throw new Error('Failed to load sale items');
    state.saleItems = (await res.json()).filter(it => !(it.sales && it.sales.voided)); // voided sales are left out of the Daily report
  }catch(e){
    showToast('Could not load sale items: ' + e.message, true);
  }
  state.loading = false; render();
}

// Corrects the product name saved on a past sale item. Admin-only: this fixes a
// typo baked in at checkout time, it does not touch the live Products table.
async function updateSaleItemName(id, name){
  if(!isAdmin()){ showToast('Only Admin can correct a sale item name.', true); return; }
  name = (name || '').trim();
  if(!name){ showToast('Enter a product name.', true); return; }
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/sale_items?id=eq.${id}`, {
      method:'PATCH', headers: supaHeaders(),
      body: JSON.stringify({ product_name: name })
    });
    if(!res.ok) throw new Error('Update failed');
    state.editingSaleItem = null;
    await fetchSaleItems();
    await fetchSales();
    showToast('Sale item name corrected.');
  }catch(e){
    showToast('Could not update sale item: ' + e.message, true);
  }
}

// Same fix as updateSaleItemName, but for a consignment_items row (product_name is
// snapshotted when the consignment is sent out — see sendConsignment above).
async function updateConsignItemName(id, name){
  if(!isAdmin()){ showToast('Only Admin can correct a consignment item name.', true); return; }
  name = (name || '').trim();
  if(!name){ showToast('Enter a product name.', true); return; }
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/consignment_items?id=eq.${id}`, {
      method:'PATCH', headers: supaHeaders(),
      body: JSON.stringify({ product_name: name })
    });
    if(!res.ok) throw new Error('Update failed');
    state.editingConsignItem = null;
    await fetchConsignments();
    showToast('Consignment item name corrected.');
  }catch(e){
    showToast('Could not update consignment item: ' + e.message, true);
  }
}

// Pulls the FULL sales history (not just the 50 shown on screen) and builds a
// downloadable .xlsx with a per-sale summary sheet and a per-product detail sheet.
// Pulls the FULL history from Supabase (not just what's shown on screen) and builds ONE
// downloadable .xlsx with everything: Sales, Sale Items, Consignments, and Consignment Items.
// Reads EVERY row of a table (Supabase returns at most 1000 rows per request, so page through it).
async function fetchAllRows(table, query){
  const PAGE = 1000, all = [];
  for(let off = 0; ; off += PAGE){
    const res = await fetch(`${state.supaUrl}/rest/v1/${table}?${query}&limit=${PAGE}&offset=${off}`, { headers: supaHeaders() });
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      throw new Error(e.message || ('HTTP ' + res.status));
    }
    const batch = await res.json();
    all.push(...batch);
    if(batch.length < PAGE) break;
  }
  return all;
}

// Full backup (Admin only): one .xlsx with a sheet for every table.
async function backupToExcel(){
  if(!state.connected) return;
  if(!isAdmin()){ showToast('Admin lang ang puwedeng mag-backup.', true); return; }
  const btn = document.getElementById('btn-backup');
  if(btn){ btn.disabled = true; btn.textContent = 'Gumagawa ng backup...'; }
  try{
    const plan = [
      ['Products', 'products', 'select=*&order=id.asc'],
      ['Members', 'members', 'select=*&order=id.asc'],
      ['Sales', 'sales', 'select=*&order=id.asc'],
      ['Sale Items', 'sale_items', 'select=*&order=id.asc'],
      ['Consignments', 'consignments', 'select=*&order=id.asc'],
      ['Consignment Items', 'consignment_items', 'select=*&order=id.asc'],
      ['Ledger', 'ledger_entries', 'select=*&order=id.asc'],
      ['Product Logs', 'product_logs', 'select=*&order=id.asc'],
      ['Users', 'profiles', 'select=*']
    ];
    const flat = rows => rows.map(r => {
      const o = {};
      Object.keys(r).forEach(k => { const v = r[k]; o[k] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : v; });
      return o;
    });
    const wb = XLSX.utils.book_new();
    const summary = [];
    const stamp = new Date();
    const sheets = [];
    for(const [label, table, q] of plan){
      try{
        const rows = await fetchAllRows(table, q);
        summary.push({ Sheet: label, Rows: rows.length, Status: 'OK' });
        sheets.push([label, sheetOrEmpty(flat(rows), 'Walang laman')]);
      }catch(e){
        summary.push({ Sheet: label, Rows: 0, Status: 'Skipped: ' + e.message });
      }
    }
    summary.unshift({ Sheet: 'Backup made', Rows: '', Status: stamp.toLocaleString() });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');
    sheets.forEach(([label, ws]) => XLSX.utils.book_append_sheet(wb, ws, label));
    const y = stamp.getFullYear(), m = String(stamp.getMonth()+1).padStart(2,'0'), d = String(stamp.getDate()).padStart(2,'0');
    XLSX.writeFile(wb, `CCFACO-Backup-${y}-${m}-${d}.xlsx`);
    try{ localStorage.setItem('ccfaco_last_backup', stamp.toISOString()); }catch(e){}
    const failed = summary.filter(x => /^Skipped/.test(x.Status)).length;
    state.lastBackup = stamp.toISOString();
    showToast(failed ? 'Backup downloaded (may na-skip na ' + failed + ' table — tingnan ang Summary sheet).' : 'Backup downloaded.');
  }catch(e){
    showToast('Backup failed: ' + e.message, true);
  }
  if(btn){ btn.disabled = false; btn.textContent = 'Download backup (Excel)'; }
}

function lastBackupText(){
  let iso = state.lastBackup;
  if(!iso){ try{ iso = localStorage.getItem('ccfaco_last_backup'); }catch(e){} }
  if(!iso) return 'Wala pang backup sa device na ito.';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  return 'Huling backup (sa device na ito): ' + d.toLocaleDateString() + (days > 0 ? ' — ' + days + ' araw na ang nakalipas' : ' — ngayon');
}

function sheetOrEmpty(rows, emptyNote){
  return XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: emptyNote }]);
}
async function exportHistoryToExcel(){
  if(!state.connected) return;
  const btn = document.getElementById('btn-export-excel');
  if(btn){ btn.disabled = true; btn.textContent = 'Exporting...'; }
  try{
    const [sales, consignments] = await Promise.all([
      fetchAllRows('sales', `select=*,sale_items(${saleItemCols()})&order=created_at.desc,id.asc`),
      fetchAllRows('consignments', 'select=*,consignment_items(*)&order=created_at.desc,id.asc')
    ]);
    if(sales.length === 0 && consignments.length === 0){ showToast('Wala pang data na i-eexport.', true); return; }

    const voidedSales = sales.filter(s => s.voided);
    const liveSales = sales.filter(s => !s.voided);
    const salesSummary = liveSales.map(s => {
      const d = new Date(s.created_at);
      const items = (s.sale_items || []).map(i => `${i.qty}x ${i.product_name}${i.is_free ? ' (FREE' + (i.free_remarks ? ': ' + i.free_remarks : '') + ')' : ''}`).join(', ');
      return { Date: d.toLocaleDateString(), Time: d.toLocaleTimeString(), Items: items, Total: Number(s.total) };
    });

    const saleItemRows = [];
    liveSales.forEach(s => {
      const d = new Date(s.created_at);
      (s.sale_items || []).forEach(i => {
        saleItemRows.push({
          Date: d.toLocaleDateString(), Time: d.toLocaleTimeString(),
          Product: i.product_name, Qty: i.qty,
          'Unit Price': Number(i.price), Subtotal: Number(i.price) * Number(i.qty),
          Type: i.is_free ? 'FREE' : 'Sale', Remarks: i.free_remarks || ''
        });
      });
    });

    const consignSummary = consignments.map(c => {
      const d = new Date(c.created_at);
      const items = c.consignment_items || [];
      const member = c.member_id ? state.members.find(m=>m.id===c.member_id) : null;
      const sent = items.reduce((s,i)=> s + (i.qty_sent||0), 0);
      const sold = items.reduce((s,i)=> s + (i.qty_sold||0), 0);
      const returned = items.reduce((s,i)=> s + (i.qty_returned||0), 0);
      const soldValue = items.reduce((s,i)=> s + consignUnitPrice(i, c)*(i.qty_sold||0), 0);
      return {
        'Date Sent': d.toLocaleDateString(), Time: d.toLocaleTimeString(),
        Consignee: c.consignee, Member: member ? member.full_name : '',
        Status: c.voided ? 'Voided' : (c.status === 'closed' ? (consignMissingQty(c) > 0 ? 'Missing' : 'Settled') : 'Out'),
        'Qty Sent': sent, 'Qty Sold': sold, 'Qty Returned': returned,
        'Sold Value': soldValue, Note: c.note || ''
      };
    });

    const consignItemRows = [];
    consignments.forEach(c => {
      const d = new Date(c.created_at);
      const member = c.member_id ? state.members.find(m=>m.id===c.member_id) : null;
      (c.consignment_items || []).forEach(i => {
        consignItemRows.push({
          'Date Sent': d.toLocaleDateString(), Time: d.toLocaleTimeString(),
          Consignee: c.consignee, Member: member ? member.full_name : '',
          Product: i.product_name, 'Qty Sent': i.qty_sent, Price: Number(i.price),
          'Qty Sold': i.qty_sold||0, 'Qty Returned': i.qty_returned||0,
          'Sold Value': consignUnitPrice(i, c) * (i.qty_sold||0),
          Status: c.voided ? 'Voided' : (c.status === 'closed' ? (consignMissingQty(c) > 0 ? 'Missing' : 'Settled') : 'Out')
        });
      });
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetOrEmpty(salesSummary, 'No sales yet'), 'Sales Summary');
    XLSX.utils.book_append_sheet(wb, sheetOrEmpty(saleItemRows, 'No sale items yet'), 'Sale Items');
    XLSX.utils.book_append_sheet(wb, sheetOrEmpty(consignSummary, 'No consignments yet'), 'Consignments');
    XLSX.utils.book_append_sheet(wb, sheetOrEmpty(consignItemRows, 'No consignment items yet'), 'Consignment Items');
    if(voidedSales.length){
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(voidedSales.map(s => {
        const d = new Date(s.created_at);
        return { Date: d.toLocaleDateString(), Time: d.toLocaleTimeString(),
          Items: (s.sale_items || []).map(i => `${i.qty}x ${i.product_name}`).join(', '), Total: Number(s.total),
          'Void Reason': s.void_reason || '', 'Voided By': s.voided_by || '', 'Voided At': s.voided_at ? new Date(s.voided_at).toLocaleString() : '' };
      })), 'Voided Sales');
    }
    XLSX.writeFile(wb, `CCFACO-Reports-${localDateStr()}.xlsx`);
    showToast('Excel report downloaded.');
  }catch(e){
    showToast('Could not export: ' + e.message, true);
  }
  if(btn){ btn.disabled = false; btn.textContent = 'Export to Excel'; }
}

async function addProduct(name, price, stock, discount){
  if(blockViewer()) return;
  const row = { name, price: Number(price), stock: Number(stock) };
  if(state.discountCol && Number(discount) > 0) row.discount = Number(discount);
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/products`, {
      method:'POST', headers: supaHeaders(),
      body: JSON.stringify([row])
    });
    if(!res.ok) throw new Error('Insert failed');
    const discTxt = (state.discountCol && Number(discount) > 0) ? `, discount ${money(Number(discount))}` : '';
    await logProductAction('add', null, name, `new product: "${name}", price ${money(Number(price))}, stock ${Number(stock)}${discTxt}`);
    await fetchProducts();
    showToast('Product added.');
  }catch(e){
    showToast('Could not add product: ' + e.message, true);
  }
}

async function deleteProduct(id){
  if(blockViewer()) return;
  if(!isAdmin()){ showToast('Only Admin can delete products.', true); return; }
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/products?id=eq.${id}`, {
      method:'DELETE', headers: supaHeaders()
    });
    if(!res.ok) throw new Error('Delete failed');
    const prod = state.products.find(p=>p.id===id);
    await logProductAction('delete', id, prod ? prod.name : '(product)', `deleted product${prod ? ': "' + prod.name + '" (had ' + (prod.stock||0) + ' in stock, price ' + money(prod.price) + ')' : ''}`);
    state.products = state.products.filter(p=>p.id!==id);
    render();
  }catch(e){
    showToast('Could not delete product: ' + e.message, true);
  }
}

// Detect once whether the products table has a discount column (see Settings SQL)
async function checkDiscountColumn(){
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/products?select=discount&limit=1`, { headers: supaHeaders() });
    state.discountCol = res.ok;
  }catch(e){
    state.discountCol = false;
  }
}

// Detect once whether sale_items has the Freebie columns (see Settings SQL)
async function checkFreeColumn(){
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/sale_items?select=is_free,free_remarks&limit=1`, { headers: supaHeaders() });
    state.freeCol = res.ok;
  }catch(e){
    state.freeCol = false;
  }
}
function saleItemCols(){ return 'product_name,price,qty' + (state.freeCol ? ',is_free,free_remarks' : ''); }
function saleItemLabel(i){
  return `${i.qty}\u00D7 ${i.product_name}` + (i.is_free ? ' \uD83C\uDF81FREE' + (i.free_remarks ? ' (' + escapeHtml(i.free_remarks) + ')' : '') : '');
}

// Detect once whether the consignments table has a member_id column (see Settings SQL)
async function checkConsignMemberColumn(){
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/consignments?select=member_id&limit=1`, { headers: supaHeaders() });
    state.consignMemberCol = res.ok;
  }catch(e){
    state.consignMemberCol = false;
  }
}

// Detect once whether the ledger_entries table exists (see Settings SQL)
async function checkLedgerReady(){
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/ledger_entries?select=id&limit=1`, { headers: supaHeaders() });
    state.ledgerReady = res.ok;
  }catch(e){
    state.ledgerReady = false;
  }
}

// Detect once whether the ledger_entries table has an is_deposit column (see Settings SQL)
async function checkLedgerDepositColumn(){
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/ledger_entries?select=is_deposit&limit=1`, { headers: supaHeaders() });
    state.ledgerDepositCol = res.ok;
  }catch(e){
    state.ledgerDepositCol = false;
  }
}
