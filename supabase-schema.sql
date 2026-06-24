-- 店铺会员积分系统：Supabase 数据库初始化脚本
-- 在 Supabase Dashboard > SQL Editor 中完整执行一次。

create extension if not exists pgcrypto;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8)),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.store_memberships (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create table if not exists public.store_state (
  store_id uuid primary key references public.stores(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create or replace function public.is_store_member(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.store_memberships
    where store_id = target_store
      and user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_store(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.store_memberships
    where store_id = target_store
      and user_id = auth.uid()
      and role in ('owner', 'editor')
  );
$$;

create or replace function public.create_store(store_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_store_id uuid;
begin
  if auth.uid() is null then
    raise exception '请先登录';
  end if;

  insert into public.stores(name, owner_id)
  values (trim(store_name), auth.uid())
  returning id into new_store_id;

  insert into public.store_memberships(store_id, user_id, role)
  values (new_store_id, auth.uid(), 'owner');

  return new_store_id;
end;
$$;

create or replace function public.join_store(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_store_id uuid;
begin
  if auth.uid() is null then
    raise exception '请先登录';
  end if;

  select id into target_store_id
  from public.stores
  where invite_code = upper(trim(code));

  if target_store_id is null then
    raise exception '邀请码无效';
  end if;

  insert into public.store_memberships(store_id, user_id, role)
  values (target_store_id, auth.uid(), 'editor')
  on conflict (store_id, user_id) do nothing;

  return target_store_id;
end;
$$;

alter table public.stores enable row level security;
alter table public.store_memberships enable row level security;
alter table public.store_state enable row level security;

drop policy if exists "members can view stores" on public.stores;
create policy "members can view stores"
on public.stores for select
to authenticated
using (public.is_store_member(id));

drop policy if exists "users can view own memberships" on public.store_memberships;
create policy "users can view own memberships"
on public.store_memberships for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "members can view store state" on public.store_state;
create policy "members can view store state"
on public.store_state for select
to authenticated
using (public.is_store_member(store_id));

drop policy if exists "editors can create store state" on public.store_state;
create policy "editors can create store state"
on public.store_state for insert
to authenticated
with check (public.can_edit_store(store_id));

drop policy if exists "editors can update store state" on public.store_state;
create policy "editors can update store state"
on public.store_state for update
to authenticated
using (public.can_edit_store(store_id))
with check (public.can_edit_store(store_id));

revoke all on function public.create_store(text) from public;
revoke all on function public.join_store(text) from public;
grant execute on function public.create_store(text) to authenticated;
grant execute on function public.join_store(text) to authenticated;
grant execute on function public.is_store_member(uuid) to authenticated;
grant execute on function public.can_edit_store(uuid) to authenticated;

-- 让 store_state 的更新可被前端实时订阅。
do $$
begin
  alter publication supabase_realtime add table public.store_state;
exception
  when duplicate_object then null;
end $$;
