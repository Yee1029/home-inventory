-- Home Inventory v1 — run in a NEW Supabase project's SQL Editor.
-- Public users can only call public_expiry_list(); all underlying tables are protected by RLS.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text,
  category_id uuid references public.categories(id) on delete set null,
  unit text not null default '個',
  location_id uuid references public.storage_locations(id) on delete set null,
  low_stock_threshold numeric(12,3),
  expiry_reminder_days integer not null default 30 check (expiry_reminder_days >= 0),
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete restrict,
  batch_label text,
  received_date date not null default current_date,
  received_quantity numeric(12,3) not null check (received_quantity > 0),
  remaining_quantity numeric(12,3) not null check (remaining_quantity >= 0),
  expiry_date date,
  opened_date date,
  opened_use_by_date date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (remaining_quantity <= received_quantity)
);

create table if not exists public.stock_transactions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete restrict,
  batch_id uuid references public.inventory_batches(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('receive','consume','discard','adjustment')),
  quantity numeric(12,3) not null check (quantity > 0),
  quantity_delta numeric(12,3) not null,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_items_category on public.items(category_id);
create index if not exists idx_batches_item on public.inventory_batches(item_id);
create index if not exists idx_batches_expiry on public.inventory_batches(expiry_date);
create index if not exists idx_transactions_item_created on public.stock_transactions(item_id, created_at desc);

-- Admin check. The profile table itself is not publicly readable.
create or replace function public.is_inventory_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid()) and p.is_admin = true
  );
$$;

-- Public function intentionally exposes only item name, category, expiry date and status.
-- No quantities, storage locations, notes, or transaction history are returned.
create or replace function public.public_expiry_list()
returns table (
  item_name text,
  category_name text,
  expiry_date date,
  expiry_status text
)
language sql stable security definer
set search_path = ''
as $$
  select i.name,
         coalesce(c.name, '未分類') as category_name,
         b.expiry_date,
         case when b.expiry_date < current_date then '已過期'
              else '即將到期' end as expiry_status
  from public.inventory_batches b
  join public.items i on i.id = b.item_id
  left join public.categories c on c.id = i.category_id
  where i.is_active = true
    and b.remaining_quantity > 0
    and b.expiry_date is not null
    and (b.expiry_date < current_date or b.expiry_date <= current_date + i.expiry_reminder_days)
  order by b.expiry_date asc, i.name asc;
$$;

-- Atomic consume/discard operation: prevents negative inventory and records history.
create or replace function public.inventory_remove(
  p_batch_id uuid,
  p_quantity numeric,
  p_type text,
  p_reason text default null
)
returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_batch public.inventory_batches%rowtype;
begin
  if not public.is_inventory_admin() then
    raise exception '管理者權限不足';
  end if;
  if p_type not in ('consume','discard') then
    raise exception '不支援的異動類型';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception '數量必須大於 0';
  end if;
  select * into v_batch from public.inventory_batches where id = p_batch_id for update;
  if not found then raise exception '找不到庫存批次'; end if;
  if v_batch.remaining_quantity < p_quantity then raise exception '庫存不足'; end if;
  update public.inventory_batches
    set remaining_quantity = remaining_quantity - p_quantity
    where id = p_batch_id;
  insert into public.stock_transactions(item_id,batch_id,transaction_type,quantity,quantity_delta,reason,created_by)
    values (v_batch.item_id,p_batch_id,p_type,p_quantity,-p_quantity,p_reason,(select auth.uid()));
end;
$$;

-- Atomic initial/subsequent receiving: creates a batch and its transaction together.
create or replace function public.inventory_receive(
  p_item_id uuid,
  p_quantity numeric,
  p_expiry_date date default null,
  p_received_date date default current_date,
  p_batch_label text default null,
  p_opened_date date default null,
  p_opened_use_by_date date default null,
  p_notes text default null
)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_batch_id uuid;
begin
  if not public.is_inventory_admin() then raise exception '管理者權限不足'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception '入庫數量必須大於 0'; end if;
  if not exists (select 1 from public.items where id = p_item_id and is_active = true) then
    raise exception '物品不存在或已停用';
  end if;
  insert into public.inventory_batches(item_id,batch_label,received_date,received_quantity,remaining_quantity,expiry_date,opened_date,opened_use_by_date,notes,created_by)
    values (p_item_id,p_batch_label,coalesce(p_received_date,current_date),p_quantity,p_quantity,p_expiry_date,p_opened_date,p_opened_use_by_date,p_notes,(select auth.uid()))
    returning id into v_batch_id;
  insert into public.stock_transactions(item_id,batch_id,transaction_type,quantity,quantity_delta,reason,created_by)
    values (p_item_id,v_batch_id,'receive',p_quantity,p_quantity,'入庫',(select auth.uid()));
  return v_batch_id;
end;
$$;

-- RLS on every table. Anon users have no direct table access.
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.storage_locations enable row level security;
alter table public.items enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.stock_transactions enable row level security;

drop policy if exists "profile self read" on public.profiles;
create policy "profile self read" on public.profiles for select to authenticated using (user_id = (select auth.uid()) or public.is_inventory_admin());
drop policy if exists "admin manage categories" on public.categories;
create policy "admin manage categories" on public.categories for all to authenticated using (public.is_inventory_admin()) with check (public.is_inventory_admin());
drop policy if exists "admin manage locations" on public.storage_locations;
create policy "admin manage locations" on public.storage_locations for all to authenticated using (public.is_inventory_admin()) with check (public.is_inventory_admin());
drop policy if exists "admin manage items" on public.items;
create policy "admin manage items" on public.items for all to authenticated using (public.is_inventory_admin()) with check (public.is_inventory_admin());
drop policy if exists "admin manage batches" on public.inventory_batches;
create policy "admin manage batches" on public.inventory_batches for all to authenticated using (public.is_inventory_admin()) with check (public.is_inventory_admin());
drop policy if exists "admin manage transactions" on public.stock_transactions;
create policy "admin manage transactions" on public.stock_transactions for all to authenticated using (public.is_inventory_admin()) with check (public.is_inventory_admin());

-- Grant only the intended public function and authenticated admin functions.
-- PostgreSQL grants EXECUTE on newly created functions to PUBLIC by default, so revoke that explicitly.
revoke all on function public.public_expiry_list() from public;
revoke all on function public.is_inventory_admin() from public;
revoke all on function public.inventory_receive(uuid,numeric,date,date,text,date,date,text) from public;
revoke all on function public.inventory_remove(uuid,numeric,text,text) from public;
revoke all on public.profiles, public.categories, public.storage_locations, public.items, public.inventory_batches, public.stock_transactions from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.categories, public.storage_locations, public.items, public.inventory_batches, public.stock_transactions to authenticated;
grant execute on function public.public_expiry_list() to anon, authenticated;
grant execute on function public.is_inventory_admin() to authenticated;
grant execute on function public.inventory_receive(uuid,numeric,date,date,text,date,date,text) to authenticated;
grant execute on function public.inventory_remove(uuid,numeric,text,text) to authenticated;

-- Bootstrap steps are in README.md. Do not set an admin user by trusting a browser-provided flag.
