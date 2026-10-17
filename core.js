const supabaseConfig = window.SUPABASE_CONFIG || {};
const state = {
  tab: 'pos',
  supaUrl: supabaseConfig.url || '',
  supaKey: supabaseConfig.anonKey || '',
  session: null,
  user: null,
  role: null,
  loginEmail: '',
  authError: '',
  authLoading: false,
  connected: false,
  products: [],
  cart: [], // {id, name, price, qty}
  sales: [],
  saleItems: [],
  loading: false,
  toast: null,
  tendered: '',
  checkingOut: false,
  editing: null,        // {id, name, price} product being edited
  restockQty: '',
  consignments: [],
  consignDraft: [],     // {product_id, name, price, qty}
  consignee: '',
  consignNote: '',
  consignPick: '',
  consignPickQty: '',
  settle: {},           // item_id -> {sold, returned}
  busy: false,
  menuOpen: false,
  members: [],
  editingMember: null,  // {id, full_name, phone} member being edited
  memberSearch: '',
  productSearch: '',
  posSearch: '',
  ledgerSearch: '',
  dailySearch: '',
  showProductLogs: false,
  productLogs: [],
  deductQty: '',
  consignSearch: '',
  productLogsLoading: false,
  userDraft: { name:'', role:'cashier', email:'', password:'' }, // Add-user form values, kept so a failed attempt does not wipe what was typed
  usersError: '',       // why the Current users list could not load (shown in Settings)
  usersLoading: false,
  pwPrompt: null,       // {cur, next, confirm, busy} while the Change password popup is open
  freeCol: false,       // true once sale_items has is_free + free_remarks columns (see Settings SQL)
  freePrompt: null,     // {id, qty, remarks} while the Freebie remarks popup is open
  discountCol: false,   // true once the products table has a discount column (see Settings SQL)
  saleMemberId: '',      // id of the member picked for THIS sale in the Sell tab; '' = walk-in, no discount
  consignMemberId: '',   // member picked when sending a consignment out; discount applies to it at settle time
  consignMemberCol: false, // true once the consignments table has a member_id column (see Settings SQL)
  appUsers: [],           // list of profiles rows, admin-only, for the Manage users section in Settings
  userBusy: false,        // true while adding a new user
  editingSaleItem: null,  // {id, product_name} sale_items row being name-corrected, Admin-only
  editingConsignItem: null, // {id, product_name} consignment_items row being name-corrected, Admin-only
  ledgerReady: false,     // true once the ledger_entries table exists (see Settings SQL)
  ledgerDepositCol: false, // true once ledger_entries has an is_deposit column (see Settings SQL)
  ledgerEntries: [],
  ledgerDraft: { date: '', qty: '', details: '', pic: '', in: '', out: '', deposit: false },
  themeOpen: false,       // true while the color theme popover is open
  reportMonth: '',        // 'YYYY-MM' picked in the Report tab
  reportSales: [],
  reportConsign: [],
  reportLoading: false,
  reportYearTotals: [],   // 12 monthly sales totals for the year of the picked month (Jan..Dec)
  expenseEntries: [],     // every ledger_entries row with amount_out > 0 (manual expenses), loaded for the Expenses report
  expenseLoading: false,
  salesYear: null,        // {year, months:[12 sales totals], days:{'M-D': total}} for the year of the picked month
  reportMenuOpen: false,  // true while the Report dropdown (Daily / Monthly / History) is open
  lastBackup: '',         // ISO time of the last backup downloaded from this device
  missingReady: false,   // true once the consignment_events table exists (see Settings SQL: Missing items)
  missInput: {},         // {item_id: {pay, found}} typed on a Missing consignment
  voidCol: false,         // true once sales / ledger_entries / consignments have the void columns (see Settings SQL)
  voidPrompt: null,       // {kind, id, label, reason, busy} while the Void reason popup is open (Admin-only)
};

function el(html){
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

function showToast(msg, isErr){
  state.toast = {msg, isErr};
  render();
  setTimeout(()=>{ state.toast = null; render(); }, 3200);
}

function localDateStr(d){
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function money(n){
  return '\u20B1' + Number(n).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
}

async function loadConfig(){
  try{
    const external = window.SUPABASE_CONFIG || {};
    if(external.url && external.anonKey){
      state.supaUrl = external.url;
      state.supaKey = external.anonKey;
    } else {
      const raw = localStorage.getItem('supabase-config');
      if(raw){
        const cfg = JSON.parse(raw);
        state.supaUrl = cfg.url || '';
        state.supaKey = cfg.key || '';
      }
    }
    const savedSession = sessionStorage.getItem('supa-session');
    if(savedSession) state.session = JSON.parse(savedSession);
  }catch(e){ /* no config or session yet */ }
}

async function saveConfig(){
  try{
    localStorage.setItem('supabase-config', JSON.stringify({url: state.supaUrl, key: state.supaKey}));
  }catch(e){ /* storage unavailable, config just won't persist */ }
}

async function saveSession(){
  try{
    if(state.session) sessionStorage.setItem('supa-session', JSON.stringify(state.session));
    else sessionStorage.removeItem('supa-session');
  }catch(e){ /* session storage unavailable */ }
}

function clearSession(){
  try{ sessionStorage.removeItem('supa-session'); }catch(e){ /* ignore */ }
}

function escapeHtml(value){
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;').replace(/'/g, '&#039;');
}

function supaHeaders(){
  return {
    'apikey': state.supaKey,
    'Authorization': 'Bearer ' + (state.session && state.session.access_token ? state.session.access_token : state.supaKey),
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
}

async function testConnection(){
  if(!state.supaUrl || !state.supaKey || !state.session || !state.session.access_token){ state.connected = false; return false; }
  try{
    const res = await fetch(state.supaUrl + '/rest/v1/products?select=id&limit=1', { headers: supaHeaders() });
    state.connected = res.ok;
    return state.connected;
  }catch(e){
    state.connected = false;
    return false;
  }
}

async function fetchCurrentUser(){
  const res = await fetch(state.supaUrl + '/auth/v1/user', { headers: supaHeaders() });
  if(!res.ok) throw new Error('Your Supabase session has expired. Please sign in again.');
  state.user = await res.json();
}

async function loadProfile(){
  if(!state.user || !state.user.id) throw new Error('Could not identify the signed-in user.');
  const res = await fetch(state.supaUrl + '/rest/v1/profiles?select=role,full_name&user_id=eq.' + encodeURIComponent(state.user.id), { headers: supaHeaders() });
  if(!res.ok) throw new Error('Could not load your role profile. Run the role setup SQL in your Supabase SQL Editor first.');
  const rows = await res.json();
  const profile = rows[0];
  if(!profile || (profile.role !== 'admin' && profile.role !== 'cashier' && profile.role !== 'viewer')){
    throw new Error('No valid role is assigned to this account. Add this account to the profiles table as admin, cashier, or viewer in your Supabase SQL Editor.');
  }
  state.role = profile.role;
}

async function restoreAuth(){
  if(!state.session || !state.session.access_token) return false;
  try{
    await fetchCurrentUser();
    await loadProfile();
    const ok = await testConnection();
    if(ok){ await checkDiscountColumn(); await checkFreeColumn(); await checkConsignMemberColumn(); await checkLedgerReady(); await checkLedgerDepositColumn(); await checkVoidColumn(); await checkMissingReady(); await fetchProducts(); await fetchMembers(); }
    return ok;
  }catch(e){
    clearSession();
    state.session = null;
    state.user = null;
    state.role = null;
    state.connected = false;
    return false;
  }
}

async function login(email, password){
  if(!email || !password){ state.authError = 'Enter your email and password.'; render(); return; }
  state.authLoading = true;
  state.authError = '';
  render();
  let welcome = '';
  try{
    const res = await fetch(state.supaUrl + '/auth/v1/token?grant_type=password', {
      method:'POST',
      headers:{ 'apikey': state.supaKey, 'Content-Type':'application/json' },
      body: JSON.stringify({ email, password })
    });
    const payload = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(payload.error_description || payload.msg || 'Sign in failed. Check your email and password.');
    state.session = payload;
    await saveSession();
    await fetchCurrentUser();
    await loadProfile();
    if(!await testConnection()) throw new Error('Signed in, but the POS tables could not be reached. Check your Supabase setup.');
    await checkDiscountColumn();
    await checkFreeColumn();
    await checkConsignMemberColumn();
    await checkLedgerReady();
    await checkLedgerDepositColumn();
    await checkVoidColumn(); await checkMissingReady();
    state.tab = 'pos';
    navStack.length = 0;
    await fetchProducts();
    await fetchMembers();
    welcome = 'Signed in as ' + roleLabel() + '.';
  }catch(e){
    clearSession();
    state.session = null;
    state.user = null;
    state.role = null;
    state.connected = false;
    state.authError = e.message || 'Sign in failed.';
  }finally{
    state.authLoading = false;
    render();
  }
  if(welcome) showToast(welcome);
}

function logout(){
  clearSession();
  state.session = null;
  state.user = null;
  state.role = null;
  state.connected = false;
  state.tab = 'pos';
  navStack.length = 0;
  state.cart = [];
  state.tendered = '';
  state.authError = '';
  state.members = [];
  state.editingMember = null;
  state.memberSearch = '';
  state.productSearch = '';
  state.posSearch = '';
  state.ledgerSearch = '';
  state.dailySearch = '';
  state.consignSearch = '';
  state.showProductLogs = false;
  state.productLogs = [];
  state.saleMemberId = '';
  state.consignMemberId = '';
  render();
}

function isAdmin(){ return state.role === 'admin'; }
function isViewer(){ return state.role === 'viewer'; }
function roleLabel(){ return isAdmin() ? 'Admin' : (isViewer() ? 'Regular' : 'Cashier'); }
function blockViewer(){
  if(isViewer()){ showToast('Regular users have view-only access.', true); return true; }
  return false;
}

function switchTab(tab, fromBack){
  if(tab === 'settings' && !isAdmin()){
    showToast('Settings is available to Admin only.', true);
    return;
  }
  if(tab === 'report' && !canSeeReport()){
    showToast('The report is available to Admin and Regular users only.', true);
    return;
  }
  if(!fromBack && tab !== state.tab){
    navStack.push(state.tab);
    if(navStack.length > 30) navStack.shift();
  }
  state.tab = tab;
  state.menuOpen = false;
  state.reportMenuOpen = false;
  render();
  if(tab === 'history') fetchSales();
  if(tab === 'items') fetchSaleItems();
  if(tab === 'consign') fetchConsignments();
  if(tab === 'ledger') fetchLedger();
  if(tab === 'report') fetchReport();
  if(tab === 'expenses') fetchExpenses();
  if(tab === 'members') fetchMembers();
  if(tab === 'settings') fetchAppUsers();
}
