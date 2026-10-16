/* Home Inventory v1. Fill these values from the NEW Supabase project settings. Never use service_role here. */
const SUPABASE_URL = 'PASTE_NEW_PROJECT_URL_HERE';
const SUPABASE_ANON_KEY = 'PASTE_NEW_PUBLISHABLE_OR_ANON_KEY_HERE';

const $ = (s) => document.querySelector(s);
let db = null;
let currentFilter = 'all';
let currentItems = [];
const configured = () => SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('PASTE_') && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes('PASTE_');
const escapeHtml = (value='') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayISO = () => new Date().toLocaleDateString('en-CA');
function setNotice(message, error=false, target='#status') { const el=$(target); el.textContent=message; el.classList.toggle('error',error); el.classList.remove('hidden'); }
function clearNotice(target='#status'){ $(target).classList.add('hidden'); }
function setAdminNotice(message,error=false){setNotice(message,error,'#adminStatus');}
function formatDate(date){ if(!date) return '未設定'; const d=new Date(`${date}T00:00:00`); return Number.isNaN(d.getTime())?date:d.toLocaleDateString('zh-TW'); }

async function loadPublicExpiry(){
  if(!db){setNotice('尚未設定 Supabase。請依 README 設定新專案 URL 與公開金鑰。');return;}
  setNotice('正在載入效期清單…');
  const {data,error}=await db.rpc('public_expiry_list');
  if(error){setNotice(`無法載入效期清單：${error.message}`,true);return;}
  renderExpiry(data||[]);
  setNotice((data||[]).length?`目前有 ${(data||[]).length} 筆效期提醒。`:'目前沒有已過期或進入提醒區間的物品。');
}
function renderExpiry(rows){
  const visible=currentFilter==='all'?rows:rows.filter(x=>x.expiry_status===currentFilter);
  $('#expiryList').innerHTML=visible.length?visible.map(x=>`<article class="expiry-card"><div><h3>${escapeHtml(x.item_name)}</h3><p>${escapeHtml(x.category_name||'未分類')}</p><p>有效期限：${formatDate(x.expiry_date)}</p></div><span class="status-tag ${x.expiry_status==='已過期'?'expired':''}">${escapeHtml(x.expiry_status)}</span></article>`).join(''):'<div class="notice">這個篩選條件下沒有需要提醒的物品。</div>';
  $('#expiryList').dataset.rows=JSON.stringify(rows);
}
async function refreshPublic(){
 const rows=JSON.parse($('#expiryList').dataset.rows||'[]');
 if(db) await loadPublicExpiry(); else renderExpiry(rows);
}
function setSignedInUI(signedIn){$('#adminPanel').classList.toggle('hidden',!signedIn);$('#loginOpen').classList.toggle('hidden',signedIn);}
async function verifyAdmin(session){
 if(!session){setSignedInUI(false);return false;}
 const {data,error}=await db.from('profiles').select('is_admin').eq('user_id',session.user.id).maybeSingle();
 if(error||!data?.is_admin){await db.auth.signOut();setSignedInUI(false);$('#loginMessage').textContent='此帳號尚未被授權為管理者。';return false;}
 setSignedInUI(true);$('#loginMessage').textContent='';await loadAdminData();return true;
}
async function loadAdminData(){await Promise.all([loadCategories(),loadLocations(),loadItems(),loadTransactions()]);}
async function loadCategories(){const {data,error}=await db.from('categories').select('id,name').eq('is_active',true).order('name');if(error)return setAdminNotice(error.message,true);$('#categorySelect').innerHTML='<option value="">未分類</option>'+(data||[]).map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');}
async function loadLocations(){const {data,error}=await db.from('storage_locations').select('id,name').eq('is_active',true).order('name');if(error)return setAdminNotice(error.message,true);$('#locationSelect').innerHTML='<option value="">未指定</option>'+(data||[]).map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');}
async function loadItems(){
 const {data,error}=await db.from('items').select('id,name,brand,unit,is_active,expiry_reminder_days,categories(name),storage_locations(name),inventory_batches(remaining_quantity)').order('name');
 if(error)return setAdminNotice(error.message,true);currentItems=data||[];
 $('#itemsTable').innerHTML=currentItems.length?`<table><thead><tr><th>物品</th><th>分類</th><th>單位</th><th>目前庫存</th><th>狀態</th><th>操作</th></tr></thead><tbody>${currentItems.map(i=>{const qty=(i.inventory_batches||[]).reduce((sum,b)=>sum+Number(b.remaining_quantity||0),0);return `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.categories?.name||'未分類')}</td><td>${escapeHtml(i.unit)}</td><td>${qty}</td><td>${i.is_active?'使用中':'已停用'}</td><td>${i.is_active?`<button class="button secondary small" data-consume="${i.id}">領用</button> <button class="button secondary small" data-deactivate="${i.id}">停用</button>`:'—'}</td></tr>`}).join('')}</tbody></table>`:'<p>尚無物品，請先新增物品。</p>';
 $('#receiveItem').innerHTML='<option value="">請選擇物品</option>'+currentItems.filter(i=>i.is_active).map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');
 $('#itemsTable').querySelectorAll('[data-consume]').forEach(b=>b.addEventListener('click',()=>consumeItem(b.dataset.consume)));
 $('#itemsTable').querySelectorAll('[data-deactivate]').forEach(b=>b.addEventListener('click',()=>deactivateItem(b.dataset.deactivate)));
}
async function loadTransactions(){const {data,error}=await db.from('stock_transactions').select('created_at,transaction_type,quantity,quantity_delta,reason,items(name)').order('created_at',{ascending:false}).limit(100);if(error)return setAdminNotice(error.message,true);$('#transactionsTable').innerHTML=data?.length?`<table><thead><tr><th>時間</th><th>物品</th><th>類型</th><th>異動量</th><th>原因</th></tr></thead><tbody>${data.map(t=>`<tr><td>${new Date(t.created_at).toLocaleString('zh-TW')}</td><td>${escapeHtml(t.items?.name||'—')}</td><td>${escapeHtml(t.transaction_type)}</td><td>${Number(t.quantity_delta)>0?'+':''}${t.quantity_delta}</td><td>${escapeHtml(t.reason||'')}</td></tr>`).join('')}</tbody></table>`:'<p>尚無異動紀錄。</p>';}
async function consumeItem(itemId){const item=currentItems.find(x=>x.id===itemId);if(!item)return;const batches=(item.inventory_batches||[]).filter(b=>Number(b.remaining_quantity)>0);if(!batches.length)return setAdminNotice('此物品目前沒有可領用庫存。',true);const amount=prompt(`領用「${item.name}」多少 ${item.unit}？系統會顯示批次選擇功能於後續版本；目前請先在資料庫端確認對應批次。`);if(amount===null)return;const n=Number(amount);if(!Number.isFinite(n)||n<=0)return setAdminNotice('請輸入大於 0 的數量。',true);if(batches.length!==1)return setAdminNotice('此物品有多個庫存批次。為避免扣錯效期批次，請先使用批次明細功能；多批次領用介面會在下一個建置步驟完成。',true);const {error}=await db.rpc('inventory_remove',{p_batch_id:(await db.from('inventory_batches').select('id').eq('item_id',itemId).gt('remaining_quantity',0).limit(1).single()).data.id,p_quantity:n,p_type:'consume',p_reason:'一般領用'});if(error)return setAdminNotice(error.message,true);setAdminNotice('領用完成，庫存已更新。');await loadAdminData();await loadPublicExpiry();}
async function deactivateItem(id){if(!confirm('確定停用這個物品？歷史紀錄會保留。'))return;const {error}=await db.from('items').update({is_active:false}).eq('id',id);if(error)return setAdminNotice(error.message,true);setAdminNotice('物品已停用。');await loadItems();await loadPublicExpiry();}

$('#loginOpen').addEventListener('click',()=>$('#loginDialog').showModal());$('#loginClose').addEventListener('click',()=>$('#loginDialog').close());$('#refresh').addEventListener('click',refreshPublic);
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{currentFilter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderExpiry(JSON.parse($('#expiryList').dataset.rows||'[]'));}));
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.tab-content').forEach(x=>x.classList.add('hidden'));$('#tab-'+b.dataset.tab).classList.remove('hidden');}));
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();if(!db)return;const f=new FormData(e.currentTarget);$('#loginMessage').textContent='登入中…';const {data,error}=await db.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});if(error){$('#loginMessage').textContent='登入失敗，請確認帳號、密碼與 Supabase Auth 設定。';return;}const ok=await verifyAdmin(data.session);if(ok)$('#loginDialog').close();});
$('#logout').addEventListener('click',async()=>{await db.auth.signOut();setSignedInUI(false);await loadPublicExpiry();});
$('#itemForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const payload={name:f.get('name').trim(),brand:f.get('brand')||null,category_id:f.get('category_id')||null,unit:f.get('unit').trim(),location_id:f.get('location_id')||null,low_stock_threshold:f.get('low_stock_threshold')||null,expiry_reminder_days:Number(f.get('expiry_reminder_days')),notes:f.get('notes')||null};const {data:{user}}=await db.auth.getUser();payload.created_by=user.id;const {error}=await db.from('items').insert(payload);if(error)return setAdminNotice(error.message,true);e.currentTarget.reset();e.currentTarget.elements.unit.value='包';e.currentTarget.elements.expiry_reminder_days.value='30';setAdminNotice('物品已建立。請到「新增入庫」建立第一筆庫存批次。');await loadItems();});
$('#receiveForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const {error}=await db.rpc('inventory_receive',{p_item_id:f.get('item_id'),p_quantity:Number(f.get('quantity')),p_expiry_date:f.get('expiry_date')||null,p_received_date:f.get('received_date')||todayISO(),p_batch_label:f.get('batch_label')||null,p_opened_date:f.get('opened_date')||null,p_opened_use_by_date:f.get('opened_use_by_date')||null,p_notes:f.get('notes')||null});if(error)return setAdminNotice(error.message,true);e.currentTarget.reset();e.currentTarget.elements.received_date.value=todayISO();setAdminNotice('入庫完成，批次及異動紀錄已建立。');await loadAdminData();await loadPublicExpiry();});

if(configured()&&window.supabase){db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);db.auth.onAuthStateChange((_event,session)=>{if(session)verifyAdmin(session);else setSignedInUI(false);});loadPublicExpiry();db.auth.getSession().then(({data})=>verifyAdmin(data.session));}else{setNotice('網站前端已建立。下一步請建立新的 Supabase 專案，將 URL 與公開金鑰填入 app.js，再執行 schema.sql。');renderExpiry([]);}
