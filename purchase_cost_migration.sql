-- 家庭庫存管理：購買金額與消費分析功能升級
-- 請在 Supabase SQL Editor 執行一次；不要重新執行整份 schema.sql。
alter table public.items add column if not exists unit_cost numeric(12,2) check (unit_cost is null or unit_cost >= 0);
alter table public.inventory_batches add column if not exists purchase_total numeric(12,2) check (purchase_total is null or purchase_total >= 0);

-- 新增含購買總金額的入庫函式版本；舊函式保留，避免影響其他既有呼叫。
create or replace function public.inventory_receive(
  p_item_id uuid,
  p_quantity numeric,
  p_expiry_date date default null,
  p_received_date date default current_date,
  p_batch_label text default null,
  p_opened_date date default null,
  p_opened_use_by_date date default null,
  p_notes text default null,
  p_purchase_total numeric default null
)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_unit_cost numeric(12,2);
  v_purchase_total numeric(12,2);
begin
  if not public.is_inventory_admin() then raise exception '管理者權限不足'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception '入庫數量必須大於 0'; end if;
  if p_purchase_total is not null and p_purchase_total < 0 then raise exception '購買金額不可小於 0'; end if;
  select unit_cost into v_unit_cost from public.items where id = p_item_id and is_active = true;
  if not found then raise exception '物品不存在或已停用'; end if;
  v_purchase_total := coalesce(p_purchase_total, v_unit_cost * p_quantity);
  insert into public.inventory_batches(item_id,batch_label,received_date,received_quantity,remaining_quantity,expiry_date,opened_date,opened_use_by_date,notes,created_by,purchase_total)
    values (p_item_id,p_batch_label,coalesce(p_received_date,current_date),p_quantity,p_quantity,p_expiry_date,p_opened_date,p_opened_use_by_date,p_notes,(select auth.uid()),v_purchase_total)
    returning id into v_batch_id;
  insert into public.stock_transactions(item_id,batch_id,transaction_type,quantity,quantity_delta,reason,created_by)
    values (p_item_id,v_batch_id,'receive',p_quantity,p_quantity,'入庫',(select auth.uid()));
  return v_batch_id;
end;
$$;
revoke all on function public.inventory_receive(uuid,numeric,date,date,text,date,date,text,numeric) from public, anon;
grant execute on function public.inventory_receive(uuid,numeric,date,date,text,date,date,text,numeric) to authenticated;
