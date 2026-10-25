/* ---------- Member profile (contributions + fund balances) ----------
   - A "Regular" login account can be linked to ONE member (Members tab -> tap a member -> "Login account").
   - When that account opens the Members tab it sees ITS OWN profile instead of the directory:
     name, contact, Change password, fund balances (Share Capital, Statutory Fund, ...) and every contribution.
   - Only the Admin can add / delete contributions and link accounts. Cashier can view.
   - Needs the "Member profile" SQL in Settings (members.user_id + member_contributions + policies).
   Loaded on demand by index.html (same pattern as supplies.js). */

Object.assign(state, {
  mpReady: null,        // null = unknown, true/false once member_contributions was queried
  mpRows: [],           // contributions of member `mpFor`
  mpFor: null,          // member id the rows belong to
  mpLoading: false,
  mpError: '',
  mpBusy: false,
  mpSharesReady: null,  // does member_contributions have the "shares" column? null = unknown
  mpImport: null,       // Excel share-import screen (Admin)
  mpEditId: null,       // contribution being edited (Admin)
  mpEditDraft: null,
  mpTotals: { loaded: false, loading: false, byMember: {}, shares: 0, amount: 0, withShares: 0 },
  mpDraft: { date: '', fund: 'Share Capital', kind: 'in', amount: '', shares: '', note: '' }
});

const MP_DEFAULT_FUNDS = ['Share Capital', 'Statutory Fund', 'Savings'];
const MP_SHARE_PAR = 100;   // pesos per share (Excel: 60 shares = 6,000)

function mpFmt(n){
  const v = Number(n) || 0;
  return (v < 0 ? '-' : '') + money(Math.abs(v));
}
function mpNum(n){ return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function mpDate(s){
  if(!s) return '';
  const p = String(s).slice(0, 10).split('-');
  if(p.length !== 3) return escapeHtml(String(s));
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function mpMyMember(){
  if(!state.user || !state.user.id) return null;
  return state.members.find(m => m.user_id && m.user_id === state.user.id) || null;
}
function mpLinkColumnReady(){
  return !state.members.length || ('user_id' in state.members[0]);
}

function mpSchedule(memberId){
  if(state.mpFor === memberId || state.mpLoading) return;
  state.mpLoading = true;
  setTimeout(() => mpLoad(memberId), 0);
}

async function mpLoad(memberId){
  state.mpLoading = true;
  state.mpError = '';
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/member_contributions?select=*&member_id=eq.${encodeURIComponent(memberId)}&order=entry_date.desc,id.desc&limit=2000`, { headers: supaHeaders() });
    if(!res.ok){
      const err = await res.json().catch(() => ({}));
      if(res.status === 404 || /does not exist|schema cache/i.test(err.message || '')){
        state.mpReady = false; state.mpRows = [];
      } else {
        throw new Error(err.message || ('error ' + res.status));
      }
    } else {
      state.mpRows = await res.json();
      state.mpReady = true;
      if(state.mpRows.length) state.mpSharesReady = ('shares' in state.mpRows[0]);
    }
  }catch(e){
    state.mpError = e.message || 'Could not load contributions.';
    state.mpRows = [];
  }
  state.mpFor = memberId;
  state.mpLoading = false;
  render();
}

// Per-fund totals. Share Capital and Statutory Fund are always shown first, even at 0.
function mpBalances(rows){
  const map = {}, shares = {};
  rows.forEach(r => {
    const f = String(r.fund || 'Other').trim() || 'Other';
    map[f] = (map[f] || 0) + (Number(r.amount) || 0);
    shares[f] = (shares[f] || 0) + (Number(r.shares) || 0);
  });
  ['Share Capital', 'Statutory Fund'].forEach(f => { if(!(f in map)) map[f] = 0; });
  const first = ['Share Capital', 'Statutory Fund'];
  const names = Object.keys(map).sort((a, b) => {
    const ia = first.indexOf(a), ib = first.indexOf(b);
    if(ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });
  let total = 0;
  names.forEach(n => { total += map[n]; });
  return { map, shares, names, total };
}

function mpBalancesHtml(rows){
  const b = mpBalances(rows);
  const cards = b.names.map(n =>
    '<div style="border:1px solid var(--line); border-radius:10px; padding:12px 14px; background:var(--bg-panel-2);">' +
      '<div style="font-size:14px; color:var(--ink-dim);">' + escapeHtml(n) + '</div>' +
      '<div style="font-size:24px; font-weight:700; color:var(--gold); margin-top:2px;">' + mpFmt(b.map[n]) + '</div>' +
      (b.shares[n] ? '<div style="font-size:16px; margin-top:4px;"><strong>' + mpNum(b.shares[n]) + '</strong> shares</div>' : '') +
    '</div>').join('');
  return '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin-bottom:12px;">' + cards + '</div>' +
    '<div style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border:1px solid var(--gold-dim); border-radius:10px; margin-bottom:6px;">' +
      '<span style="font-size:16px; font-weight:600;">Total</span>' +
      '<span style="font-size:24px; font-weight:800; color:var(--gold);">' + mpFmt(b.total) + '</span>' +
    '</div>';
}

function mpEditFormHtml(r){
  const d = state.mpEditDraft || {};
  return '<div style="padding:12px; border:1px solid var(--gold-dim); border-radius:10px; margin:8px 0;">' +
    '<div style="font-size:16px; font-weight:600; margin-bottom:8px;">I-edit ang entry</div>' +
    '<div class="field"><label>Date</label><input id="mpe-date" type="date" value="' + escapeHtml(d.date || '') + '"></div>' +
    '<div class="field"><label>Fund</label><input id="mpe-fund" list="mp-fund-list" value="' + escapeHtml(d.fund || '') + '"></div>' +
    (state.mpSharesReady === false ? '' : '<div class="field"><label>No. of shares</label><input id="mpe-shares" type="number" inputmode="decimal" step="1" value="' + escapeHtml(d.shares || '') + '"></div>') +
    '<div class="field"><label>Amount (\u20B1) &mdash; negatibo kung bawas</label><input id="mpe-amount" type="number" inputmode="decimal" step="0.01" value="' + escapeHtml(d.amount || '') + '"></div>' +
    '<div class="field"><label>Note</label><input id="mpe-note" value="' + escapeHtml(d.note || '') + '"></div>' +
    '<div style="display:flex; gap:8px;"><button class="primary" id="mpe-save" style="flex:1;"' + (state.mpBusy ? ' disabled' : '') + '>' + (state.mpBusy ? 'Saving...' : 'Save') + '</button>' +
    '<button class="ghost" id="mpe-cancel" style="flex:1;">Cancel</button></div>' +
  '</div>';
}

function mpHistoryHtml(rows, canDelete){
  if(!rows.length) return '<div class="empty">Wala pang naka-record na contribution.</div>';
  return rows.map(r => {
    if(canDelete && state.mpEditId !== null && String(state.mpEditId) === String(r.id)) return mpEditFormHtml(r);
    const amt = Number(r.amount) || 0;
    return '<div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start; padding:11px 4px; border-bottom:1px solid var(--line);">' +
      '<div style="min-width:0;">' +
        '<div style="font-size:16px; font-weight:600;">' + escapeHtml(r.fund || '') + '</div>' +
        '<div style="font-size:14px; color:var(--ink-dim);">' + mpDate(r.entry_date) + (r.shares ? ' \u00B7 ' + mpNum(r.shares) + ' shares' : '') + (r.note ? ' \u00B7 ' + escapeHtml(r.note) : '') + '</div>' +
      '</div>' +
      '<div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">' +
        '<span style="font-size:17px; font-weight:700; color:' + (amt < 0 ? 'var(--neg)' : 'var(--pos)') + ';">' + (amt > 0 ? '+' : '') + mpFmt(amt) + '</span>' +
        (canDelete ? '<button class="icon-btn" data-mp-edit="' + r.id + '" title="Edit">\u270E</button><button class="icon-btn" data-mp-del="' + r.id + '" title="Delete">\u2715</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function mpNeedsSqlHtml(){
  return '<div class="setup-note">Hindi pa naka-setup ang Member profile. Ipa-run sa Admin ang <strong>Member profile</strong> SQL sa Settings (Supabase SQL Editor).</div>';
}

/* ----- Regular (viewer) account linked to a member: its own profile ----- */
function renderMemberProfileView(){
  if(!isViewer()) return null;
  const me = mpMyMember();
  if(!me) return null;
  mpSchedule(me.id);
  const loaded = state.mpFor === me.id;

  let right;
  if(!loaded){
    right = '<div class="empty">Loading...</div>';
  } else if(state.mpReady === false){
    right = mpNeedsSqlHtml();
  } else if(state.mpError){
    right = '<div class="setup-note">' + escapeHtml(state.mpError) + '</div><button class="ghost" id="mp-reload">Try again</button>';
  } else {
    right = mpBalancesHtml(state.mpRows) +
      '<h2 style="margin-top:18px;">Contributions</h2>' +
      '<div>' + mpHistoryHtml(state.mpRows, false) + '</div>';
  }

  return '<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);">' +
    '<div class="panel">' +
      '<h2>\uD83D\uDC64 My profile</h2>' +
      '<div style="font-size:24px; font-weight:700; margin:4px 0 6px;">' + escapeHtml(me.full_name) + '</div>' +
      '<div style="font-size:16px; color:var(--ink-dim); margin-bottom:4px;">' + (me.phone ? escapeHtml(me.phone) : 'No contact number') + '</div>' +
      '<div style="font-size:15px; color:var(--ink-dim); word-break:break-all;">Login: ' + escapeHtml(state.user && state.user.email ? state.user.email : '') + '</div>' +
      '<button class="primary" data-chpw="1" style="margin-top:18px; width:100%;">\uD83D\uDD11 Change password</button>' +
    '</div>' +
    '<div class="panel"><h2>My balances</h2>' + right + '</div>' +
  '</div>';
}

/* ----- Admin / cashier: panel inside the member edit screen ----- */
function memberProfilePanelHtml(em){
  if(!em || isViewer()) return '';
  const admin = isAdmin();
  const loaded = state.mpFor === em.id;
  mpSchedule(em.id);

  let h = '<div style="border-top:1px solid var(--line); margin:18px 0 14px;"></div>' +
    '<h2>\uD83D\uDC64 Profile &amp; contributions</h2>';

  // Login account link (Admin only)
  if(admin){
    if(!mpLinkColumnReady()){
      h += mpNeedsSqlHtml();
    } else {
      const mem = state.members.find(m => m.id === em.id) || {};
      const takenByOthers = new Set(state.members.filter(m => m.user_id && m.id !== em.id).map(m => m.user_id));
      const accounts = (state.appUsers || []).filter(u => u.role === 'viewer' && (u.user_id === mem.user_id || !takenByOthers.has(u.user_id)));
      h += '<div class="field"><label>Login account (Regular user)</label>' +
        '<select id="mp-link">' +
          '<option value="">\u2014 walang naka-link \u2014</option>' +
          accounts.map(u => '<option value="' + escapeHtml(u.user_id) + '"' + (u.user_id === mem.user_id ? ' selected' : '') + '>' + escapeHtml(u.full_name || u.email || u.user_id) + (u.email && u.full_name ? ' (' + escapeHtml(u.email) + ')' : '') + '</option>').join('') +
        '</select>' +
        '<div class="setup-note" style="margin-top:6px;">Gumawa muna ng account sa Settings \u2192 Manage users (role: Regular), tapos piliin dito. Ito ang account na makakakita ng profile ng member na ito.</div>' +
      '</div>';
    }
  }

  if(!loaded){
    h += '<div class="empty">Loading...</div>';
    return h;
  }
  if(state.mpReady === false) return h + mpNeedsSqlHtml();
  if(state.mpError) return h + '<div class="setup-note">' + escapeHtml(state.mpError) + '</div><button class="ghost" id="mp-reload">Try again</button>';

  h += mpBalancesHtml(state.mpRows);

  if(admin){
    const d = state.mpDraft;
    if(!d.date) d.date = localDateStr();
    const used = [];
    state.mpRows.forEach(r => { if(r.fund && used.indexOf(r.fund) === -1) used.push(r.fund); });
    MP_DEFAULT_FUNDS.forEach(f => { if(used.indexOf(f) === -1) used.push(f); });
    h += '<div style="border:1px solid var(--line); border-radius:10px; padding:12px; margin:14px 0;">' +
      '<div style="font-size:16px; font-weight:600; margin-bottom:8px;">Add contribution</div>' +
      '<div class="field"><label>Date</label><input id="mp-date" type="date" value="' + escapeHtml(d.date) + '"></div>' +
      '<div class="field"><label>Fund</label><input id="mp-fund" list="mp-fund-list" value="' + escapeHtml(d.fund) + '" placeholder="e.g. Share Capital">' +
        '<datalist id="mp-fund-list">' + used.map(f => '<option value="' + escapeHtml(f) + '"></option>').join('') + '</datalist></div>' +
      '<div class="field"><label>Type</label><select id="mp-kind">' +
        '<option value="in"' + (d.kind === 'in' ? ' selected' : '') + '>Contribution (dagdag)</option>' +
        '<option value="out"' + (d.kind === 'out' ? ' selected' : '') + '>Withdrawal (bawas)</option>' +
      '</select></div>' +
      '<div class="field"><label>Amount</label><input id="mp-amount" type="number" inputmode="decimal" step="0.01" min="0" value="' + escapeHtml(d.amount) + '" placeholder="0.00"></div>' +
      (state.mpSharesReady === false ? '' : '<div class="field"><label>No. of shares (optional, para sa Share Capital)</label><input id="mp-shares" type="number" inputmode="decimal" step="1" min="0" value="' + escapeHtml(d.shares || '') + '" placeholder="e.g. 25"></div>') +
      '<div class="field"><label>Note (optional)</label><input id="mp-note" value="' + escapeHtml(d.note) + '" placeholder="e.g. OR # / remarks"></div>' +
      '<button class="primary" id="mp-add"' + (state.mpBusy ? ' disabled' : '') + '>' + (state.mpBusy ? 'Saving...' : 'Add') + '</button>' +
    '</div>';
  }

  h += '<h2 style="margin-top:6px;">History</h2><div>' + mpHistoryHtml(state.mpRows, admin) + '</div>';
  return h;
}

/* ----- events (called from index.html after every render) ----- */
function bindMemberProfile(app){
  const reload = document.getElementById('mp-reload');
  if(reload) reload.addEventListener('click', () => { state.mpFor = null; state.mpError = ''; render(); });

  const d = state.mpDraft;
  const date = document.getElementById('mp-date');
  if(date) date.addEventListener('input', () => { d.date = date.value; });
  const fund = document.getElementById('mp-fund');
  if(fund) fund.addEventListener('input', () => { d.fund = fund.value; });
  const kind = document.getElementById('mp-kind');
  if(kind) kind.addEventListener('change', () => { d.kind = kind.value; });
  const amount = document.getElementById('mp-amount');
  if(amount) amount.addEventListener('input', () => { d.amount = amount.value; });
  const shares = document.getElementById('mp-shares');
  if(shares) shares.addEventListener('input', () => {
    d.shares = shares.value;
    const n = Number(shares.value);
    if(/share\s*capital/i.test(d.fund || '') && isFinite(n) && n > 0){
      d.amount = String(Math.round(n * MP_SHARE_PAR * 100) / 100);
      const am = document.getElementById('mp-amount'); if(am) am.value = d.amount;
    }
  });
  const note = document.getElementById('mp-note');
  if(note) note.addEventListener('input', () => { d.note = note.value; });

  const addBtn = document.getElementById('mp-add');
  if(addBtn) addBtn.addEventListener('click', mpAdd);
  if(typeof mpBindImport === 'function') mpBindImport(app);

  app.querySelectorAll('[data-mp-edit]').forEach(b => {
    b.addEventListener('click', ev => {
      ev.stopPropagation();
      const row = state.mpRows.find(r => String(r.id) === String(b.getAttribute('data-mp-edit')));
      if(!row) return;
      state.mpEditId = row.id;
      state.mpEditDraft = { date: String(row.entry_date || '').slice(0, 10), fund: row.fund || '', amount: String(row.amount == null ? '' : row.amount), shares: row.shares == null ? '' : String(row.shares), note: row.note || '' };
      render();
    });
  });
  const ed = state.mpEditDraft;
  if(ed){
    const bindEd = (id, key) => { const el = document.getElementById(id); if(el) el.addEventListener('input', () => { ed[key] = el.value; }); };
    bindEd('mpe-date', 'date'); bindEd('mpe-fund', 'fund'); bindEd('mpe-amount', 'amount'); bindEd('mpe-note', 'note');
    const esh = document.getElementById('mpe-shares');
    if(esh) esh.addEventListener('input', () => {
      ed.shares = esh.value;
      const n = Number(esh.value);
      if(/share\s*capital/i.test(ed.fund || '') && isFinite(n) && n !== 0){
        ed.amount = String(Math.round(n * MP_SHARE_PAR * 100) / 100);
        const am = document.getElementById('mpe-amount'); if(am) am.value = ed.amount;
      }
    });
    const sv = document.getElementById('mpe-save'); if(sv) sv.addEventListener('click', mpSaveEdit);
    const cn = document.getElementById('mpe-cancel'); if(cn) cn.addEventListener('click', () => { state.mpEditId = null; state.mpEditDraft = null; render(); });
  }
  app.querySelectorAll('[data-mp-del]').forEach(b => {
    b.addEventListener('click', ev => { ev.stopPropagation(); mpDelete(b.getAttribute('data-mp-del')); });
  });

  const link = document.getElementById('mp-link');
  if(link) link.addEventListener('change', () => mpLinkAccount(link.value));
}

async function mpAdd(){
  if(!isAdmin() || !state.editingMember || state.mpBusy) return;
  const d = state.mpDraft;
  const fund = String(d.fund || '').trim();
  const amt = Number(d.amount);
  if(!fund){ showToast('Ilagay kung anong fund (hal. Share Capital).', true); return; }
  if(!isFinite(amt) || amt <= 0){ showToast('Maglagay ng amount na higit sa zero.', true); return; }
  if(!d.date){ showToast('Piliin ang petsa.', true); return; }
  state.mpBusy = true; render();
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/member_contributions`, {
      method: 'POST', headers: supaHeaders(),
      body: JSON.stringify([{
        member_id: state.editingMember.id,
        entry_date: d.date,
        fund: fund,
        amount: (d.kind === 'out' ? -1 : 1) * Math.round(amt * 100) / 100,
        note: String(d.note || '').trim() || null
      }].map(o => {
        const sh = Number(d.shares);
        if(isFinite(sh) && sh > 0 && state.mpSharesReady !== false) o.shares = (d.kind === 'out' ? -1 : 1) * sh;
        return o;
      }))
    });
    if(!res.ok){
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.hint || ('Insert failed (' + res.status + ')'));
    }
    const rows = await res.json();
    if(rows && rows[0]) state.mpRows.unshift(rows[0]);
    state.mpRows.sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)) || (b.id - a.id));
    d.amount = ''; d.shares = ''; d.note = '';
    state.mpBusy = false;
    showToast(d.kind === 'out' ? 'Withdrawal recorded.' : 'Contribution added.');
    mpLoadTotals();
  }catch(e){
    state.mpBusy = false;
    showToast('Could not save: ' + e.message, true);
  }
}

async function mpSaveEdit(){
  if(!isAdmin() || state.mpEditId === null || state.mpBusy) return;
  const d = state.mpEditDraft;
  const fund = String(d.fund || '').trim();
  const amt = Number(d.amount);
  if(!fund){ showToast('Ilagay ang fund.', true); return; }
  if(d.amount === '' || !isFinite(amt)){ showToast('Maglagay ng tamang amount.', true); return; }
  if(!d.date){ showToast('Piliin ang petsa.', true); return; }
  const body = { entry_date: d.date, fund: fund, amount: Math.round(amt * 100) / 100, note: String(d.note || '').trim() || null };
  if(state.mpSharesReady !== false){
    const sh = d.shares === '' ? null : Number(d.shares);
    if(sh !== null && !isFinite(sh)){ showToast('Hindi tamang bilang ng shares.', true); return; }
    body.shares = sh;
  }
  state.mpBusy = true; render();
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/member_contributions?id=eq.${encodeURIComponent(state.mpEditId)}`, { method: 'PATCH', headers: supaHeaders(), body: JSON.stringify(body) });
    if(!res.ok){ const e = await res.json().catch(() => ({})); throw new Error(e.message || ('Update failed (' + res.status + ')')); }
    const out = await res.json();
    const i = state.mpRows.findIndex(r => String(r.id) === String(state.mpEditId));
    if(i !== -1 && out && out[0]) state.mpRows[i] = out[0];
    state.mpRows.sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)) || (b.id - a.id));
    state.mpEditId = null; state.mpEditDraft = null; state.mpBusy = false;
    showToast('Entry updated.');
    mpLoadTotals();
  }catch(e){
    state.mpBusy = false;
    showToast('Could not update: ' + e.message, true);
  }
}

/* ----- totals for Admin / Cashier: shares + Share Capital per member, and overall ----- */
async function mpLoadTotals(){
  if(isViewer() || !state.connected || state.mpTotals.loading) return;
  state.mpTotals.loading = true;
  try{
    const all = [];
    let withShares = true;
    for(let off = 0; ; off += 1000){
      let res = await fetch(`${state.supaUrl}/rest/v1/member_contributions?select=member_id,fund,amount,shares&order=id.asc&limit=1000&offset=${off}`, { headers: supaHeaders() });
      if(!res.ok && off === 0){
        withShares = false;
        res = await fetch(`${state.supaUrl}/rest/v1/member_contributions?select=member_id,fund,amount&order=id.asc&limit=1000&offset=${off}`, { headers: supaHeaders() });
      }
      if(!res.ok) throw new Error('totals ' + res.status);
      const batch = await res.json();
      all.push(...batch);
      if(batch.length < 1000) break;
    }
    const by = {}; let sh = 0, am = 0;
    all.forEach(r => {
      const t = by[r.member_id] || (by[r.member_id] = { shares: 0, amount: 0, all: 0 });
      const a = Number(r.amount) || 0, n = Number(r.shares) || 0;
      t.all += a;
      if(/share\s*capital/i.test(r.fund || '')){ t.amount += a; t.shares += n; sh += n; am += a; }
      else if(n){ t.shares += n; sh += n; }
    });
    state.mpTotals = { loaded: true, loading: false, byMember: by, shares: sh, amount: am, withShares: Object.keys(by).filter(k => by[k].shares > 0).length };
    if(withShares && state.mpSharesReady === null) state.mpSharesReady = true;
  }catch(e){
    state.mpTotals.loading = false;
    return;
  }
  if(state.tab === 'members'){
    if(typeof updateMemberList === 'function' && document.getElementById('member-list')) updateMemberList();
    else render();
  }
}

// one member's line in the Members list
function mpMemberTotalLine(id){
  if(isViewer() || !state.mpTotals.loaded) return '';
  const t = state.mpTotals.byMember[id];
  if(!t || (!t.shares && !t.amount)) return '<div style="text-align:right; color:var(--ink-dim); font-size:14px;">\u2014</div>';
  return '<div style="text-align:right;">' +
    '<div style="font-size:16px; font-weight:700; color:var(--gold);">' + mpNum(t.shares) + ' sh</div>' +
    '<div style="font-size:13px; color:var(--ink-dim);">' + mpFmt(t.amount) + '</div></div>';
}

// totals line above the Members list (everyone, or only the people matching the search)
function mpOverallTotalsHtml(){
  if(isViewer() || !state.mpTotals.loaded) return '';
  const T = state.mpTotals;
  let h = '<div style="margin-top:8px; padding:10px 12px; border:1px solid var(--gold-dim); border-radius:10px; color:var(--ink);">' +
    '<div style="font-size:15px;">Overall: <strong style="color:var(--gold); font-size:18px;">' + mpNum(T.shares) + '</strong> shares \u00B7 <strong style="color:var(--gold); font-size:18px;">' + mpFmt(T.amount) + '</strong> Share Capital</div>' +
    '<div style="font-size:13px; color:var(--ink-dim);">' + T.withShares + ' member ang may shares</div>';
  if(state.memberSearch && state.memberSearch.trim() && typeof filteredMembers === 'function'){
    let fs = 0, fa = 0;
    filteredMembers().forEach(m => { const t = T.byMember[m.id]; if(t){ fs += t.shares; fa += t.amount; } });
    h += '<div style="font-size:14px; margin-top:4px;">Sa nahanap: <strong>' + mpNum(fs) + '</strong> shares \u00B7 <strong>' + mpFmt(fa) + '</strong></div>';
  }
  return h + '</div>';
}

async function mpDelete(id){
  if(!isAdmin()) return;
  const row = state.mpRows.find(r => String(r.id) === String(id));
  if(!row) return;
  if(!window.confirm('Burahin ang entry na ito?\n' + (row.fund || '') + ' \u00B7 ' + mpFmt(row.amount) + ' \u00B7 ' + mpDate(row.entry_date))) return;
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/member_contributions?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: supaHeaders() });
    if(!res.ok){
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || ('Delete failed (' + res.status + ')'));
    }
    state.mpRows = state.mpRows.filter(r => String(r.id) !== String(id));
    showToast('Entry deleted.');
    mpLoadTotals();
  }catch(e){
    showToast('Could not delete: ' + e.message, true);
  }
}

async function mpLinkAccount(userId){
  if(!isAdmin() || !state.editingMember) return;
  const memberId = state.editingMember.id;
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/members?id=eq.${encodeURIComponent(memberId)}`, {
      method: 'PATCH', headers: supaHeaders(),
      body: JSON.stringify({ user_id: userId || null })
    });
    if(!res.ok){
      const err = await res.json().catch(() => ({}));
      if(/duplicate|unique/i.test(err.message || '')) throw new Error('Naka-link na ang account na iyon sa ibang member.');
      throw new Error(err.message || ('Update failed (' + res.status + ')'));
    }
    const m = state.members.find(x => x.id === memberId);
    if(m) m.user_id = userId || null;
    showToast(userId ? 'Account linked.' : 'Account unlinked.');
  }catch(e){
    showToast('Could not link: ' + e.message, true);
  }
}

// Called by index.html when the Members tab opens: make sure the Admin's account list is loaded for the link dropdown.
async function loadMemberProfileData(){
  if(!isViewer()) mpLoadTotals();
  if(isAdmin() && (!state.appUsers || !state.appUsers.length)){
    try{ await fetchAppUsers(); }catch(e){}
  }
}


/* =====================================================================
   Excel share import (Admin): No. | Names | No. of Shares | total Amount
   Matches each Excel name to a member, shows a preview you can fix,
   then saves one "Share Capital" entry per member (amount + shares).
   ===================================================================== */
const MP_IMPORT_TAG = 'Excel import';

function mpNorm(s){
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function mpCore(s){ return mpNorm(s).split(' ').filter(t => t.length > 1); }   // drop middle initials
function mpKey(s){ return mpCore(s).sort().join(' '); }
function mpSim(a, b){
  const A = new Set(mpCore(a)), B = new Set(mpCore(b));
  if(!A.size || !B.size) return 0;
  let inter = 0; A.forEach(t => { if(B.has(t)) inter++; });
  return inter / (A.size + B.size - inter);
}

function mpImpOpen(){
  state.mpImport = { fileName: '', rows: [], asOf: localDateStr(), busy: false, done: null, error: '', existing: null };
  render();
  mpImpProbe();
}
function mpImpClose(){ state.mpImport = null; render(); }

// Is the "shares" column there? Which members already got an Excel import?
async function mpImpProbe(){
  const imp = state.mpImport; if(!imp) return;
  try{
    const r1 = await fetch(`${state.supaUrl}/rest/v1/member_contributions?select=shares&limit=1`, { headers: supaHeaders() });
    if(!r1.ok){
      const e = await r1.json().catch(() => ({}));
      state.mpSharesReady = false;
      if(r1.status === 404 || /does not exist|schema cache/i.test(e.message || '')) state.mpReady = false;
    } else {
      state.mpSharesReady = true; state.mpReady = true;
      const r2 = await fetch(`${state.supaUrl}/rest/v1/member_contributions?select=member_id&fund=eq.Share%20Capital&note=like.${encodeURIComponent(MP_IMPORT_TAG + '*')}&limit=5000`, { headers: supaHeaders() });
      imp.existing = r2.ok ? new Set((await r2.json()).map(x => x.member_id)) : new Set();
    }
  }catch(e){ state.mpSharesReady = false; }
  if(state.mpImport === imp){ if(imp.rows.length) mpImpMatchAll(); render(); }
}

function mpImpParse(sheetRows){
  // find header row + columns by their titles; fall back to A,B,C,D
  let hdr = -1, cName = 1, cShares = 2, cAmt = 3;
  for(let i = 0; i < Math.min(sheetRows.length, 15); i++){
    const cells = (sheetRows[i] || []).map(c => String(c == null ? '' : c).toLowerCase());
    const n = cells.findIndex(c => /name/.test(c));
    if(n !== -1){
      hdr = i; cName = n;
      const sh = cells.findIndex(c => /share/.test(c) && !/amount|total|₱|php/.test(c));
      const am = cells.findIndex(c => /amount|total/.test(c));
      if(sh !== -1) cShares = sh;
      if(am !== -1) cAmt = am;
      break;
    }
  }
  const out = [];
  for(let i = hdr + 1; i < sheetRows.length; i++){
    const r = sheetRows[i] || [];
    const name = String(r[cName] == null ? '' : r[cName]).replace(/\s+/g, ' ').trim();
    if(!name) continue;
    const shares = Number(String(r[cShares] == null ? '' : r[cShares]).replace(/[^0-9.\-]/g, ''));
    let amount = Number(String(r[cAmt] == null ? '' : r[cAmt]).replace(/[^0-9.\-]/g, ''));
    if(!isFinite(shares) || shares <= 0) continue;
    if(!isFinite(amount) || amount <= 0) amount = shares * 100;
    out.push({ no: r[0], name, shares, amount, memberId: '', status: 'none', sim: 0 });
  }
  return out;
}

function mpImpMatchAll(){
  const imp = state.mpImport; if(!imp) return;
  const members = state.members;
  const used = new Set();
  const byKey = {};
  members.forEach(m => { const k = mpKey(m.full_name); if(k) (byKey[k] = byKey[k] || []).push(m); });
  imp.rows.forEach(r => { r.memberId = ''; r.status = 'none'; r.sim = 0; });
  // 1) exact (same words, any order, initials ignored)
  imp.rows.forEach(r => {
    const list = (byKey[mpKey(r.name)] || []).filter(m => !used.has(m.id));
    if(list.length === 1){ r.memberId = list[0].id; r.status = 'exact'; used.add(list[0].id); }
  });
  // 2) close matches, to be double-checked by the admin
  imp.rows.forEach(r => {
    if(r.memberId) return;
    let best = null, bs = 0;
    members.forEach(m => { if(used.has(m.id)) return; const sc = mpSim(r.name, m.full_name); if(sc > bs){ bs = sc; best = m; } });
    if(best && bs >= 0.6){ r.memberId = best.id; r.status = 'suggest'; r.sim = bs; used.add(best.id); }
  });
  // 3) already imported before -> skip by default
  if(imp.existing) imp.rows.forEach(r => { if(r.memberId && imp.existing.has(r.memberId)){ r.status = 'dup'; r.memberId = ''; } });
}

function mpImpSummaryHtml(){
  const imp = state.mpImport;
  const c = { exact: 0, suggest: 0, none: 0, dup: 0, skip: 0, neu: 0 };
  let sh = 0, am = 0, tsh = 0, tam = 0;
  imp.rows.forEach(r => {
    tsh += r.shares; tam += r.amount;
    if(r.memberId === '__new') c.neu++;
    if(r.memberId){ sh += r.shares; am += r.amount; }
    else c.skip++;
    if(r.status === 'exact' || r.status === 'manual' || r.status === 'new') c.exact++;
    else if(r.status === 'suggest') c.suggest++;
    else if(r.status === 'dup') c.dup++;
    else c.none++;
  });
  return '<div style="font-size:15px; line-height:1.7;">' +
    'Sa Excel: <strong>' + imp.rows.length + '</strong> na member \u00B7 <strong>' + mpNum(tsh) + '</strong> shares \u00B7 <strong>' + mpFmt(tam) + '</strong><br>' +
    '\u2714 Tugma: <strong>' + c.exact + '</strong> \u00B7 \u2248 Posibleng tugma (i-check): <strong>' + c.suggest + '</strong> \u00B7 \u2716 Walang tugma: <strong>' + c.none + '</strong>' + (c.dup ? ' \u00B7 \u23ED Na-import na dati: <strong>' + c.dup + '</strong>' : '') + '<br>' +
    'Ia-upload ngayon: <strong style="color:var(--gold);">' + (imp.rows.length - c.skip) + '</strong> member \u00B7 <strong style="color:var(--gold);">' + mpNum(sh) + '</strong> shares \u00B7 <strong style="color:var(--gold);">' + mpFmt(am) + '</strong>' + (c.neu ? ' (kasama ang ' + c.neu + ' bagong member)' : '') +
  '</div>';
}

function renderShareImportView(){
  const imp = state.mpImport;
  if(!imp) return null;
  const back = '<button class="ghost" id="mpi-back" style="margin-bottom:12px;">\u2190 Bumalik sa Members</button>';
  if(imp.done){
    return '<div class="panel">' + back + '<h2>\u2705 Tapos na ang upload</h2>' +
      '<div style="font-size:17px; line-height:1.8;">' + imp.done + '</div></div>';
  }
  if(state.mpReady === false || state.mpSharesReady === false){
    return '<div class="panel">' + back + '<h2>Upload shares (Excel)</h2>' +
      '<div class="setup-note">Kailangan munang i-run ang SQL na <strong>"Member profile \u2014 shares"</strong> sa Settings (Supabase SQL Editor). Isang linya lang. Pagkatapos, bumalik dito.</div></div>';
  }
  if(state.mpSharesReady === null){
    return '<div class="panel">' + back + '<h2>Upload shares (Excel)</h2><div class="empty">Checking...</div></div>';
  }

  let body = '<div class="setup-note">Excel (.xlsx / .xls / .csv) na may columns: <strong>No.</strong>, <strong>Names</strong>, <strong>No. of Shares</strong>, <strong>total Amount of share</strong>. Hahanapin ko ang bawat pangalan sa Members list. Makikita mo muna ang preview bago ma-save.</div>' +
    '<div class="field" style="margin-top:12px;"><label>Excel file</label><input id="mpi-file" type="file" accept=".xlsx,.xls,.csv"></div>';
  if(imp.error) body += '<div class="setup-note" style="border-color:var(--neg);">' + escapeHtml(imp.error) + '</div>';

  if(imp.rows.length){
    const opts = state.members.map(m => '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.full_name) + '</option>').join('');
    const badge = { exact: ['\u2714 tugma', 'var(--pos)'], suggest: ['\u2248 i-check', 'var(--gold)'], none: ['\u2716 walang tugma', 'var(--neg)'], manual: ['\u2714 pinili mo', 'var(--pos)'], new: ['\uFF0B bago', 'var(--pos)'], skip: ['\u23ED i-skip', 'var(--ink-dim)'], dup: ['\u23ED na-import na', 'var(--ink-dim)'] };
    body += '<div class="field"><label>Petsa ng share capital (as of)</label><input id="mpi-date" type="date" value="' + escapeHtml(imp.asOf) + '"></div>' +
      '<div id="mpi-summary" style="margin:12px 0; padding:12px; border:1px solid var(--gold-dim); border-radius:10px;">' + mpImpSummaryHtml() + '</div>' +
      '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">' +
        '<button class="ghost" id="mpi-allnew">Gawing bagong member lahat ng walang tugma</button>' +
      '</div>' +
      '<div>' + imp.rows.map((r, i) => {
        const b = badge[r.status] || badge.none;
        const cur = r.memberId;
        return '<div style="padding:11px 4px; border-bottom:1px solid var(--line);">' +
          '<div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">' +
            '<div style="font-size:16px; font-weight:600; min-width:0;">' + escapeHtml(r.name) + '</div>' +
            '<div style="font-size:15px; white-space:nowrap;"><strong>' + mpNum(r.shares) + '</strong> sh \u00B7 ' + mpFmt(r.amount) + '</div>' +
          '</div>' +
          '<div style="display:flex; gap:8px; align-items:center; margin-top:6px;">' +
            '<span data-mpi-badge="' + i + '" style="font-size:13px; font-weight:600; color:' + b[1] + '; white-space:nowrap;">' + b[0] + '</span>' +
            '<select data-mpi-row="' + i + '" style="flex:1; min-width:0;">' +
              '<option value=""' + (cur === '' ? ' selected' : '') + '>\u2014 i-skip \u2014</option>' +
              '<option value="__new"' + (cur === '__new' ? ' selected' : '') + '>\uFF0B Gawing bagong member</option>' +
              opts.replace('value="' + escapeHtml(cur) + '"', 'value="' + escapeHtml(cur) + '" selected') +
            '</select>' +
          '</div></div>';
      }).join('') + '</div>' +
      '<button class="primary" id="mpi-go" style="width:100%; margin-top:16px;"' + (imp.busy ? ' disabled' : '') + '>' + (imp.busy ? 'Ina-upload...' : '\uD83D\uDCE5 I-upload ang shares') + '</button>';
  }
  return '<div class="panel">' + back + '<h2>\uD83D\uDCE5 Upload shares (Excel)</h2>' + body + '</div>';
}

async function mpImpReadFile(file){
  const imp = state.mpImport; if(!imp || !file) return;
  imp.error = ''; imp.rows = []; imp.fileName = file.name;
  try{
    const XLSX = await ensureXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
    imp.rows = mpImpParse(grid);
    if(!imp.rows.length) imp.error = 'Walang nabasang member (kailangan ng Names at No. of Shares columns).';
    else mpImpMatchAll();
  }catch(e){
    imp.error = 'Hindi mabasa ang file: ' + (e.message || e);
  }
  render();
}

async function mpImpRun(){
  const imp = state.mpImport;
  if(!imp || imp.busy || !isAdmin()) return;
  const todo = imp.rows.filter(r => r.memberId);
  if(!todo.length){ showToast('Wala pang napiling i-upload.', true); return; }
  const totalSh = todo.reduce((a, r) => a + r.shares, 0), totalAm = todo.reduce((a, r) => a + r.amount, 0);
  if(!window.confirm('I-upload ang ' + todo.length + ' member, ' + mpNum(totalSh) + ' shares, ' + mpFmt(totalAm) + '?')) return;
  imp.busy = true; render();
  let createdMembers = 0, saved = 0;
  try{
    // 1) bagong members
    const fresh = todo.filter(r => r.memberId === '__new');
    if(fresh.length){
      const res = await fetch(`${state.supaUrl}/rest/v1/members`, { method: 'POST', headers: supaHeaders(), body: JSON.stringify(fresh.map(r => ({ full_name: r.name }))) });
      if(!res.ok){ const e = await res.json().catch(() => ({})); throw new Error('Hindi nagawa ang bagong members: ' + (e.message || res.status)); }
      const made = await res.json();
      made.forEach(m => { const r = fresh.find(x => x.name === m.full_name && x.memberId === '__new'); if(r) r.memberId = m.id; });
      createdMembers = made.length;
    }
    // 2) share capital entries, in small batches
    const payload = todo.filter(r => r.memberId && r.memberId !== '__new').map(r => ({
      member_id: r.memberId, entry_date: imp.asOf || localDateStr(), fund: 'Share Capital',
      amount: r.amount, shares: r.shares, note: MP_IMPORT_TAG + ': ' + imp.fileName
    }));
    for(let i = 0; i < payload.length; i += 40){
      const res = await fetch(`${state.supaUrl}/rest/v1/member_contributions`, { method: 'POST', headers: supaHeaders(), body: JSON.stringify(payload.slice(i, i + 40)) });
      if(!res.ok){ const e = await res.json().catch(() => ({})); throw new Error('Na-save ang ' + saved + ' member bago huminto: ' + (e.message || res.status)); }
      saved += payload.length > 0 ? Math.min(40, payload.length - i) : 0;
    }
    imp.done = 'Na-save: <strong>' + saved + '</strong> member \u00B7 <strong>' + mpNum(totalSh) + '</strong> shares \u00B7 <strong>' + mpFmt(totalAm) + '</strong>' +
      (createdMembers ? '<br>Bagong member na nagawa: <strong>' + createdMembers + '</strong>' : '') +
      '<br><br>Makikita na ng mga member ang kanilang shares sa profile nila.';
    state.mpFor = null;
    mpLoadTotals();
  }catch(e){
    imp.error = e.message || String(e);
  }
  imp.busy = false;
  try{ await fetchMembers(); }catch(e){}
  render();
}

function mpBindImport(app){
  const open = document.getElementById('btn-open-share-import');
  if(open) open.addEventListener('click', mpImpOpen);
  const imp = state.mpImport; if(!imp) return;
  const back = document.getElementById('mpi-back');
  if(back) back.addEventListener('click', mpImpClose);
  const file = document.getElementById('mpi-file');
  if(file) file.addEventListener('change', () => { if(file.files && file.files[0]) mpImpReadFile(file.files[0]); });
  const date = document.getElementById('mpi-date');
  if(date) date.addEventListener('input', () => { imp.asOf = date.value; });
  app.querySelectorAll('select[data-mpi-row]').forEach(sel => {
    sel.addEventListener('change', () => {
      const r = imp.rows[Number(sel.getAttribute('data-mpi-row'))];
      const idx = Number(sel.getAttribute('data-mpi-row'));
      r.memberId = sel.value;
      r.status = r.memberId === '' ? 'skip' : (r.memberId === '__new' ? 'new' : 'manual');
      const bd = app.querySelector('[data-mpi-badge="' + idx + '"]');
      if(bd){
        const t = { skip: ['\u23ED i-skip', 'var(--ink-dim)'], new: ['\uFF0B bago', 'var(--pos)'], manual: ['\u2714 pinili mo', 'var(--pos)'] }[r.status];
        bd.textContent = t[0]; bd.style.color = t[1];
      }
      const sum = document.getElementById('mpi-summary');
      if(sum) sum.innerHTML = mpImpSummaryHtml();
    });
  });
  const allNew = document.getElementById('mpi-allnew');
  if(allNew) allNew.addEventListener('click', () => {
    imp.rows.forEach(r => { if(!r.memberId && r.status !== 'dup') r.memberId = '__new'; });
    render();
  });
  const go = document.getElementById('mpi-go');
  if(go) go.addEventListener('click', mpImpRun);
}
