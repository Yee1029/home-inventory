/* Home Inventory v1. Fill these values from the NEW Supabase project settings. Never use service_role here. */
const SUPABASE_URL = 'https://oxoincirkewbwarhzaaw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5Ahl3TVf5Gapj6glZqkCXg_c7YqSOcr';

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
function showPage(page){
  if(page!=='expiry' && !db){page='expiry';}
  if(page!=='expiry' && $('#loginOpen').classList.contains('hidden')===false){page='expiry';$('#loginForm').reset();$('#loginDialog').showModal();return;}
  $('#page-expiry').classList.toggle('hidden',page!=='expiry');
  $('#adminPanel').classList.toggle('hidden',page==='expiry');
  document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  const titles={items:'物品管理',receive:'新增入庫',consume:'領用出庫',transactions:'異動紀錄'};
  if(page!=='expiry'){document.querySelectorAll('.tab-content').forEach(el=>el.classList.toggle('hidden',el.id!==`tab-${page}`));$('#adminPageTitle').textContent=titles[page]||'管理功能';}
}
function formatDate(date){ if(!date) return '未設定'; const d=new Date(`${date}T00:00:00`); return Number.isNaN(d.getTime())?date:d.toLocaleDateString('zh-TW'); }

async function loadPublicExpiry(){
  if(!db){setNotice('尚未設定 Supabase。請依 README 設定新專案 URL 與公開金鑰。');return;}
  setNotice('正在載入效期清單…');
  const {data,error}=await db.rpc('public_expiry_list');
  if(error){setNotice(`無法載入效期清單：${error.message}`,true);return;}
  renderExpiry(data||[]);
  setNotice((data||[]).length?`目前有 ${(data||[]).length} 筆效期提醒。`:'目前沒有已過期或進入提醒區間的物品。');
}
function updateConsumeBatches(){const itemId=$('#consumeItem')?.value;const item=currentItems.find(i=>i.id===itemId);const batches=(item?.inventory_batches||[]).filter(b=>Number(b.remaining_quantity)>0);$('#consumeBatch').innerHTML='<option value="">請選擇批次</option>'+batches.map(b=>`<option value="${b.id}">${escapeHtml(item?.name||'物品')}｜入庫 ${formatDate(b.received_date)}</option>`).join('');renderSelectedBatchInfo();}
function renderSelectedBatchInfo(){const item=currentItems.find(i=>i.id===$('#consumeItem')?.value);const batch=(item?.inventory_batches||[]).find(b=>b.id===$('#consumeBatch')?.value);const box=$('#selectedBatchInfo');if(!box)return;if(!batch){box.classList.add('hidden');box.innerHTML='';return;}box.classList.remove('hidden');box.innerHTML=`<div><span>有效期限</span><strong>${formatDate(batch.expiry_date)}</strong></div><div><span>剩餘數量</span><strong>${Number(batch.remaining_quantity)} ${escapeHtml(item?.unit||'個')}</strong></div>`;}
function renderExpiry(rows){
  const visible=currentFilter==='all'?rows:rows.filter(x=>x.expiry_status===currentFilter);
  $('#expiryList').innerHTML=visible.length?visible.map(x=>`<article class="expiry-card"><div><h3>${escapeHtml(x.item_name)}</h3><p>${escapeHtml(x.category_name||'未分類')}</p><p>有效期限：${formatDate(x.expiry_date)}</p></div><span class="status-tag ${x.expiry_status==='已過期'?'expired':''}">${escapeHtml(x.expiry_status)}</span></article>`).join(''):'<div class="notice">這個篩選條件下沒有需要提醒的物品。</div>';
  $('#expiryList').dataset.rows=JSON.stringify(rows);
}
async function refreshPublic(){
 const rows=JSON.parse($('#expiryList').dataset.rows||'[]');
 if(db) await loadPublicExpiry(); else renderExpiry(rows);
}
function setSignedInUI(signedIn,email=''){ $('#loginOpen').classList.toggle('hidden',signedIn); $('#logout').classList.toggle('hidden',!signedIn); $('#signedInEmail').classList.toggle('hidden',!signedIn); $('#signedInEmail').textContent=signedIn?email:''; document.querySelectorAll('.admin-only').forEach(el=>el.classList.toggle('hidden',!signedIn)); if(!signedIn) showPage('expiry'); if(signedIn){ const dialog=$('#loginDialog'); if(dialog?.open) dialog.close(); $('#loginForm')?.reset(); } }
async function verifyAdmin(session){
 if(!session){setSignedInUI(false);return false;}
 const {data,error}=await db.from('profiles').select('is_admin').eq('user_id',session.user.id).maybeSingle();
 if(error||!data?.is_admin){await db.auth.signOut();setSignedInUI(false);$('#loginMessage').textContent='此帳號尚未被授權為管理者。';return false;}
 setSignedInUI(true,session.user.email||'已登入');$('#loginMessage').textContent='';const loginDialog=$('#loginDialog');if(loginDialog?.open)loginDialog.close();$('#loginForm').reset();await loadAdminData();return true;
}
async function loadAdminData(){await Promise.all([loadCategories(),loadLocations(),loadItems(),loadTransactions()]);}
async function loadCategories(){const {data,error}=await db.from('categories').select('id,name').eq('is_active',true).order('name');if(error)return setAdminNotice(error.message,true);$('#categorySelect').innerHTML='<option value="">未分類</option>'+(data||[]).map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');}
async function loadLocations(){const {data,error}=await db.from('storage_locations').select('id,name').eq('is_active',true).order('name');if(error)return setAdminNotice(error.message,true);$('#locationSelect').innerHTML='<option value="">未指定</option>'+(data||[]).map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');}
async function loadItems(){
 const {data,error}=await db.from('items').select('id,name,brand,unit,is_active,expiry_reminder_days,categories(name),storage_locations(name),inventory_batches(id,batch_label,received_date,expiry_date,remaining_quantity)').order('name');
 if(error)return setAdminNotice(error.message,true);currentItems=data||[];
 $('#itemsTable').innerHTML=currentItems.length?`<table><thead><tr><th>物品</th><th>分類</th><th>單位</th><th>目前庫存</th><th>狀態</th><th>操作</th></tr></thead><tbody>${currentItems.map(i=>{const qty=(i.inventory_batches||[]).reduce((sum,b)=>sum+Number(b.remaining_quantity||0),0);return `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.categories?.name||'未分類')}</td><td>${escapeHtml(i.unit)}</td><td>${qty}</td><td>${i.is_active?'使用中':'已停用'}</td><td>${i.is_active?`<button class="button secondary small" data-consume="${i.id}">領用</button> <button class="button secondary small" data-deactivate="${i.id}">停用</button>`:'—'}</td></tr>`}).join('')}</tbody></table>`:'<p>尚無物品，請先新增物品。</p>';
 $('#receiveItem').innerHTML='<option value="">請選擇物品</option>'+currentItems.filter(i=>i.is_active).map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');
 $('#consumeItem').innerHTML='<option value="">請選擇物品</option>'+currentItems.filter(i=>i.is_active&&(i.inventory_batches||[]).some(b=>Number(b.remaining_quantity)>0)).map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');
 updateConsumeBatches();
 $('#itemsTable').querySelectorAll('[data-consume]').forEach(b=>b.addEventListener('click',()=>{showPage('consume');$('#consumeItem').value=b.dataset.consume;updateConsumeBatches();}));
 $('#itemsTable').querySelectorAll('[data-deactivate]').forEach(b=>b.addEventListener('click',()=>deactivateItem(b.dataset.deactivate)));
}
async function loadTransactions(){const {data,error}=await db.from('stock_transactions').select('created_at,transaction_type,quantity,quantity_delta,reason,items(name)').order('created_at',{ascending:false}).limit(100);if(error)return setAdminNotice(error.message,true);$('#transactionsTable').innerHTML=data?.length?`<table><thead><tr><th>時間</th><th>物品</th><th>類型</th><th>異動量</th><th>原因</th></tr></thead><tbody>${data.map(t=>`<tr><td>${new Date(t.created_at).toLocaleString('zh-TW')}</td><td>${escapeHtml(t.items?.name||'—')}</td><td>${escapeHtml(t.transaction_type)}</td><td>${Number(t.quantity_delta)>0?'+':''}${t.quantity_delta}</td><td>${escapeHtml(t.reason||'')}</td></tr>`).join('')}</tbody></table>`:'<p>尚無異動紀錄。</p>';}
async function deactivateItem(id){if(!confirm('確定停用這個物品？歷史紀錄會保留。'))return;const {error}=await db.from('items').update({is_active:false}).eq('id',id);if(error)return setAdminNotice(error.message,true);setAdminNotice('物品已停用。');await loadItems();await loadPublicExpiry();}

$('#loginOpen').addEventListener('click',()=>{ $('#loginForm').reset(); $('#loginMessage').textContent=''; $('#loginDialog').showModal(); });$('#loginClose').addEventListener('click',()=>{ $('#loginForm').reset(); $('#loginDialog').close(); });$('#loginDialog').addEventListener('close',()=>$('#loginForm').reset());$('#refresh').addEventListener('click',refreshPublic);
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{currentFilter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderExpiry(JSON.parse($('#expiryList').dataset.rows||'[]'));}));
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
$('#tab-items').classList.remove('hidden');
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();if(!db)return;const f=new FormData(e.currentTarget);$('#loginMessage').textContent='登入中…';const {data,error}=await db.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});if(error){$('#loginMessage').textContent='登入失敗，請確認帳號、密碼與 Supabase Auth 設定。';return;}const ok=await verifyAdmin(data.session);if(ok){e.currentTarget.reset();$('#loginDialog').close();}});
$('#logout').addEventListener('click',async()=>{await db.auth.signOut();$('#loginForm').reset();setSignedInUI(false);await loadPublicExpiry();});
let itemFormSubmitting=false;
$('#itemForm').addEventListener('submit',async e=>{e.preventDefault();if(itemFormSubmitting)return;itemFormSubmitting=true;const form=e.currentTarget;const submitButton=form.querySelector('button[type="submit"]');const originalButtonText=submitButton?.textContent||'建立物品';if(submitButton){submitButton.disabled=true;submitButton.textContent='新增中…';}try{const f=new FormData(form);const payload={name:(f.get('name')||'').trim(),brand:(f.get('brand')||'').trim()||null,category_id:f.get('category_id')||null,unit:(f.get('unit')||'').trim(),location_id:f.get('location_id')||null,low_stock_threshold:f.get('low_stock_threshold')||null,expiry_reminder_days:Number(f.get('expiry_reminder_days')),notes:(f.get('notes')||'').trim()||null};if(!payload.name||!payload.unit){alert('新增失敗：請先填寫物品名稱與計量單位。');return;}const {data:{user},error:userError}=await db.auth.getUser();if(userError||!user){alert('新增失敗：登入狀態已失效，請重新登入後再試。');return;}payload.created_by=user.id;const {error}=await db.from('items').insert(payload);if(error){alert(`新增物品失敗：${error.message}`);setAdminNotice(`新增物品失敗：${error.message}`,true);return;}form.reset();form.elements.unit.value='包';form.elements.expiry_reminder_days.value='30';alert('新增成功！物品已建立，請到「新增入庫」建立第一筆庫存批次。');setAdminNotice('物品已建立。請到「新增入庫」建立第一筆庫存批次。');await loadItems();}catch(err){console.error('新增物品發生錯誤',err);alert(`新增物品失敗：${err?.message||'發生未知錯誤，請稍後再試。'}`);}finally{itemFormSubmitting=false;if(submitButton){submitButton.disabled=false;submitButton.textContent=originalButtonText;}}});
$('#consumeItem').addEventListener('change',updateConsumeBatches);$('#consumeBatch').addEventListener('change',renderSelectedBatchInfo);
async function addLookupValue(table,selectId,label){const raw=prompt(`請輸入新的${label}名稱：`);if(raw===null)return;const name=raw.trim();if(!name){alert(`${label}名稱不可空白。`);return;}const {data,error}=await db.from(table).insert({name,is_active:true}).select('id,name').single();if(error){alert(`新增${label}失敗：${error.message}`);return;}if(table==='categories')await loadCategories();else await loadLocations();$(selectId).value=data.id;setAdminNotice(`${label}「${name}」已新增並選取。`);}
$('#addCategory').addEventListener('click',()=>addLookupValue('categories','#categorySelect','分類'));$('#addLocation').addEventListener('click',()=>addLookupValue('storage_locations','#locationSelect','存放位置'));
$('#consumeForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const {error}=await db.rpc('inventory_remove',{p_batch_id:f.get('batch_id'),p_quantity:Number(f.get('quantity')),p_type:f.get('type'),p_reason:f.get('reason')||null});if(error)return setAdminNotice(`領用出庫失敗：${error.message}`,true);e.currentTarget.reset();updateConsumeBatches();setAdminNotice('領用出庫完成，庫存及異動紀錄已更新。');await loadAdminData();await loadPublicExpiry();});
$('#receiveForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const {error}=await db.rpc('inventory_receive',{p_item_id:f.get('item_id'),p_quantity:Number(f.get('quantity')),p_expiry_date:f.get('expiry_date')||null,p_received_date:f.get('received_date')||todayISO(),p_batch_label:f.get('batch_label')||null,p_opened_date:f.get('opened_date')||null,p_opened_use_by_date:f.get('opened_use_by_date')||null,p_notes:f.get('notes')||null});if(error)return setAdminNotice(error.message,true);e.currentTarget.reset();e.currentTarget.elements.received_date.value=todayISO();setAdminNotice('入庫完成，批次及異動紀錄已建立。');await loadAdminData();await loadPublicExpiry();});

if(configured()&&window.supabase){db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});db.auth.onAuthStateChange((_event,session)=>{if(session)verifyAdmin(session);else setSignedInUI(false);});loadPublicExpiry();db.auth.getSession().then(({data})=>verifyAdmin(data.session));}else{setNotice('網站前端已建立。下一步請建立新的 Supabase 專案，將 URL 與公開金鑰填入 app.js，再執行 schema.sql。');renderExpiry([]);}
