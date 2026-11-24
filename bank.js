/* ---------- Bank accounts (description + amount only, NO bank name / account number) ----------
   3 accounts: Sales, Share Capital, Reserve Fund.
   - Sales: gumagalaw AUTOMATIC kapag may Cash Deposit (dagdag) o Cash Transfer (bawas) sa Ledger.
   - Share Capital at Reserve Fund: MANUAL lang (Dagdag/Bawas o Itakda ang balance), Admin lang, may remarks.
   - Bawat galaw ay may History row. Admin lang ang may Bank tab at History; ang mga member ay
     nakakakita ng description + amount sa Member Profile (read-only).
   Needs the Bank SQL (bank_accounts, bank_account_history, bank_add, bank_set_amount, ledger trigger). */

Object.assign(state, {
  bankReady: false,      // true once bank_accounts can be read
  bankAccounts: [],
  bankHistory: [],
  bankSel: '',           // account id whose history is shown
  bankPanel: null,       // { id, mode: 'add' | 'set', amount: '', remarks: '' }
  bankBusy: false,
  bankError: ''
});

const BANK_ORDER = ['sales', 'share_capital', 'reserve_fund', 'other'];
const BANK_LABEL = { sales: 'Sales', share_capital: 'Share Capital', reserve_fund: 'Reserve Fund', other: 'Iba pa' };
const BANK_KIND_LABEL = { deposit: 'Cash Deposit (Ledger)', transfer: 'Cash Transfer (Ledger)', manual: 'Manual', adjust: 'Itinakda', void: 'Void (Ledger)' };

function bankById(id){ return state.bankAccounts.find(a => a.id === id); }
function bankNum(v){ return Number(String(v === undefined || v === null ? '' : v).replace(/,/g, '').trim()); }
function bankDateLabel(d){
  if(!d) return '';
  const dt = new Date(d + (String(d).length === 10 ? 'T00:00:00' : ''));
  return isNaN(dt) ? String(d) : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

async function bankErrText(res){
  try{
    const j = await res.json();
    return j.message || j.hint || j.details || ('Error ' + res.status);
  }catch(e){ return 'Error ' + res.status; }
}

async function fetchBankHistory(doRender){
  if(!state.bankSel || !isAdmin()) { state.bankHistory = []; return; }
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/bank_account_history?select=*&account_id=eq.${encodeURIComponent(state.bankSel)}&order=created_at.desc&limit=200`, { headers: supaHeaders() });
    if(res.ok) state.bankHistory = await res.json();
  }catch(e){ /* history just stays as it was */ }
  if(doRender) render();
}

async function loadBankData(){
  if(!state.connected) return;
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/bank_accounts?select=*&is_active=eq.true&order=created_at.asc`, { headers: supaHeaders() });
    if(!res.ok){
      state.bankReady = false;
      state.bankError = 'Hindi mabasa ang bank_accounts. I-run muna ang Bank SQL sa Supabase. (' + await bankErrText(res) + ')';
    } else {
      const rows = await res.json();
      rows.sort((a, b) => BANK_ORDER.indexOf(a.purpose) - BANK_ORDER.indexOf(b.purpose));
      state.bankAccounts = rows;
      state.bankReady = true;
      state.bankError = '';
      if(!bankById(state.bankSel)) state.bankSel = rows.length ? rows[0].id : '';
      if(isAdmin()) await fetchBankHistory(false);
    }
  }catch(e){
    state.bankReady = false;
    state.bankError = 'Could not load bank accounts: ' + (e.message || e);
  }
  render();
}

/* ----- Admin: Bank tab ----- */
function renderBank(){
  if(!state.bankReady){
    return '<div class="panel"><h2>Bank</h2><div class="setup-note">' + escapeHtml(state.bankError || 'Loading...') + '</div></div>';
  }
  if(!isAdmin()) return renderBankReadOnly();
  const total = state.bankAccounts.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const cards = state.bankAccounts.map(a => {
    const sel = a.id === state.bankSel;
    const auto = a.purpose === 'sales' ? '<span class="tag open">Auto galing Ledger</span>' : '<span class="tag">Manual lang</span>';
    return '<div class="product-row" style="display:block; cursor:default;' + (sel ? ' border-color:var(--gold);' : '') + '">' +
      '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">' +
        '<div><div class="name">' + escapeHtml(BANK_LABEL[a.purpose] || a.purpose) + '</div>' +
        '<div class="meta">' + escapeHtml(a.description) + ' &middot; as of ' + escapeHtml(bankDateLabel(a.as_of)) + '</div>' +
        '<div style="margin-top:6px;">' + auto + '</div></div>' +
        '<div class="price">' + money(a.amount) + '</div>' +
      '</div>' +
      '<div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">' +
        '<button class="ghost" data-bank-add="' + a.id + '">\u00B1 Dagdag / Bawas</button>' +
        '<button class="ghost" data-bank-set="' + a.id + '">Itakda ang balance</button>' +
        '<button class="ghost" data-bank-hist="' + a.id + '">' + (sel ? '\u2713 ' : '') + 'History</button>' +
      '</div>' +
    '</div>';
  }).join('');

  const p = state.bankPanel;
  let panel = '';
  if(p){
    const acc = bankById(p.id);
    if(acc){
      if(p.mode === 'add'){
        panel = '<div class="panel" style="margin-top:14px;"><h2>Dagdag / Bawas: ' + escapeHtml(BANK_LABEL[acc.purpose] || acc.purpose) + '</h2>' +
          '<div class="setup-note" style="margin-bottom:10px;">Ilagay ang halaga (positibo lang), tapos pindutin kung Dagdag o Bawas. Kailangan ng remarks.</div>' +
          '<div class="field"><label>Halaga</label><input id="bk-amt" inputmode="decimal" placeholder="0.00" value="' + escapeHtml(p.amount) + '" autocomplete="off"></div>' +
          '<div class="field"><label>Remarks (kailangan)</label><input id="bk-rem" placeholder="hal. Bayad ng share ni Juan" value="' + escapeHtml(p.remarks) + '" autocomplete="off"></div>' +
          '<div style="display:flex; gap:8px; margin-top:10px;">' +
            '<button class="primary" id="bk-plus" style="flex:1; margin-top:0;" ' + (state.bankBusy ? 'disabled' : '') + '>\u2795 Dagdag</button>' +
            '<button class="primary" id="bk-minus" style="flex:1; margin-top:0;" ' + (state.bankBusy ? 'disabled' : '') + '>\u2796 Bawas</button>' +
            '<button class="ghost" id="bk-cancel" style="flex:1;" ' + (state.bankBusy ? 'disabled' : '') + '>Cancel</button>' +
          '</div></div>';
      } else {
        panel = '<div class="panel" style="margin-top:14px;"><h2>Itakda ang balance: ' + escapeHtml(BANK_LABEL[acc.purpose] || acc.purpose) + '</h2>' +
          '<div class="setup-note" style="margin-bottom:10px;">Ngayon: <b>' + money(acc.amount) + '</b>. Gamitin ito sa opening balance o para itugma sa bank. Ilalagay sa History ang luma at bagong halaga.</div>' +
          '<div class="field"><label>Bagong balance</label><input id="bk-amt" inputmode="decimal" placeholder="0.00" value="' + escapeHtml(p.amount) + '" autocomplete="off"></div>' +
          '<div class="field"><label>Remarks (kailangan)</label><input id="bk-rem" placeholder="hal. Opening balance" value="' + escapeHtml(p.remarks) + '" autocomplete="off"></div>' +
          '<div style="display:flex; gap:8px; margin-top:10px;">' +
            '<button class="primary" id="bk-set-go" style="flex:1; margin-top:0;" ' + (state.bankBusy ? 'disabled' : '') + '>' + (state.bankBusy ? 'Saving...' : 'Itakda') + '</button>' +
            '<button class="ghost" id="bk-cancel" style="flex:1;" ' + (state.bankBusy ? 'disabled' : '') + '>Cancel</button>' +
          '</div></div>';
      }
    }
  }

  const histAcc = bankById(state.bankSel);
  const histRows = state.bankHistory.length ? state.bankHistory.map(h => {
    const ch = Number(h.change) || 0;
    const when = h.created_at ? new Date(h.created_at).toLocaleString() : '';
    return '<div class="product-row" style="display:block; cursor:default;">' +
      '<div style="display:flex; justify-content:space-between; gap:10px;">' +
        '<div><div class="meta" style="margin:0;">' + escapeHtml(when) + '</div>' +
        '<div style="margin-top:4px;"><span class="tag' + (h.kind === 'void' ? ' void' : '') + '">' + escapeHtml(BANK_KIND_LABEL[h.kind] || h.kind) + '</span></div>' +
        (h.remarks ? '<div class="meta">' + escapeHtml(h.remarks) + '</div>' : '') + '</div>' +
        '<div style="text-align:right;"><div style="font-weight:700; color:' + (ch >= 0 ? 'var(--green)' : 'var(--red)') + ';">' + (ch >= 0 ? '+' : '\u2212') + money(Math.abs(ch)) + '</div>' +
        '<div class="meta">Balance: ' + money(h.balance_after) + '</div></div>' +
      '</div></div>';
  }).join('') : '<div class="setup-note">Wala pang galaw sa account na ito.</div>';

  return '<div class="grid"><div class="panel">' +
      '<h2>Bank accounts ng Coop</h2>' +
      '<div class="setup-note" style="margin-bottom:12px;">Description at amount lang ang nakatala dito (walang bank name o account number). Ang Sales account ay awtomatikong gumagalaw sa Cash Deposit (dagdag) at Cash Transfer (bawas) sa Ledger. Ang Share Capital at Reserve Fund ay manual.</div>' +
      '<div class="product-list">' + cards + '</div>' +
      '<div style="display:flex; justify-content:space-between; margin-top:12px; font-weight:700; font-size:17px;"><span>Kabuuan</span><span class="price">' + money(total) + '</span></div>' +
      panel +
    '</div><div class="panel">' +
      '<h2>History' + (histAcc ? ': ' + escapeHtml(BANK_LABEL[histAcc.purpose] || histAcc.purpose) : '') + '</h2>' +
      '<div class="product-list">' + histRows + '</div>' +
    '</div></div>';
}

/* ----- Members / viewers: read-only Bank tab (description + amount, walang History) ----- */
function renderBankReadOnly(){
  if(!state.bankAccounts.length) return '<div class="panel"><h2>Bank</h2><div class="setup-note">Wala pang naka-set na account.</div></div>';
  const total = state.bankAccounts.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const rows = state.bankAccounts.map(a =>
    '<div class="product-row" style="display:block; cursor:default;"><div style="display:flex; justify-content:space-between; gap:10px;">' +
      '<div><div class="name">' + escapeHtml(BANK_LABEL[a.purpose] || a.purpose) + '</div>' +
      '<div class="meta">' + escapeHtml(a.description) + ' &middot; as of ' + escapeHtml(bankDateLabel(a.as_of)) + '</div></div>' +
      '<div class="price">' + money(a.amount) + '</div>' +
    '</div></div>'
  ).join('');
  return '<div class="panel"><h2>Bank accounts ng Coop</h2><div class="product-list">' + rows + '</div>' +
    '<div style="display:flex; justify-content:space-between; margin-top:12px; font-weight:700; font-size:17px;"><span>Kabuuan</span><span class="price">' + money(total) + '</span></div></div>';
}

/* ----- events ----- */
async function bankRpc(fn, body, okMsg){
  if(state.bankBusy) return;
  state.bankBusy = true; render();
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/rpc/${fn}`, { method: 'POST', headers: supaHeaders(), body: JSON.stringify(body) });
    if(!res.ok) throw new Error(await bankErrText(res));
    state.bankPanel = null;
    state.bankBusy = false;
    await loadBankData();
    showToast(okMsg);
  }catch(e){
    state.bankBusy = false;
    render();
    showToast('Hindi nai-save: ' + (e.message || e), true);
  }
}

function bankSubmitAdd(sign){
  const p = state.bankPanel;
  if(!p) return;
  const amt = Math.round(bankNum(p.amount) * 100) / 100;
  if(!(amt > 0) || amt > 999999999999){ showToast('Ilagay ang tamang halaga (mas malaki sa 0).', true); return; }
  if(!(p.remarks || '').trim()){ showToast('Kailangan ang remarks.', true); return; }
  bankRpc('bank_add', { p_account: p.id, p_change: sign * amt, p_remarks: p.remarks.trim() }, sign > 0 ? 'Naidagdag.' : 'Nabawas.');
}

function bankSubmitSet(){
  const p = state.bankPanel;
  if(!p) return;
  const amt = Math.round(bankNum(p.amount) * 100) / 100;
  if(p.amount === '' || !isFinite(amt) || amt < 0 || amt > 999999999999){ showToast('Ilagay ang tamang balance (0 pataas).', true); return; }
  if(!(p.remarks || '').trim()){ showToast('Kailangan ang remarks.', true); return; }
  bankRpc('bank_set_amount', { p_account: p.id, p_new: amt, p_remarks: p.remarks.trim() }, 'Naitakda ang balance.');
}

function bindBank(app){
  if(state.tab !== 'bank' || !isAdmin()) return;
  app.querySelectorAll('[data-bank-add]').forEach(b => b.addEventListener('click', () => {
    state.bankPanel = { id: b.dataset.bankAdd, mode: 'add', amount: '', remarks: '' }; render();
  }));
  app.querySelectorAll('[data-bank-set]').forEach(b => b.addEventListener('click', () => {
    state.bankPanel = { id: b.dataset.bankSet, mode: 'set', amount: '', remarks: '' }; render();
  }));
  app.querySelectorAll('[data-bank-hist]').forEach(b => b.addEventListener('click', async () => {
    state.bankSel = b.dataset.bankHist;
    await fetchBankHistory(false);
    render();
  }));
  const amt = document.getElementById('bk-amt');
  if(amt) amt.addEventListener('input', () => { if(state.bankPanel) state.bankPanel.amount = amt.value; });
  const rem = document.getElementById('bk-rem');
  if(rem) rem.addEventListener('input', () => { if(state.bankPanel) state.bankPanel.remarks = rem.value; });
  const plus = document.getElementById('bk-plus');
  if(plus) plus.addEventListener('click', () => bankSubmitAdd(1));
  const minus = document.getElementById('bk-minus');
  if(minus) minus.addEventListener('click', () => bankSubmitAdd(-1));
  const go = document.getElementById('bk-set-go');
  if(go) go.addEventListener('click', bankSubmitSet);
  const cancel = document.getElementById('bk-cancel');
  if(cancel) cancel.addEventListener('click', () => { state.bankPanel = null; render(); });
}
