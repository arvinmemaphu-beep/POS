/* ---------- Users (admin-only) ---------- */
function roleDisplay(role){ return role === 'admin' ? 'Admin' : (role === 'viewer' ? 'Regular' : 'Cashier'); }

async function fetchAppUsers(){
  if(!state.connected || !isAdmin()) return;
  state.usersLoading = true; state.usersError = ''; render();
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/profiles?select=*`, { headers: supaHeaders() });
    if(!res.ok){
      const err = await res.json().catch(()=>({}));
      throw new Error((err.message || 'error ' + res.status) + ' (' + res.status + ')');
    }
    const rows = await res.json();
    rows.sort((x, y) => String(x.full_name || x.email || '').toLowerCase().localeCompare(String(y.full_name || y.email || '').toLowerCase()));
    state.appUsers = rows;
  }catch(e){
    state.usersError = e.message;
    showToast('Could not load users: ' + e.message, true);
  }
  state.usersLoading = false;
  render();
}

// Turn Supabase's error replies into something the admin can act on
function friendlyAuthError(payload, fallback){
  const code = String((payload && (payload.error_code || payload.code)) || '').toLowerCase();
  const raw = String((payload && (payload.msg || payload.message || payload.error_description || payload.error)) || '');
  const low = raw.toLowerCase();
  if(code.indexOf('rate_limit') >= 0 || low.indexOf('rate limit') >= 0 || low.indexOf('security purposes') >= 0)
    return 'Na-limit ng Supabase ang pagpapadala ng email (kaunti lang kada oras). I-off ang "Confirm email" sa Supabase (Authentication \u2192 Sign In / Providers \u2192 Email), o maghintay ng mga 1 oras at ulitin.';
  if(code === 'signup_disabled' || low.indexOf('signups not allowed') >= 0 || low.indexOf('signup is disabled') >= 0 || low.indexOf('signups are disabled') >= 0)
    return 'Naka-off ang Email signups sa Supabase. I-on ang "Allow new users to sign up" (Authentication \u2192 Sign In / Providers), o gumawa ng user sa Authentication \u2192 Users \u2192 Add user.';
  if(code === 'user_already_exists' || low.indexOf('already registered') >= 0 || low.indexOf('already been registered') >= 0)
    return 'Naka-register na ang email na ito.';
  if(code.indexOf('weak_password') >= 0 || low.indexOf('password should') >= 0 || low.indexOf('weak') >= 0)
    return 'Masyadong mahina ang password. Gumamit ng mas mahaba (6+ characters, mas maganda kung may numero).';
  if(low.indexOf('invalid') >= 0 && low.indexOf('email') >= 0) return 'Hindi valid ang email address.';
  return raw || fallback;
}

async function createUser(email, password, fullName, role){
  if(!isAdmin()) return false;
  if(!email || !password){ showToast('Enter an email and password.', true); return false; }
  if(password.length < 6){ showToast('Password should be at least 6 characters.', true); return false; }
  state.userBusy = true; render();
  try{
    const signupRes = await fetch(`${state.supaUrl}/auth/v1/signup`, {
      method:'POST',
      headers: { 'apikey': state.supaKey, 'Content-Type':'application/json' },
      body: JSON.stringify({ email, password })
    });
    const payload = await signupRes.json().catch(()=>({}));
    if(!signupRes.ok) throw new Error(friendlyAuthError(payload, 'Could not create the account (error ' + signupRes.status + ').'));
    const newUser = payload.user || payload;
    // With "Confirm email" on, Supabase hides duplicates by returning a user with no identities
    if(newUser && Array.isArray(newUser.identities) && newUser.identities.length === 0) throw new Error('Naka-register na ang email na ito.');
    const newUserId = newUser && newUser.id;
    if(!newUserId) throw new Error('Account created, but no user id came back. Check Supabase Authentication to confirm.');
    const profRes = await fetch(`${state.supaUrl}/rest/v1/profiles`, {
      method:'POST', headers: supaHeaders(),
      body: JSON.stringify([{ user_id: newUserId, full_name: fullName || null, role, email }])
    });
    if(!profRes.ok){
      const errBody = await profRes.json().catch(()=>({}));
      const m = String(errBody.message || '');
      if(profRes.status === 401 || profRes.status === 403 || m.toLowerCase().indexOf('row-level security') >= 0)
        throw new Error('Nagawa ang account pero hindi ma-save ang role: i-run ang "Manage users" SQL sa ibaba (Settings), tapos itakda ang role ng user.');
      throw new Error('Nagawa ang account pero hindi ma-save ang role (' + (m || errBody.hint || profRes.status) + ').');
    }
    state.userDraft = { name:'', role:'cashier', email:'', password:'' };
    const needsConfirm = !payload.access_token && !(payload.session && payload.session.access_token);
    showToast('User added as ' + roleDisplay(role) + '.' + (needsConfirm ? ' Kailangan niyang i-confirm ang email bago makapag-login.' : ''));
    await fetchAppUsers();
    return true;
  }catch(e){
    showToast('Could not add user: ' + e.message, true);
    return false;
  }finally{
    state.userBusy = false; render();
  }
}

/* ---------- Change own password ---------- */
function openPwPrompt(){
  if(!state.connected) return;
  state.pwPrompt = { cur:'', next:'', confirm:'', busy:false, focus:true };
  render();
}
async function changeOwnPassword(){
  const pp = state.pwPrompt;
  if(!pp || pp.busy) return;
  const email = state.user && state.user.email;
  if(!email){ showToast('Hindi makita ang email ng account. Mag-sign out at mag-sign in ulit.', true); return; }
  if(!pp.cur){ showToast('Ilagay ang kasalukuyang password.', true); return; }
  if(pp.next.length < 6){ showToast('Ang bagong password ay dapat 6 characters pataas.', true); return; }
  if(pp.next !== pp.confirm){ showToast('Hindi magkapareho ang bagong password at ang confirm.', true); return; }
  if(pp.next === pp.cur){ showToast('Dapat iba ang bagong password sa luma.', true); return; }
  pp.busy = true; render();
  try{
    // Re-sign in with the current password: it proves the person knows it, and gives a fresh session (Supabase may require one)
    const loginRes = await fetch(state.supaUrl + '/auth/v1/token?grant_type=password', {
      method:'POST', headers:{ 'apikey': state.supaKey, 'Content-Type':'application/json' },
      body: JSON.stringify({ email, password: pp.cur })
    });
    const loginPayload = await loginRes.json().catch(()=>({}));
    if(!loginRes.ok) throw new Error('Mali ang kasalukuyang password.');
    state.session = loginPayload; await saveSession();
    const res = await fetch(state.supaUrl + '/auth/v1/user', {
      method:'PUT',
      headers:{ 'apikey': state.supaKey, 'Authorization': 'Bearer ' + loginPayload.access_token, 'Content-Type':'application/json' },
      body: JSON.stringify({ password: pp.next })
    });
    const payload = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(friendlyAuthError(payload, 'Hindi napalitan ang password (error ' + res.status + ').'));
    state.pwPrompt = null;
    showToast('Napalitan na ang password mo.');
  }catch(e){
    if(state.pwPrompt) state.pwPrompt.busy = false;
    showToast(e.message, true);
  }
  render();
}
function pwModalMarkup(){
  const pp = state.pwPrompt;
  if(!pp) return '';
  return `
  <div class="free-scrim" id="pw-scrim"></div>
  <div class="free-modal" role="dialog" aria-modal="true" aria-label="Change password">
    <h2>\uD83D\uDD11 Change password</h2>
    <div class="setup-note" style="margin-bottom:12px;">Para sa account na <b>${escapeHtml(state.user && state.user.email ? state.user.email : '')}</b>. Ilagay muna ang kasalukuyang password.</div>
    <div class="field"><label>Current password</label><input id="pw-cur" type="password" autocomplete="current-password" value="${escapeHtml(pp.cur)}"></div>
    <div class="field"><label>New password (6+ characters)</label><input id="pw-new" type="password" autocomplete="new-password" value="${escapeHtml(pp.next)}"></div>
    <div class="field"><label>Confirm new password</label><input id="pw-confirm" type="password" autocomplete="new-password" value="${escapeHtml(pp.confirm)}"></div>
    <label style="display:flex; align-items:center; gap:8px; font-size:13.5px; color:var(--ink-dim); margin-top:2px;"><input type="checkbox" id="pw-show" style="width:auto;"> Ipakita ang password</label>
    <div style="display:flex; gap:8px; margin-top:14px;">
      <button class="primary" id="pw-save" style="flex:1; margin-top:0;" ${pp.busy ? 'disabled' : ''}>${pp.busy ? 'Saving...' : 'Save new password'}</button>
      <button class="ghost" id="pw-cancel" style="flex:1;">Cancel</button>
    </div>
  </div>`;
}

async function updateUserRole(userId, role){
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/profiles?user_id=eq.${userId}`, {
      method:'PATCH', headers: supaHeaders(),
      body: JSON.stringify({ role })
    });
    if(!res.ok) throw new Error('Update failed.');
    await fetchAppUsers();
    showToast('Role updated.');
  }catch(e){
    showToast('Could not update role: ' + e.message, true);
  }
}

// Deletes the user completely (login + role) through the admin_delete_user SQL function (see Settings SQL)
async function removeUserAccess(userId){
  if(!isAdmin()) return;
  if(state.user && state.user.id === userId){ showToast('Hindi mo puwedeng burahin ang sarili mong account.', true); return; }
  const u = (state.appUsers || []).find(x => x.user_id === userId);
  const who = u ? (u.full_name || u.email || 'user na ito') : 'user na ito';
  if(!confirm('Sigurado ka bang buburahin si ' + who + (u && u.email ? ' (' + u.email + ')' : '') + '?\n\nMawawala ang login niya at hindi na ito maibabalik.')) return;
  try{
    const res = await fetch(`${state.supaUrl}/rest/v1/rpc/admin_delete_user`, {
      method:'POST', headers: supaHeaders(),
      body: JSON.stringify({ target: userId })
    });
    if(!res.ok){
      const err = await res.json().catch(()=>({}));
      const m = String(err.message || '');
      if(res.status === 404 || err.code === 'PGRST202') throw new Error('I-run muna ang "Delete user" SQL sa Settings.');
      throw new Error(m || ('error ' + res.status));
    }
    state.appUsers = state.appUsers.filter(x=>x.user_id!==userId);
    render();
    showToast('User deleted.');
  }catch(e){
    showToast('Could not delete user: ' + e.message, true);
  }
}

function userRowHtml(u){
  const isMe = state.user && state.user.id === u.user_id;
  return '<div class="product-row" style="cursor:default;">' +
    '<div><div class="name">' + escapeHtml(u.full_name || u.email || 'Unnamed') + (isMe ? ' <span style="color:var(--ink-dim); font-size:12px;">(you)</span>' : '') + '</div>' +
    '<div class="meta">' + (u.email ? escapeHtml(u.email) : '<em>walang email na naka-save (tingnan ang "Fill in emails" SQL sa baba)</em>') + '</div></div>' +
    '<div style="display:flex; align-items:center; gap:8px;">' +
    '<select class="field-input" data-role-user="' + u.user_id + '" style="width:auto; padding:5px 8px; font-size:13px;">' +
      '<option value="admin"' + (u.role==='admin'?' selected':'') + '>Admin</option>' +
      '<option value="cashier"' + (u.role==='cashier'?' selected':'') + '>Cashier</option>' +
      '<option value="viewer"' + (u.role==='viewer'?' selected':'') + '>Regular</option>' +
    '</select>' +
    (isMe ? '' : '<button class="icon-btn" data-remove-user="' + u.user_id + '" title="Delete user">\u2715</button>') +
    '</div></div>';
}

function userRowsHtml(){
  if(state.usersLoading && !(state.appUsers||[]).length) return '<div class="empty">Loading users...</div>';
  let rows = (state.appUsers || []).slice();
  // always show at least your own account, even if the list could not be loaded
  if(!rows.length && state.user){
    rows = [{ user_id: state.user.id, full_name: null, email: state.user.email || '', role: state.role }];
  }
  let html = '';
  if(state.usersError){
    html += '<div class="setup-note" style="border-color:var(--red); margin-bottom:10px;"><strong>Hindi ma-load ang listahan ng users:</strong> ' + escapeHtml(state.usersError) + '<br>I-run ang <strong>Manage users</strong> SQL sa itaas (isang beses), tapos pindutin ang Reload.</div>';
  }else if(rows.length <= 1 && !state.usersLoading){
    html += '<div class="setup-note" style="margin-bottom:10px;">Ikaw lang ang nakikita. Kung may iba ka pang user na hindi lumalabas, i-run ang <strong>Manage users</strong> SQL sa itaas (isang beses), tapos pindutin ang Reload.</div>';
  }
  return html + (rows.map(userRowHtml).join('') || '<div class="empty">No users yet. Add one above.</div>');
}
