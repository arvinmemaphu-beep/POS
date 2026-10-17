function renderAdminSettings(){
  return `
  <div class="panel" style="max-width:520px; margin-bottom:16px;">
    <h2>Backup</h2>
    <div class="setup-note">I-download ang kopya ng LAHAT ng data sa isang Excel file: Products, Members, Sales, Sale Items, Consignments, Consignment Items, Ledger, Product Logs, at Users. Gawin ito paminsan-minsan (halimbawa, linggu-linggo) at itago ang file sa Google Drive o i-email sa sarili.</div>
    <button class="primary" id="btn-backup" style="width:auto; padding:9px 18px; margin-top:10px;">Download backup (Excel)</button>
    <div style="margin-top:10px; font-size:13px; color:var(--ink-dim);">${lastBackupText()}</div>
  </div>
  <div class="panel" style="max-width:520px;">
    <h2>Manage users</h2>
    <div class="setup-note">I-run ito nang isang beses (kailangan muna gumagana ang User access roles sa ibaba) para makapag-add ka ng user dito mismo sa app, at para makita ang listahan ng mga user:</div>
    <code style="display:block; white-space:pre-wrap; padding:10px; margin-top:10px;">alter table profiles add column if not exists email text;

drop policy if exists "admins can read all profiles" on profiles;
create policy "admins can read all profiles" on profiles for select to authenticated using (public.current_user_role() = 'admin');

drop policy if exists "admins can add profiles" on profiles;
create policy "admins can add profiles" on profiles for insert to authenticated with check (public.current_user_role() = 'admin');

drop policy if exists "admins can update profiles" on profiles;
create policy "admins can update profiles" on profiles for update to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

drop policy if exists "admins can remove profiles" on profiles;
create policy "admins can remove profiles" on profiles for delete to authenticated using (public.current_user_role() = 'admin');</code>
    <div class="setup-note" style="margin-top:10px;">Tip: kung naka-on ang <strong>Confirm email</strong> sa Supabase (Authentication &rarr; Providers &rarr; Email), kailangan munang i-confirm ng bagong user ang email niya bago siya makapag-login. Pwede mo itong i-off doon kung gusto mong instant makapag-login agad ang mga cashier/regular na idadagdag mo.</div>

    <div class="setup-note" style="margin-top:10px;"><strong>Fill in emails:</strong> ang mga user na ginawa mismo sa Supabase (hindi sa app na ito) ay walang email na naka-save dito. I-run ito nang isang beses para mapunan ang lahat, tapos pindutin ang Reload:</div>
    <code style="display:block; white-space:pre-wrap; padding:10px; margin-top:10px;">update public.profiles p
set email = u.email
from auth.users u
where u.id = p.user_id and (p.email is null or p.email = '');</code>

    <div class="setup-note" style="margin-top:10px;">Puwedeng palitan ng bawat user ang sarili niyang password gamit ang <strong>\uD83D\uDD11 Password</strong> button sa itaas (katabi ng Sign out). Kung nakalimutan ng user ang password, i-reset ito sa Supabase: Authentication \u2192 Users \u2192 tatlong tuldok sa user \u2192 <em>Send password recovery</em>, o gumawa ng bagong user.</div>

    <div class="row2" style="margin-top:14px;">
      <div class="field"><label>Full name</label><input id="nu-name" placeholder="e.g. Maria Santos" value="${escapeHtml(state.userDraft.name)}"></div>
      <div class="field"><label>Role</label>
        <select id="nu-role" class="field-input">
          <option value="cashier"${state.userDraft.role==='cashier'?' selected':''}>Cashier</option>
          <option value="viewer"${state.userDraft.role==='viewer'?' selected':''}>Regular (view only)</option>
          <option value="admin"${state.userDraft.role==='admin'?' selected':''}>Admin</option>
        </select>
      </div>
    </div>
    <div class="field"><label>Email</label><input id="nu-email" type="email" placeholder="user@example.com" value="${escapeHtml(state.userDraft.email)}"></div>
    <div class="field"><label>Password</label><input id="nu-password" type="password" placeholder="At least 6 characters" value="${escapeHtml(state.userDraft.password)}"></div>
    <button class="primary" id="btn-add-user" style="width:auto; padding:9px 18px;" ${state.userBusy ? 'disabled' : ''}>${state.userBusy ? 'Adding...' : 'Add user'}</button>

    <div style="margin-top:18px;">
      <h2 style="margin-bottom:10px; display:flex; align-items:center; justify-content:space-between; gap:10px;"><span>Current users</span><button class="ghost" id="btn-reload-users" style="padding:5px 10px; font-size:13px;">Reload</button></h2>
      <div id="user-list" class="product-list">${userRowsHtml()}</div>
    </div>

      <div style="border-top:1px solid var(--line); margin:18px 0 14px; padding-top:14px;">
        <h2>User access roles</h2>
        <div class="setup-note">This app uses Supabase Auth. Create users in Supabase Authentication, then add their role with the SQL below. Your account should be <strong>admin</strong>; cashiers should be <strong>cashier</strong>; regular users should be <strong>viewer</strong>.</div>
        <code style="display:block; white-space:pre-wrap; padding:10px; margin-top:10px;">create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'cashier' check (role in ('admin','cashier','viewer')) ,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','cashier','viewer'));

drop policy if exists "users can read own profile" on profiles;
create policy "users can read own profile" on profiles for select to authenticated using (auth.uid() = user_id);

-- Replace this UUID with your Supabase Auth user id:
insert into profiles (user_id, full_name, role)
values ('YOUR_AUTH_USER_UUID', 'Arvin', 'admin')
on conflict (user_id) do update set role = excluded.role;

-- Add each cashier using their Auth user id, or add a regular view-only user:
-- insert into profiles (user_id, full_name, role)
-- values ('CASHIER_AUTH_USER_UUID', 'Cashier name', 'cashier');
-- insert into profiles (user_id, full_name, role)
-- values ('VIEWER_AUTH_USER_UUID', 'Regular user name', 'viewer');

-- Viewers can read; Admins and Cashiers can write.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as 'select role from public.profiles where user_id = auth.uid();';

drop policy if exists "anon full access" on products;
drop policy if exists "authenticated full access" on products;
drop policy if exists "authenticated can read products" on products;
drop policy if exists "staff can write products" on products;
create policy "authenticated can read products" on products for select to authenticated using (true);
create policy "staff can write products" on products for all to authenticated using (public.current_user_role() in ('admin','cashier')) with check (public.current_user_role() in ('admin','cashier'));

drop policy if exists "anon full access" on sales;
drop policy if exists "authenticated full access" on sales;
drop policy if exists "authenticated can read sales" on sales;
drop policy if exists "staff can write sales" on sales;
create policy "authenticated can read sales" on sales for select to authenticated using (true);
create policy "staff can write sales" on sales for all to authenticated using (public.current_user_role() in ('admin','cashier')) with check (public.current_user_role() in ('admin','cashier'));

drop policy if exists "anon full access" on sale_items;
drop policy if exists "authenticated full access" on sale_items;
drop policy if exists "authenticated can read sale_items" on sale_items;
drop policy if exists "staff can write sale_items" on sale_items;
create policy "authenticated can read sale_items" on sale_items for select to authenticated using (true);
create policy "staff can write sale_items" on sale_items for all to authenticated using (public.current_user_role() in ('admin','cashier')) with check (public.current_user_role() in ('admin','cashier'));

drop policy if exists "anon full access" on consignments;
drop policy if exists "authenticated full access" on consignments;
drop policy if exists "authenticated can read consignments" on consignments;
drop policy if exists "staff can write consignments" on consignments;
create policy "authenticated can read consignments" on consignments for select to authenticated using (true);
create policy "staff can write consignments" on consignments for all to authenticated using (public.current_user_role() in ('admin','cashier')) with check (public.current_user_role() in ('admin','cashier'));

drop policy if exists "anon full access" on consignment_items;
drop policy if exists "authenticated full access" on consignment_items;
drop policy if exists "authenticated can read consignment_items" on consignment_items;
drop policy if exists "staff can write consignment_items" on consignment_items;
create policy "authenticated can read consignment_items" on consignment_items for select to authenticated using (true);
create policy "staff can write consignment_items" on consignment_items for all to authenticated using (public.current_user_role() in ('admin','cashier')) with check (public.current_user_role() in ('admin','cashier'));</code>
        <div class="setup-note">After running this SQL, sign out and sign in again. The Settings tab is hidden and blocked for Cashier and Regular accounts.</div>
      </div>

      <div style="border-top:1px solid var(--line); margin:18px 0 14px; padding-top:14px;">
        <h2>Product discounts</h2>
        <div class="setup-note">Gusto mo bang may fixed discount ang bawat product (₱ off per piece)? I-run ito nang isang beses sa SQL editor. Kapag tapos na, automatic na lalabas ang Discount field sa Add/Edit product at ibabawas na ito sa presyo sa Sell tab — walang kailangang i-type pa ang cashier.</div>
        <code style="display:block; white-space:pre-wrap; padding:10px; margin-top:10px;">alter table products add column if not exists discount numeric not null default 0;</code>
      </div>

      <div style="border-top:1px solid var(--line); margin:18px 0 14px; padding-top:14px;">
        <h2>Members</h2>
        <div class="setup-note">Run this once in the SQL editor so the Members tab works. Ito ay directory lang ng mga miyembro &mdash; hindi umaapekto sa sales, products, o consignment. I-run muna ang <strong>User access roles</strong> SQL sa itaas (kailangan ng <code>current_user_role()</code> function) bago ito.</div>
        <code style="display:block; white-space:pre-wrap; padding:10px; margin-top:10px;">create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  share_capital numeric not null default 0,
  created_at timestamptz default now()
);

alter table members enable row level security;

create policy "authenticated can read members" on members for select to authenticated using (true);
create policy "staff can write members" on members for all to authenticated using (public.current_user_role() in ('admin','cashier')) with check (public.current_user_role() in ('admin','cashier'));</code>
      </div>

      <div style="border-top:1px solid var(--line); margin:18px 0 14px; padding-top:14px;">
        <h2>Consignment member discount</h2>
        <div class="setup-note">Gusto mo bang may discount din pag-settle ng consignment, kapag Member ang kumuha? I-run ito nang isang beses (kailangan muna gumagana ang Members at Product discounts sa itaas). Kapag tapos na, lalabas ang Member dropdown sa "Send items out", at awtomatikong ibabawas ang discount sa presyo pag na-settle na kung Member ang naka-tag doon.</div>
        <code style="display:block; white-space:pre-wrap; padding:10px; margin-top:10px;">alter table consignments add column if not exists member_id uuid references members(id);</code>
      </div>

      <div style="border-top:1px solid var(--line); margin:18px 0 14px; padding-top:14px;">
        <h2>Allow deleting old products/members</h2>
        <div class="setup-note">Kung may products o members kang hindi ma-delete (na-block na may error), ito ang dahilan: naka-link na sila sa isang lumang sale o consignment, at hindi pa pinapayagan ni Postgres na burahin ang record na 'yun. I-run ito nang isang beses sa SQL editor &mdash; mananatili pa rin ang sales/consignment history mo, magiging blangko lang ang link kapag na-delete mo na ang product o member.</div>
        <code style="display:block; white-space:pre-wrap; padding:10px; margin-top:10px;">alter table sale_items drop constraint if exists sale_items_product_id_fkey;
alter table sale_items add constraint sale_items_product_id_fkey
  foreign key (product_id) references products(id) on delete set null;

alter table consignment_items drop constraint if exists consignment_items_product_id_fkey;
alter table consignment_items add constraint consignment_items_product_id_fkey
  foreign key (product_id) references products(id) on delete set null;

alter table consignments drop constraint if exists consignments_member_id_fkey;
alter table consignments add constraint consignments_member_id_fkey
  foreign key (member_id) references members(id) on delete set null;</code>
      </div>

      <div style="border-top:1px solid var(--line); margin:18px 0 14px; padding-top:14px;">
        <h2>Restrict deleting products to Admin only</h2>
        <div class="setup-note">Kapag pinaandar na ito, si Cashier ay puwede pa ring magdagdag/mag-edit ng products, pero HINDI na siya makakapag-delete &mdash; Admin na lang. Ito ay para hindi na-aalala ang matanggal ang products na may naka-link nang sales o consignment history. I-run ito nang isang beses sa SQL editor.</div>
        <code style="display:block; white-space:pre-wrap; padding:10px; margin-top:10px;">drop policy if exists "staff can write products" on products;
create policy "staff can insert products" on products for insert to authenticated with check (public.current_user_role() in ('admin','cashier'));
create policy "staff can update products" on products for update to authenticated using (public.current_user_role() in ('admin','cashier')) with check (public.current_user_role() in ('admin','cashier'));
create policy "admin can delete products" on products for delete to authenticated using (public.current_user_role() = 'admin');</code>
      </div>

      <div style="border-top:1px solid var(--line); margin:18px 0 14px; padding-top:14px;">
        <h2>Ledger (Balance Sheet)</h2>
        <div class="setup-note">I-run ito nang isang beses para gumana ang Ledger tab. Awtomatikong pumapasok dito ang bawat Sale bilang "in". Puwedeng magdagdag ng manual entries (bills, salary, atbp.) ang Admin at Cashier.</div>
        <code style="display:block; white-space:pre-wrap; padding:10px; margin-top:10px;">create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date,
  qty text,
  details text not null,
  pic text,
  amount_in numeric not null default 0,
  amount_out numeric not null default 0,
  source text not null default 'manual',
  sale_id uuid references sales(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table ledger_entries enable row level security;

drop policy if exists "authenticated can read ledger" on ledger_entries;
drop policy if exists "staff can write ledger" on ledger_entries;
create policy "authenticated can read ledger" on ledger_entries for select to authenticated using (true);
create policy "staff can write ledger" on ledger_entries for all to authenticated using (public.current_user_role() in ('admin','cashier')) with check (public.current_user_role() in ('admin','cashier'));</code>
      </div>

      <div style="border-top:1px solid var(--line); margin:18px 0 14px; padding-top:14px;">
        <h2>Ledger: cash deposits</h2>
        <div class="setup-note">I-run ito nang isang beses para may "CASH DEPOSIT" checkbox sa Add entry form ng Ledger. Kapag chinek ito sa isang Out entry (hal. cash na dinala sa bangko), mananatili pa rin ito sa Ledger balance pero HINDI na isasama sa Expense Report &mdash; dahil transfer lang ito ng pera, hindi gastos. Para sa mga LUMANG entry na dati nang naidagdag bilang expense: pumunta sa Ledger tab, Admin lang ang makakakita ng \u270E button sa tabi ng bawat Out entry &mdash; i-tap iyon para markahan (o i-unmark) na deposit.</div>
        <code style="display:block; white-space:pre-wrap; padding:10px; margin-top:10px;">alter table ledger_entries add column if not exists is_deposit boolean not null default false;</code>
      </div>

      <div style="border-top:1px solid var(--line); margin:18px 0 14px; padding-top:14px;">
        <h2>Freebies (libre)</h2>
        <div class="setup-note">I-run ito nang isang beses para magamit ang \uD83C\uDF81 Free button sa Sell tab. Kapag nagbigay ng libre (free token, gift, free taste), ire-record ito na \u20B10.00 kasama ang remarks, at lalabas sa Daily, History, at Monthly report. Hindi ito isasama sa sales total.</div>
        <code style="display:block; white-space:pre-wrap; padding:10px; margin-top:10px;">alter table sale_items add column if not exists is_free boolean not null default false;
alter table sale_items add column if not exists free_remarks text;
notify pgrst, 'reload schema';</code>
      </div>

      <div style="border-top:1px solid var(--line); margin:18px 0 14px; padding-top:14px;">
        <h2>Delete user</h2>
        <div class="setup-note">I-run ito nang isang beses para gumana ang \u2715 button sa Manage users. Buburahin nito nang buo ang user (login at role). Admin lang ang makakagamit, at hindi mo mabubura ang sarili mong account.</div>
        <code style="display:block; white-space:pre-wrap; padding:10px; margin-top:10px;">create or replace function public.admin_delete_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;
  if target = auth.uid() then
    raise exception 'You cannot delete your own account';
  end if;
  delete from public.profiles where user_id = target;
  delete from auth.users where id = target;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;
notify pgrst, 'reload schema';</code>
      </div>

      <div style="border-top:1px solid var(--line); margin:18px 0 14px; padding-top:14px;">
        <h2>Void (Admin lang)</h2>
        <div class="setup-note">I-run ito nang isang beses para gumana ang <b>Void</b>: sa Sales History, sa Consign (naipadala pa lang o na-settle na), at sa manual na Ledger entries. Walang binubura &mdash; namamarkahang VOIDED ito kasama ang dahilan, kung sino, at kailan. Hindi na isasama sa Daily/Monthly report, Expense report at Ledger balance. Ang settlement ng consignment na na-void ay babalik sa &ldquo;Out&rdquo; para ma-settle ulit nang tama.</div>
        <code style="display:block; white-space:pre-wrap; padding:10px; margin-top:10px;">alter table sales add column if not exists voided boolean not null default false;
alter table sales add column if not exists void_reason text;
alter table sales add column if not exists voided_at timestamptz;
alter table sales add column if not exists voided_by text;

alter table ledger_entries add column if not exists voided boolean not null default false;
alter table ledger_entries add column if not exists void_reason text;
alter table ledger_entries add column if not exists voided_at timestamptz;
alter table ledger_entries add column if not exists voided_by text;

alter table consignments add column if not exists voided boolean not null default false;
alter table consignments add column if not exists void_reason text;
alter table consignments add column if not exists voided_at timestamptz;
alter table consignments add column if not exists voided_by text;
alter table consignments add column if not exists settle_sale_id uuid references sales(id) on delete set null;

drop policy if exists "admin can void sales" on sales;
create policy "admin can void sales" on sales for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists "admin can void consignments" on consignments;
create policy "admin can void consignments" on consignments for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

notify pgrst, 'reload schema';</code>
      </div>

      <div style="border-top:1px solid var(--line); margin:18px 0 14px; padding-top:14px;">
        <h2>Consign: Missing items</h2>
        <div class="setup-note">I-run ito nang isang beses. Kapag may kulang sa consignment, mananatili itong <b>Missing</b> (hindi Closed). Puwede pa itong i-transact: <b>Bayad</b> (bagong sale + Ledger entry) o <b>Nakita</b> (balik sa stock). Closed lang kapag wala nang kulang. May Void din ang bawat record (Admin).</div>
        <code style="display:block; white-space:pre-wrap; padding:10px; margin-top:10px;">create table if not exists consignment_events (
  id uuid primary key default gen_random_uuid(),
  consignment_id uuid not null references consignments(id) on delete cascade,
  kind text not null,
  items jsonb not null default '[]'::jsonb,
  total numeric not null default 0,
  sale_id uuid references sales(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now(),
  voided boolean not null default false,
  void_reason text,
  voided_at timestamptz,
  voided_by text
);

alter table consignment_events enable row level security;

drop policy if exists "authenticated can read consignment events" on consignment_events;
drop policy if exists "staff can add consignment events" on consignment_events;
drop policy if exists "admin can void consignment events" on consignment_events;
create policy "authenticated can read consignment events" on consignment_events for select to authenticated using (true);
create policy "staff can add consignment events" on consignment_events for insert to authenticated
  with check (public.current_user_role() in ('admin','cashier'));
create policy "admin can void consignment events" on consignment_events for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

notify pgrst, 'reload schema';</code>
      </div>
    </div>
  </div>`;
}
