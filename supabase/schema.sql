-- Грабелька: one generic table of JSON documents, same shape as the Claude artifact database.
-- Run once in Supabase → SQL Editor. Then enable Authentication → Sign In / Providers → "Allow anonymous sign-ins".

create table if not exists public.docs (
  coll       text        not null,   -- 'farms', 'farms/<farmId>/products', 'verified', 'orders'
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);

create table if not exists public.admins (uid uuid primary key);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.admins where uid = auth.uid()) $$;

-- the farm a document belongs to ('farms/<id>' or 'farms/<id>/products/...')
create or replace function public.doc_farm(c text, i text) returns text
language sql immutable as
$$ select case when c = 'farms' then i when c like 'farms/%/products' then split_part(c, '/', 2) end $$;

alter table public.docs   enable row level security;
alter table public.admins enable row level security;

drop policy if exists "admins see themselves" on public.admins;
create policy "admins see themselves" on public.admins for select using (uid = auth.uid());

-- catalogue is public; orders are visible to the buyer, the farmer and admins
drop policy if exists "read" on public.docs;
create policy "read" on public.docs for select using (
  coll <> 'orders'
  or data->>'buyerUid' = auth.uid()::text
  or data->>'farmId'   = auth.uid()::text
  or public.is_admin()
);

-- a farmer writes only their own farm and products; admins write everything
drop policy if exists "write farms" on public.docs;
create policy "write farms" on public.docs for all
  using      (public.doc_farm(coll, id) = auth.uid()::text or public.is_admin())
  with check (public.doc_farm(coll, id) = auth.uid()::text or public.is_admin());

-- buyers create their own orders; buyer and farmer may change the status
drop policy if exists "create orders" on public.docs;
create policy "create orders" on public.docs for insert
  with check (coll = 'orders' and data->>'buyerUid' = auth.uid()::text);

drop policy if exists "update orders" on public.docs;
create policy "update orders" on public.docs for update
  using      (coll = 'orders' and (data->>'buyerUid' = auth.uid()::text or data->>'farmId' = auth.uid()::text or public.is_admin()))
  with check (coll = 'orders' and (data->>'buyerUid' = auth.uid()::text or data->>'farmId' = auth.uid()::text or public.is_admin()));

-- only admins mark farms as verified
drop policy if exists "write verified" on public.docs;
create policy "write verified" on public.docs for all
  using (coll = 'verified' and public.is_admin()) with check (coll = 'verified' and public.is_admin());

-- live updates
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- After opening the site once, copy «Ваш ID» from Профиль and make yourself admin:
-- insert into public.admins (uid) values ('<your id>');
