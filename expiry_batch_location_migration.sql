-- 效期提醒顯示每個批次的剩餘數量與存放位置
-- 以及新增入庫時可指定「本批存放位置」。請在 Supabase SQL Editor 執行一次。

alter table public.inventory_batches
  add column if not exists location_id uuid references public.storage_locations(id) on delete set null;

-- 舊批次沒有自己的位置時，先沿用物品管理所設定的預設位置。
update public.inventory_batches b
set location_id = i.location_id
from public.items i
where b.item_id = i.id and b.location_id is null and i.location_id is not null;

-- 移除舊版同名函式，避免 RPC 因多個相近簽章而無法判斷。
drop function if exists public.inventory_receive(uuid,numeric,date,date,text,date,date,text,numeric);
drop function if exists public.inventory_receive(uuid,numeric,date,date,text,date,date,text);

create function public.inventory_receive(
  p_item_id uuid,
  p_quantity numeric,
  p_expiry_date date default null,
  p_received_date date default current_date,
  p_batch_label text default null,
  p_opened_date date default null,
  p_opened_use_by_date date default null,
  p_notes text default null,
  p_purchase_total numeric default null,
  p_location_id uuid default null
)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_unit_cost numeric(12,2);
  v_purchase_total numeric(12,2);
  v_location_id uuid;
begin
  if not public.is_inventory_admin() then raise exception '管理者權限不足'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception '入庫數量必須大於 0'; end if;
  if p_purchase_total is not null and p_purchase_total < 0 then raise exception '購買金額不可小於 0'; end if;
  select unit_cost, location_id into v_unit_cost, v_location_id
  from public.items where id = p_item_id and is_active = true;
  if not found then raise exception '物品不存在或已停用'; end if;
  v_purchase_total := coalesce(p_purchase_total, v_unit_cost * p_quantity);
  v_location_id := coalesce(p_location_id, v_location_id);
  insert into public.inventory_batches(item_id,batch_label,received_date,received_quantity,remaining_quantity,expiry_date,opened_date,opened_use_by_date,notes,created_by,purchase_total,location_id)
    values (p_item_id,p_batch_label,coalesce(p_received_date,current_date),p_quantity,p_quantity,p_expiry_date,p_opened_date,p_opened_use_by_date,p_notes,(select auth.uid()),v_purchase_total,v_location_id)
    returning id into v_batch_id;
  insert into public.stock_transactions(item_id,batch_id,transaction_type,quantity,quantity_delta,reason,created_by)
    values (p_item_id,v_batch_id,'receive',p_quantity,p_quantity,'入庫',(select auth.uid()));
  return v_batch_id;
end;
$$;
revoke all on function public.inventory_receive(uuid,numeric,date,date,text,date,date,text,numeric,uuid) from public, anon;
grant execute on function public.inventory_receive(uuid,numeric,date,date,text,date,date,text,numeric,uuid) to authenticated;

-- 公開效期頁只額外提供批次數量、單位、位置與入庫日期，不公開備註或交易紀錄。
drop function if exists public.public_expiry_list();
create function public.public_expiry_list()
returns table (
  item_name text,
  category_name text,
  expiry_date date,
  expiry_status text,
  remaining_quantity numeric,
  unit text,
  location_name text,
  received_date date
)
language sql stable security definer
set search_path = ''
as $$
  select i.name,
         coalesce(c.name, '未分類') as category_name,
         b.expiry_date,
         case when b.expiry_date < current_date then '已過期' else '即將到期' end as expiry_status,
         b.remaining_quantity,
         i.unit,
         coalesce(bl.name, il.name, '未指定') as location_name,
         b.received_date
  from public.inventory_batches b
  join public.items i on i.id = b.item_id
  left join public.categories c on c.id = i.category_id
  left join public.storage_locations bl on bl.id = b.location_id
  left join public.storage_locations il on il.id = i.location_id
  where i.is_active = true
    and b.remaining_quantity > 0
    and b.expiry_date is not null
    and (b.expiry_date < current_date or b.expiry_date <= current_date + i.expiry_reminder_days)
  order by b.expiry_date asc, i.name asc;
$$;
revoke all on function public.public_expiry_list() from public;
grant execute on function public.public_expiry_list() to anon, authenticated;
