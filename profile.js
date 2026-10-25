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
  mpDraft: { date: '', fund: 'Share Capital', kind: 'in', amount: '', note: '' }
});

const MP_DEFAULT_FUNDS = ['Share Capital', 'Statutory Fund', 'Savings'];

function mpFmt(n){
  const v = Number(n) || 0;
  return (v < 0 ? '-' : '') + money(Math.abs(v));
}
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
  const map = {};
  rows.forEach(r => {
    const f = String(r.fund || 'Other').trim() || 'Other';
    map[f] = (map[f] || 0) + (Number(r.amount) || 0);
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
  return { map, names, total };
}

function mpBalancesHtml(rows){
  const b = mpBalances(rows);
  const cards = b.names.map(n =>
    '<div style="border:1px solid var(--line); border-radius:10px; padding:12px 14px; background:var(--bg-panel-2);">' +
      '<div style="font-size:14px; color:var(--ink-dim);">' + escapeHtml(n) + '</div>' +
      '<div style="font-size:24px; font-weight:700; color:var(--gold); margin-top:2px;">' + mpFmt(b.map[n]) + '</div>' +
    '</div>').join('');
  return '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin-bottom:12px;">' + cards + '</div>' +
    '<div style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border:1px solid var(--gold-dim); border-radius:10px; margin-bottom:6px;">' +
      '<span style="font-size:16px; font-weight:600;">Total</span>' +
      '<span style="font-size:24px; font-weight:800; color:var(--gold);">' + mpFmt(b.total) + '</span>' +
    '</div>';
}

function mpHistoryHtml(rows, canDelete){
  if(!rows.length) return '<div class="empty">Wala pang naka-record na contribution.</div>';
  return rows.map(r => {
    const amt = Number(r.amount) || 0;
    return '<div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start; padding:11px 4px; border-bottom:1px solid var(--line);">' +
      '<div style="min-width:0;">' +
        '<div style="font-size:16px; font-weight:600;">' + escapeHtml(r.fund || '') + '</div>' +
        '<div style="font-size:14px; color:var(--ink-dim);">' + mpDate(r.entry_date) + (r.note ? ' \u00B7 ' + escapeHtml(r.note) : '') + '</div>' +
      '</div>' +
      '<div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">' +
        '<span style="font-size:17px; font-weight:700; color:' + (amt < 0 ? 'var(--neg)' : 'var(--pos)') + ';">' + (amt > 0 ? '+' : '') + mpFmt(amt) + '</span>' +
        (canDelete ? '<button class="icon-btn" data-mp-del="' + r.id + '" title="Delete">\u2715</button>' : '') +
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
  const note = document.getElementById('mp-note');
  if(note) note.addEventListener('input', () => { d.note = note.value; });

  const addBtn = document.getElementById('mp-add');
  if(addBtn) addBtn.addEventListener('click', mpAdd);

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
      }])
    });
    if(!res.ok){
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.hint || ('Insert failed (' + res.status + ')'));
    }
    const rows = await res.json();
    if(rows && rows[0]) state.mpRows.unshift(rows[0]);
    state.mpRows.sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)) || (b.id - a.id));
    d.amount = ''; d.note = '';
    state.mpBusy = false;
    showToast(d.kind === 'out' ? 'Withdrawal recorded.' : 'Contribution added.');
  }catch(e){
    state.mpBusy = false;
    showToast('Could not save: ' + e.message, true);
  }
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
  if(isAdmin() && (!state.appUsers || !state.appUsers.length)){
    try{ await fetchAppUsers(); }catch(e){}
  }
}
