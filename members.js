/* ---------- Members ---------- */

async function fetchMembers(){
  if(!state.connected) return;
  state.loading = true; render();
  try{
    const all = [];
    const PAGE = 1000;
    for(let offset = 0; ; offset += PAGE){
      const res = await fetch(`${state.supaUrl}/rest/v1/members?select=*&order=full_name.asc,id.asc&limit=${PAGE}&offset=${offset}`, { headers: supaHeaders() });
      if(!res.ok) throw new Error('Failed to load members. If the members table does not exist yet, run the Members SQL in Settings first.');
      const batch = await res.json();
      all.push(...batch);
      if(batch.length < PAGE) break;
    }
    state.members = all;
  }catch(e){
    showToast('Could not load members: ' + e.message, true);
  }
  state.loading = false; render();
}

async function addMember(fullName, phone){
  if(blockViewer()) return;
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/members`, {
      method:'POST', headers: supaHeaders(),
      body: JSON.stringify([{ full_name: fullName, phone: phone || null }])
    });
    if(!res.ok){
      const errBody = await res.json().catch(()=>({}));
      throw new Error(errBody.message || errBody.hint || `Insert failed (${res.status})`);
    }
    await fetchMembers();
    showToast('Member added.');
  }catch(e){
    showToast('Could not add member: ' + e.message, true);
  }
}

async function updateMember(id, fullName, phone){
  if(blockViewer()) return;
  if(!fullName){ showToast('Enter the member name.', true); return; }
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/members?id=eq.${id}`, {
      method:'PATCH', headers: supaHeaders(),
      body: JSON.stringify({ full_name: fullName, phone: phone || null })
    });
    if(!res.ok){
      const errBody = await res.json().catch(()=>({}));
      throw new Error(errBody.message || errBody.hint || `Update failed (${res.status})`);
    }
    state.editingMember = null;
    await fetchMembers();
    showToast('Member updated.');
  }catch(e){
    showToast('Could not update member: ' + e.message, true);
  }
}

async function deleteMember(id){
  if(blockViewer()) return;
  const who = state.members.find(m => m.id === id);
  if(!confirm('Sigurado ka bang buburahin si ' + (who ? who.full_name : 'member na ito') + '? Hindi na ito maibabalik.')) return;
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/members?id=eq.${id}`, {
      method:'DELETE', headers: supaHeaders()
    });
    if(!res.ok) throw new Error('Delete failed');
    state.members = state.members.filter(m=>m.id!==id);
    render();
  }catch(e){
    showToast('Could not delete member: ' + e.message, true);
  }
}

/* Excel / CSV import of members */
function normName(n){ return String(n||'').replace(/\s+/g,' ').trim().toLowerCase(); }
function cleanCell(v){ return String(v == null ? '' : v).replace(/\s+/g,' ').trim(); }
function cleanPhone(v){
  if(v == null || v === '') return '';
  if(typeof v === 'number'){
    let t = String(Math.round(v));
    if(/^9\d{9}$/.test(t)) t = '0' + t; // Excel drops the leading 0 of 09xx numbers
    return t;
  }
  return cleanCell(v);
}
function parseMemberRows(rows){
  // rows: array of arrays. Returns [{name, phone}]
  rows = (rows || []).map(r => Array.isArray(r) ? r : []);
  const KW = /name|pangalan|member|miyembro|phone|contact|mobile|cell|\bcp\b|\btel/i;
  // header row = the row (in the first 12) with the most keyword cells
  let hdrIdx = -1, best = 0;
  for(let i = 0; i < Math.min(rows.length, 12); i++){
    const sc = rows[i].filter(c => typeof c === 'string' && KW.test(c)).length;
    if(sc > best){ best = sc; hdrIdx = i; }
  }
  const start = hdrIdx >= 0 ? hdrIdx + 1 : 0;
  const data = rows.slice(start);
  const width = Math.max(0, ...rows.map(r => r.length));

  // column statistics from the actual data
  const isPhoneLike = v => (typeof v === 'number' && v >= 1000000) || (typeof v === 'string' && /^\+?[\d\s\-().]{7,}$/.test(v.trim()));
  const stats = [];
  for(let c = 0; c < width; c++){
    let alpha = 0, phone = 0, filled = 0;
    data.forEach(r => {
      const v = r[c];
      if(v === '' || v == null) return;
      filled++;
      if(typeof v === 'string' && /[A-Za-z\u00C0-\u024F]/.test(v)) alpha++;
      if(isPhoneLike(v)) phone++;
    });
    stats.push({ alpha, phone, filled });
  }
  const bestBy = (key, skip) => {
    let idx = -1, max = 0;
    stats.forEach((st, c) => { if(skip.includes(c)) return; if(st[key] > max){ max = st[key]; idx = c; } });
    return idx;
  };
  const textual = c => c >= 0 && stats[c] && stats[c].filled > 0 && stats[c].alpha / stats[c].filled >= 0.5;

  let nameCol = -1, phoneCol = -1, firstCol = -1, lastCol = -1;
  if(hdrIdx >= 0){
    const h = rows[hdrIdx].map(c => cleanCell(c).toLowerCase());
    const find = (re, not) => h.findIndex(x => re.test(x) && !(not && not.test(x)));
    firstCol = find(/first|given/);
    lastCol  = find(/last|surname|apelyido/);
    nameCol  = find(/full.?name|^names?\b|name of|pangalan/, /last|first|middle/);
    if(nameCol < 0) nameCol = find(/member|miyembro|name/, /\bid\b|\bno\b|number|code|last|first|middle/);
    phoneCol = find(/phone|contact|mobile|cell|\bcp\b|\btel/);
    if(phoneCol < 0) phoneCol = find(/number/, /\bid\b/);
    if(phoneCol === nameCol) phoneCol = -1;
  }
  // verify the header-picked name column really holds names; otherwise pick by content
  const haveSplit = firstCol >= 0 || lastCol >= 0;
  if(!haveSplit){
    if(!textual(nameCol)) nameCol = bestBy('alpha', []);
  }
  if(phoneCol < 0 || stats[phoneCol] && stats[phoneCol].phone === 0 && stats[phoneCol].filled > 0 && stats[phoneCol].alpha > 0){
    phoneCol = bestBy('phone', [nameCol, firstCol, lastCol]);
  }
  if(nameCol < 0 && !haveSplit) return [];

  const out = [];
  data.forEach(r => {
    let name = nameCol >= 0 ? cleanCell(r[nameCol]) : '';
    if(haveSplit && (!name || nameCol < 0)){
      name = [firstCol >= 0 ? cleanCell(r[firstCol]) : '', lastCol >= 0 ? cleanCell(r[lastCol]) : ''].filter(Boolean).join(' ');
    }
    if(!name || !/[A-Za-z\u00C0-\u024F]/.test(name)) return;   // skip blank / number-only rows
    out.push({ name, phone: phoneCol >= 0 ? cleanPhone(r[phoneCol]) : '' });
  });
  return out;
}
async function importMembersFile(file){
  if(blockViewer() || !file) return;
  try{
    showToast('Binabasa ang file...');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    let parsed = [];
    for(const sn of wb.SheetNames){
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: true });
      parsed = parseMemberRows(rows);
      if(parsed.length) break;
    }
    if(!parsed.length){ showToast('Walang nakitang pangalan sa file.', true); return; }

    const seen = new Set(state.members.map(m => normName(m.full_name)));
    const fresh = [];
    let dupes = 0;
    parsed.forEach(r => {
      const k = normName(r.name);
      if(seen.has(k)){ dupes++; return; }
      seen.add(k);
      fresh.push({ full_name: r.name, phone: r.phone || null });
    });
    if(!fresh.length){ showToast('Lahat ng pangalan sa file ay nasa listahan na (' + dupes + ' skipped).', true); return; }
    const sample = fresh.slice(0, 3).map(m => '• ' + m.full_name + (m.phone ? ' — ' + m.phone : '')).join('\n');
    if(!confirm('Mag-import ng ' + fresh.length + ' bagong members' + (dupes ? ' (' + dupes + ' skipped dahil nasa listahan na)' : '') + '?\n\nHalimbawa:\n' + sample + '\n\nKung mali ang pangalan/contact, pindutin ang Cancel.')) return;

    state.busy = true;
    for(let i = 0; i < fresh.length; i += 500){
      const res = await fetch(`${state.supaUrl}/rest/v1/members`, {
        method: 'POST',
        headers: Object.assign({}, supaHeaders(), { 'Prefer': 'return=minimal' }),
        body: JSON.stringify(fresh.slice(i, i + 500))
      });
      if(!res.ok){
        const errBody = await res.json().catch(()=>({}));
        throw new Error((errBody.message || errBody.hint || 'Insert failed (' + res.status + ')') + (i ? ' — ' + i + ' members ang na-save na bago ito.' : ''));
      }
    }
    state.busy = false;
    await fetchMembers();
    showToast('Na-import: ' + fresh.length + ' members' + (dupes ? ' (' + dupes + ' skipped)' : '') + '. Total: ' + state.members.length);
  }catch(e){
    state.busy = false;
    await fetchMembers();
    showToast('Import failed: ' + e.message, true);
  }
}
function downloadMemberTemplate(){
  const ws = XLSX.utils.json_to_sheet([
    { 'Full name': 'Juan Dela Cruz', 'Contact number': '09171234567' },
    { 'Full name': 'Maria Santos', 'Contact number': '' }
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Members');
  XLSX.writeFile(wb, 'CCFACO-Members-Template.xlsx');
}

function filteredMembers(){
  const q = state.memberSearch.trim().toLowerCase();
  if(!q) return state.members;
  return state.members.filter(m =>
    String(m.full_name||'').toLowerCase().includes(q) ||
    String(m.phone||'').toLowerCase().includes(q));
}

function memberRowHtml(m){
  return '<div class="product-row" data-medit="' + m.id + '">' +
    '<div><div class="name">' + escapeHtml(m.full_name) + '</div><div class="meta">' + (m.phone ? escapeHtml(m.phone) : 'No contact number') + '</div></div>' +
    '<div style="display:flex; align-items:center; gap:10px;">' +
    (isViewer() ? '' : '<button class="icon-btn" data-mdel="' + m.id + '" title="Delete">✕</button>') + '</div></div>';
}

function memberCountHtml(){
  const total = state.members.length;
  const q = state.memberSearch.trim();
  if(q) return 'Showing <strong style="color:var(--ink);">' + filteredMembers().length + '</strong> of ' + total + ' members';
  return 'Total members: <strong style="color:var(--gold); font-size:18px;">' + total + '</strong>';
}

function memberRowsHtml(){
  return filteredMembers().map(memberRowHtml).join('') ||
    (state.memberSearch.trim() ? '<div class="empty">No members match your search.</div>' : '<div class="empty">No members yet.</div>');
}

function wireMemberRows(){
  const app = document.getElementById('app');
  app.querySelectorAll('.product-row[data-medit]').forEach(r=>{
    r.addEventListener('click', (ev)=>{
      if(blockViewer()) return;
      if(ev.target.hasAttribute('data-mdel')) return;
      const m = state.members.find(x=>x.id===r.dataset.medit);
      if(m){ state.editingMember = { id: m.id, full_name: m.full_name, phone: m.phone }; render(); }
    });
  });
  app.querySelectorAll('[data-mdel]').forEach(b=>{
    b.addEventListener('click', (ev)=>{ ev.stopPropagation(); deleteMember(b.dataset.mdel); });
  });
}

function updateMemberList(){
  const listEl = document.getElementById('member-list');
  if(!listEl) return;
  listEl.innerHTML = memberRowsHtml();
  const countEl = document.getElementById('member-count');
  if(countEl) countEl.innerHTML = memberCountHtml();
  wireMemberRows();
}

function renderMembers(){
  const em = state.editingMember;
  const leftPanel = isViewer() ?
    '<h2>Members</h2><div class="setup-note">Regular access is view-only. Members cannot be added or changed here.</div>' :
    (em ?
      '<h2>Edit ' + escapeHtml(em.full_name) + '</h2>' +
      '<div class="field"><label>Full name</label><input id="em-name" value="' + escapeHtml(em.full_name) + '"></div>' +
      '<div class="field"><label>Contact number</label><input id="em-phone" value="' + escapeHtml(em.phone || '') + '"></div>' +
      '<button class="primary" id="btn-save-member">Save changes</button>' +
      '<div style="border-top:1px solid var(--line); margin:18px 0 14px;"></div>' +
      '<button class="ghost" id="btn-cancel-member" style="width:100%;">Done</button>' :
      '<h2>Add a member</h2>' +
      '<div class="field"><label>Full name</label><input id="nm-name" placeholder="e.g. Juan Dela Cruz"></div>' +
      '<div class="field"><label>Contact number</label><input id="nm-phone" placeholder="e.g. 0917 123 4567"></div>' +
      '<button class="primary" id="btn-add-member">Add member</button>' +
      '<div style="border-top:1px solid var(--line); margin:18px 0 14px;"></div>' +
      '<h2>Upload member list (Excel)</h2>' +
      '<div class="setup-note">Pumili ng Excel (.xlsx / .xls) o CSV file. Kukunin ang column na may <strong>Name</strong> at (kung meron) <strong>Contact / Phone</strong>. Kapag walang header, column A = pangalan, column B = contact. Ang mga pangalang nasa listahan na ay hindi na idadagdag ulit.</div>' +
      '<input id="in-member-file" type="file" accept=".xlsx,.xls,.csv" style="margin-top:10px;">' +
      '<button class="ghost" id="btn-member-template" style="width:100%; margin-top:10px;">Download sample Excel</button>');

  return '<div class="grid"><div class="panel">' + leftPanel + '</div><div class="panel">' +
    '<h2>All members <span style="font-weight:400; color:var(--ink-dim);">— ' + (isViewer() ? 'view only' : 'tap one to edit') + '</span></h2>' +
    '<div id="member-count" style="margin:-4px 0 10px; font-size:14px; color:var(--ink-dim);">' + memberCountHtml() + '</div>' +
    '<div class="field"><input id="in-member-search" placeholder="Search name or contact number..." value="' + escapeHtml(state.memberSearch) + '"></div>' +
    '<div class="product-list" id="member-list">' + memberRowsHtml() + '</div></div></div>';
}
