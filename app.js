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
  const titles={items:'物品管理',receive:'新增入庫',consume:'領用出庫',transactions:'異動紀錄',inventory:'庫存查詢',analysis:'消費分析'};
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
  $('#expiryList').innerHTML=visible.length?visible.map(x=>`<article class="expiry-card"><div><h3>${escapeHtml(x.item_name)}</h3><p>${escapeHtml(x.category_name||'未分類')}</p><p>存放位置：${escapeHtml(x.location_name||'未指定')}</p><p>剩餘數量：${Number(x.remaining_quantity||0)} ${escapeHtml(x.unit||'個')}</p><p>有效期限：${formatDate(x.expiry_date)}</p><p>入庫日期：${formatDate(x.received_date)}</p></div><span class="status-tag ${x.expiry_status==='已過期'?'expired':''}">${escapeHtml(x.expiry_status)}</span></article>`).join(''):'<div class="notice">這個篩選條件下沒有需要提醒的物品。</div>';
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
async function loadAdminData(){await Promise.all([loadCategories(),loadLocations(),loadItems(),loadTransactions()]); await loadInventory(); await loadAnalysisCategories();}
async function loadCategories(){const {data,error}=await db.from('categories').select('id,name').eq('is_active',true).order('name');if(error)return setAdminNotice(error.message,true);$('#categorySelect').innerHTML='<option value="">未分類</option>'+(data||[]).map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');}
async function loadLocations(){const {data,error}=await db.from('storage_locations').select('id,name').eq('is_active',true).order('name');if(error)return setAdminNotice(error.message,true);const options=(data||[]).map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');$('#locationSelect').innerHTML='<option value="">未指定</option>'+options;const receiveLocation=$('#receiveLocation');if(receiveLocation)receiveLocation.innerHTML='<option value="">沿用物品預設位置</option>'+options;}
async function loadItems(){
 const {data,error}=await db.from('items').select('id,name,brand,unit,unit_cost,is_active,location_id,category_id,low_stock_threshold,notes,expiry_reminder_days,categories(name),storage_locations(name),inventory_batches(id,batch_label,received_date,expiry_date,remaining_quantity,purchase_total,location_id,storage_locations(name))').order('name');
 if(error)return setAdminNotice(error.message,true);currentItems=data||[];
 $('#itemsTable').innerHTML=currentItems.length?`<table><thead><tr><th>物品</th><th>分類</th><th>單位</th><th>預設單價</th><th>目前庫存</th><th>狀態</th><th>操作</th></tr></thead><tbody>${currentItems.map(i=>{const qty=(i.inventory_batches||[]).reduce((sum,b)=>sum+Number(b.remaining_quantity||0),0);return `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.categories?.name||'未分類')}</td><td>${escapeHtml(i.unit)}</td><td>${i.unit_cost==null?'—':money(i.unit_cost)}</td><td>${qty}</td><td>${i.is_active?'使用中':'已停用'}</td><td><button class="button secondary small" data-edit-item="${i.id}">編輯</button> ${i.is_active?`<button class="button secondary small" data-consume="${i.id}">領用</button> <button class="button secondary small" data-deactivate="${i.id}">停用</button>`:'—'}</td></tr>`}).join('')}</tbody></table>`:'<p>尚無物品，請先新增物品。</p>';
 $('#receiveItem').innerHTML='<option value="">請選擇物品</option>'+currentItems.filter(i=>i.is_active).map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');
 $('#consumeItem').innerHTML='<option value="">請選擇物品</option>'+currentItems.filter(i=>i.is_active&&(i.inventory_batches||[]).some(b=>Number(b.remaining_quantity)>0)).map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');
 updateConsumeBatches();
 $('#itemsTable').querySelectorAll('[data-edit-item]').forEach(b=>b.addEventListener('click',()=>editItem(b.dataset.editItem)));
 $('#itemsTable').querySelectorAll('[data-consume]').forEach(b=>b.addEventListener('click',()=>{showPage('consume');$('#consumeItem').value=b.dataset.consume;updateConsumeBatches();}));
 $('#itemsTable').querySelectorAll('[data-deactivate]').forEach(b=>b.addEventListener('click',()=>deactivateItem(b.dataset.deactivate)));
}
let inventoryRows=[];
async function loadInventory(){
 const {data,error}=await db.from('items').select('id,name,brand,unit,unit_cost,is_active,location_id,categories(id,name),storage_locations(name),inventory_batches(id,batch_label,received_date,received_quantity,expiry_date,opened_use_by_date,remaining_quantity,purchase_total,location_id,storage_locations(name))').order('name');
 if(error){alert(`庫存查詢載入失敗：${error.message}`);setAdminNotice(`庫存查詢載入失敗：${error.message}`,true);return;}
 const locationSelect=$('#inventoryLocation'); const prior=locationSelect.value;
 const {data:locations, error:locError}=await db.from('storage_locations').select('id,name').eq('is_active',true).order('name');
 if(locError){setAdminNotice(`載入存放位置失敗：${locError.message}`,true);return;}
 locationSelect.innerHTML='<option value="">全部位置</option>'+(locations||[]).map(l=>`<option value="${l.id}">${escapeHtml(l.name)}</option>`).join(''); if((locations||[]).some(l=>l.id===prior))locationSelect.value=prior;
 inventoryRows=data||[]; renderInventory(inventoryRows);
}
function renderInventory(rows){
 const loc=$('#inventoryLocation').value, query=$('#inventorySearch').value.trim().toLocaleLowerCase();
 const filtered=rows.filter(i=>(!query||i.name.toLocaleLowerCase().includes(query)||String(i.brand||'').toLocaleLowerCase().includes(query)));
 const batches=filtered.flatMap(i=>(i.inventory_batches||[]).filter(b=>Number(b.remaining_quantity)>0&&(!loc||b.location_id===loc)).map(b=>({...b,itemName:i.name,unit:i.unit,location:b.storage_locations?.name||i.storage_locations?.name||'未指定',brand:i.brand||'',unitCost:b.purchase_total!=null&&Number(b.received_quantity)>0?Number(b.purchase_total)/Number(b.received_quantity):Number(i.unit_cost||0),purchaseTotal:b.purchase_total!=null?Number(b.purchase_total):(i.unit_cost!=null?Number(i.unit_cost)*Number(b.received_quantity||0):null)})));
 const total=batches.reduce((sum,b)=>sum+Number(b.remaining_quantity||0),0);
 $('#inventorySummary').textContent=`符合 ${filtered.length} 項物品、${batches.length} 個有庫存批次；目前總庫存數量 ${total}`;
 $('#inventoryTable').innerHTML=batches.length?`<table><thead><tr><th>物品</th><th>購買通路</th><th>存放位置</th><th>入庫日期</th><th>有效期限</th><th>開封後期限</th><th>剩餘數量</th><th>單價</th><th>本批購買金額</th><th>批次備註</th></tr></thead><tbody>${batches.map(b=>`<tr><td>${escapeHtml(b.itemName)}</td><td>${escapeHtml(b.brand||'—')}</td><td>${escapeHtml(b.location)}</td><td>${formatDate(b.received_date)}</td><td>${formatDate(b.expiry_date)}</td><td>${formatDate(b.opened_use_by_date)}</td><td>${Number(b.remaining_quantity)} ${escapeHtml(b.unit)}</td><td>${b.unitCost==null?'未記錄':money(b.unitCost)}</td><td>${b.purchaseTotal==null?'未記錄':money(b.purchaseTotal)}</td><td>${escapeHtml(b.batch_label||'—')}</td></tr>`).join('')}</tbody></table>`:'<p>目前沒有符合條件且庫存大於 0 的批次。</p>';
}
async function loadTransactions(){const {data,error}=await db.from('stock_transactions').select('created_at,transaction_type,quantity,quantity_delta,reason,items(name)').order('created_at',{ascending:false}).limit(100);if(error)return setAdminNotice(error.message,true);$('#transactionsTable').innerHTML=data?.length?`<table><thead><tr><th>時間</th><th>物品</th><th>類型</th><th>異動量</th><th>原因</th></tr></thead><tbody>${data.map(t=>`<tr><td>${new Date(t.created_at).toLocaleString('zh-TW')}</td><td>${escapeHtml(t.items?.name||'—')}</td><td>${escapeHtml(t.transaction_type)}</td><td>${Number(t.quantity_delta)>0?'+':''}${t.quantity_delta}</td><td>${escapeHtml(t.reason||'')}</td></tr>`).join('')}</tbody></table>`:'<p>尚無異動紀錄。</p>';}
async function editItem(id){
 const item=currentItems.find(x=>x.id===id); if(!item)return;
 const {data:categories,error:catErr}=await db.from('categories').select('id,name').eq('is_active',true).order('name');
 if(catErr){alert(`無法載入分類：${catErr.message}`);return;}
 const {data:locations,error:locErr}=await db.from('storage_locations').select('id,name').eq('is_active',true).order('name');
 if(locErr){alert(`無法載入存放位置：${locErr.message}`);return;}
 const name=prompt('物品名稱：',item.name); if(name===null)return;
 const brand=prompt('購買通路（可留空）：',item.brand||''); if(brand===null)return;
 const catOptions=(categories||[]).map((x,i)=>`${i+1}. ${x.name}${x.id===item.category_id?'（目前）':''}`).join('\n');
 const currentCat=(categories||[]).findIndex(x=>x.id===item.category_id);
 const catInput=prompt(`分類：輸入編號；輸入 0 表示未分類。\n${catOptions}`,currentCat>=0?String(currentCat+1):'0'); if(catInput===null)return;
 const catN=Number(catInput); if(!Number.isInteger(catN)||catN<0||catN>(categories||[]).length){alert('分類編號無效，未儲存。');return;}
 const locOptions=(locations||[]).map((x,i)=>`${i+1}. ${x.name}${x.id===item.location_id?'（目前）':''}`).join('\n');
 const currentLoc=(locations||[]).findIndex(x=>x.id===item.location_id);
 const locInput=prompt(`預設存放位置：輸入編號；輸入 0 表示未指定。\n${locOptions}`,currentLoc>=0?String(currentLoc+1):'0'); if(locInput===null)return;
 const locN=Number(locInput); if(!Number.isInteger(locN)||locN<0||locN>(locations||[]).length){alert('存放位置編號無效，未儲存。');return;}
 const unitCost=prompt('購買單價（元／單位，可留空）：',item.unit_cost==null?'':String(item.unit_cost)); if(unitCost===null)return;
 const unit=prompt('計量單位：',item.unit||'個'); if(unit===null)return;
 const threshold=prompt('低庫存門檻（可留空）：',item.low_stock_threshold==null?'':String(item.low_stock_threshold)); if(threshold===null)return;
 const reminder=prompt('效期提醒天數：',String(item.expiry_reminder_days??30)); if(reminder===null)return;
 const notes=prompt('備註（可留空）：',item.notes||''); if(notes===null)return;
 if(!name.trim()||!unit.trim()){alert('物品名稱與計量單位不可空白。');return;}
 if(unitCost.trim()!==''&&(!Number.isFinite(Number(unitCost))||Number(unitCost)<0)){alert('購買單價必須是大於或等於 0 的數字。');return;}
 if(threshold.trim()!==''&&(!Number.isFinite(Number(threshold))||Number(threshold)<0)){alert('低庫存門檻必須是大於或等於 0 的數字。');return;}
 if(!Number.isFinite(Number(reminder))||Number(reminder)<0){alert('效期提醒天數必須是大於或等於 0 的數字。');return;}
 const payload={name:name.trim(),brand:brand.trim()||null,category_id:catN===0?null:categories[catN-1].id,location_id:locN===0?null:locations[locN-1].id,unit_cost:unitCost.trim()===''?null:Number(unitCost),unit:unit.trim(),low_stock_threshold:threshold.trim()===''?null:Number(threshold),expiry_reminder_days:Number(reminder),notes:notes.trim()||null};
 const {error}=await db.from('items').update(payload).eq('id',id);
 if(error){alert(`修改失敗：${error.message}`);setAdminNotice(`修改物品失敗：${error.message}`,true);return;}
 alert('修改成功！物品資料已更新。\n提醒：已入庫批次的存放位置是獨立設定，不會因修改物品預設位置而變更。');
 await loadItems(); await loadInventory(); await loadPublicExpiry();
}
async function deactivateItem(id){if(!confirm('確定停用這個物品？歷史紀錄會保留。'))return;const {error}=await db.from('items').update({is_active:false}).eq('id',id);if(error)return setAdminNotice(error.message,true);setAdminNotice('物品已停用。');await loadItems();await loadPublicExpiry();}

$('#loginOpen').addEventListener('click',()=>{ $('#loginForm').reset(); $('#loginMessage').textContent=''; $('#loginDialog').showModal(); });$('#loginClose').addEventListener('click',()=>{ $('#loginForm').reset(); $('#loginDialog').close(); });$('#loginDialog').addEventListener('close',()=>$('#loginForm').reset());$('#refresh').addEventListener('click',refreshPublic);
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{currentFilter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderExpiry(JSON.parse($('#expiryList').dataset.rows||'[]'));}));
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
$('#tab-items').classList.remove('hidden');
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();if(!db)return;const f=new FormData(e.currentTarget);$('#loginMessage').textContent='登入中…';const {data,error}=await db.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});if(error){$('#loginMessage').textContent='登入失敗，請確認帳號、密碼與 Supabase Auth 設定。';return;}const ok=await verifyAdmin(data.session);if(ok){e.currentTarget.reset();$('#loginDialog').close();}});
$('#logout').addEventListener('click',async()=>{await db.auth.signOut();$('#loginForm').reset();setSignedInUI(false);await loadPublicExpiry();});
let itemFormSubmitting=false;
$('#itemForm').addEventListener('submit',async e=>{e.preventDefault();if(itemFormSubmitting)return;itemFormSubmitting=true;const form=e.currentTarget;const submitButton=form.querySelector('button[type="submit"]');const originalButtonText=submitButton?.textContent||'建立物品';if(submitButton){submitButton.disabled=true;submitButton.textContent='新增中…';}try{const f=new FormData(form);const payload={name:(f.get('name')||'').trim(),brand:(f.get('brand')||'').trim()||null,category_id:f.get('category_id')||null,unit:(f.get('unit')||'').trim(),location_id:f.get('location_id')||null,low_stock_threshold:f.get('low_stock_threshold')||null,expiry_reminder_days:Number(f.get('expiry_reminder_days')),notes:(f.get('notes')||'').trim()||null,unit_cost:f.get('unit_cost')!==''?Number(f.get('unit_cost')):null};if(!payload.name||!payload.unit){alert('新增失敗：請先填寫物品名稱與計量單位。');return;}const {data:{user},error:userError}=await db.auth.getUser();if(userError||!user){alert('新增失敗：登入狀態已失效，請重新登入後再試。');return;}payload.created_by=user.id;const {error}=await db.from('items').insert(payload);if(error){alert(`新增物品失敗：${error.message}`);setAdminNotice(`新增物品失敗：${error.message}`,true);return;}form.reset();form.elements.unit.value='包';form.elements.expiry_reminder_days.value='30';alert('新增成功！物品已建立，請到「新增入庫」建立第一筆庫存批次。');setAdminNotice('物品已建立。請到「新增入庫」建立第一筆庫存批次。');await loadItems();await loadInventory();}catch(err){console.error('新增物品發生錯誤',err);alert(`新增物品失敗：${err?.message||'發生未知錯誤，請稍後再試。'}`);}finally{itemFormSubmitting=false;if(submitButton){submitButton.disabled=false;submitButton.textContent=originalButtonText;}}});
$('#consumeItem').addEventListener('change',updateConsumeBatches);$('#consumeBatch').addEventListener('change',renderSelectedBatchInfo);
async function addLookupValue(table,selectId,label){const raw=prompt(`請輸入新的${label}名稱：`);if(raw===null)return;const name=raw.trim();if(!name){alert(`新增${label}失敗：名稱不可空白。`);return;}try{const {data,error}=await db.from(table).insert({name,is_active:true}).select('id,name').single();if(error)throw error;if(table==='categories')await loadCategories();else await loadLocations();$(selectId).value=data.id;alert(`新增成功！${label}「${name}」已建立並選取。`);setAdminNotice(`${label}「${name}」已新增並選取。`);}catch(err){alert(`新增${label}失敗：${err?.message||'發生未知錯誤，請稍後再試。'}`);setAdminNotice(`新增${label}失敗：${err?.message||'未知錯誤'}`,true);}}
$('#addCategory').addEventListener('click',()=>addLookupValue('categories','#categorySelect','分類'));$('#addLocation').addEventListener('click',()=>addLookupValue('storage_locations','#locationSelect','存放位置'));
async function runFormSubmit(form,buttonText,operation,successMessage,resetForm){
 const formEl=$(form); if(formEl.dataset.submitting==='true')return; formEl.dataset.submitting='true'; const button=formEl.querySelector('button[type="submit"]'); const oldText=button?.textContent||buttonText; if(button){button.disabled=true;button.textContent='處理中…';}
 try{await operation();formEl.reset();if(resetForm)resetForm(formEl);alert(successMessage);setAdminNotice(successMessage);await loadAdminData();await loadPublicExpiry();}
 catch(err){console.error(`${buttonText}失敗`,err);const msg=err?.message||'發生未知錯誤，請稍後再試。';alert(`${buttonText}失敗：${msg}`);setAdminNotice(`${buttonText}失敗：${msg}`,true);}
 finally{formEl.dataset.submitting='false';if(button){button.disabled=false;button.textContent=oldText;}}
}
$('#consumeForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;await runFormSubmit('#consumeForm','確認出庫',async()=>{const f=new FormData(form);const {error}=await db.rpc('inventory_remove',{p_batch_id:f.get('batch_id'),p_quantity:Number(f.get('quantity')),p_type:f.get('type'),p_reason:f.get('reason')||null});if(error)throw error;},'領用出庫成功！庫存及異動紀錄已更新。',()=>updateConsumeBatches());});
$('#receiveForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;await runFormSubmit('#receiveForm','確認入庫',async()=>{const f=new FormData(form);const {error}=await db.rpc('inventory_receive',{p_item_id:f.get('item_id'),p_quantity:Number(f.get('quantity')),p_expiry_date:f.get('expiry_date')||null,p_received_date:f.get('received_date')||todayISO(),p_batch_label:f.get('batch_label')||null,p_opened_date:f.get('opened_date')||null,p_opened_use_by_date:f.get('opened_use_by_date')||null,p_notes:f.get('notes')||null,p_purchase_total:f.get('purchase_total')!==''?Number(f.get('purchase_total')):null,p_location_id:f.get('location_id')||null});if(error)throw error;},'新增入庫成功！庫存批次及異動紀錄已建立。',form=>{form.elements.received_date.value=todayISO();});});
$('#inventoryLocation').addEventListener('change',()=>renderInventory(inventoryRows));$('#inventorySearch').addEventListener('input',()=>renderInventory(inventoryRows));$('#inventoryRefresh').addEventListener('click',()=>loadInventory());

function money(n){return 'NT$ '+Number(n||0).toLocaleString('zh-TW',{maximumFractionDigits:2});}
async function loadAnalysisCategories(){const {data,error}=await db.from('categories').select('id,name').eq('is_active',true).order('name');if(error)return;$('#analysisCategory').innerHTML='<option value="">全部分類</option>'+(data||[]).map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');}
function renderSpendTrend(rows){
 const el=$('#spendTrendChart');
 const priced=rows.filter(r=>r.amount!=null&&r.received_date);
 if(!priced.length){el.innerHTML='<p>目前沒有可繪製折線圖的購買金額資料。</p>';return;}
 const monthKeys=[...new Set(priced.map(r=>String(r.received_date).slice(0,7)))].sort();
 const categories=[...new Set(priced.map(r=>r.cat||'未分類'))];
 const totals=Object.fromEntries(categories.map(c=>[c,priced.filter(r=>r.cat===c).reduce((s,r)=>s+r.amount,0)]));
 const seriesNames=categories.sort((a,b)=>totals[b]-totals[a]).slice(0,5);
 const data=seriesNames.map(name=>({name,values:monthKeys.map(m=>priced.filter(r=>r.cat===name&&String(r.received_date).startsWith(m)).reduce((s,r)=>s+r.amount,0))}));
 const W=760,H=320,L=72,R=24,T=24,B=64,plotW=W-L-R,plotH=H-T-B;
 const peak=Math.max(1,...data.flatMap(s=>s.values));const niceStep=Math.max(1,Math.ceil(peak/4/100)*100);const yMax=Math.max(niceStep*4,Math.ceil(peak/niceStep)*niceStep);
 const x=i=>L+(monthKeys.length<=1?plotW/2:i*plotW/(monthKeys.length-1));const y=v=>T+plotH-(v/yMax)*plotH;
 const colors=['#4472c4','#ed7d31','#a5a5a5','#ffc000','#70ad47'];let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="各分類每月消費折線比較" class="trend-svg">`;
 for(let i=0;i<=4;i++){const val=yMax*i/4,yy=y(val);svg+=`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#dedbd4" stroke-width="1"/><text x="${L-10}" y="${yy+4}" text-anchor="end" font-size="11" fill="#777">${Math.round(val).toLocaleString('zh-TW')}</text>`;}
 monthKeys.forEach((m,i)=>{svg+=`<text x="${x(i)}" y="${T+plotH+22}" text-anchor="middle" font-size="11" fill="#777">${Number(m.slice(5,7))}月</text>`;});
 data.forEach((ser,si)=>{const pts=ser.values.map((v,i)=>`${x(i)},${y(v)}`).join(' ');svg+=`<polyline points="${pts}" fill="none" stroke="${colors[si%colors.length]}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>`;ser.values.forEach((v,i)=>{svg+=`<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${colors[si%colors.length]}"/>`;});});
 const legendY=H-15;let lx=L;data.forEach((ser,si)=>{const label=ser.name.length>8?ser.name.slice(0,8)+'…':ser.name;svg+=`<line x1="${lx}" y1="${legendY-4}" x2="${lx+20}" y2="${legendY-4}" stroke="${colors[si%colors.length]}" stroke-width="3"/><text x="${lx+25}" y="${legendY}" font-size="11" fill="#666">${escapeHtml(label)}</text>`;lx+=Math.min(160,48+label.length*13);});svg+='</svg>';
 if(categories.length>5)svg+=`<p class="helper-text">圖表顯示消費最高的 5 個分類；總消費與下方明細仍包含所有符合篩選條件的分類。</p>`;
 el.innerHTML=svg;
}
async function loadSpendAnalysis(){const start=$('#analysisStart').value,end=$('#analysisEnd').value,category=$('#analysisCategory').value;if(start&&end&&start>end){alert('查詢失敗：開始日期不可晚於結束日期。');return;}let q=db.from('inventory_batches').select('id,item_id,batch_label,received_date,received_quantity,purchase_total,items(id,name,brand,unit,category_id,categories(name))').order('received_date',{ascending:false});if(start)q=q.gte('received_date',start);if(end)q=q.lte('received_date',end);const {data,error}=await q;if(error){alert(`消費分析載入失敗：${error.message}`);setAdminNotice(`消費分析載入失敗：${error.message}`,true);return;}const rows=(data||[]).filter(b=>!category||b.items?.category_id===category).map(b=>({...b,name:b.items?.name||'未知物品',cat:b.items?.categories?.name||'未分類',amount:b.purchase_total==null?null:Number(b.purchase_total),unitPrice:b.purchase_total!=null&&Number(b.received_quantity)>0?Number(b.purchase_total)/Number(b.received_quantity):null}));const priced=rows.filter(r=>r.amount!=null);const total=priced.reduce((a,r)=>a+r.amount,0);const grouped={};priced.forEach(r=>{grouped[r.name]=(grouped[r.name]||0)+r.amount;});const rank=Object.entries(grouped).sort((a,b)=>b[1]-a[1]);$('#analysisSummary').innerHTML=`<div class="analysis-stat"><span>購買批次</span><strong>${rows.length}</strong></div><div class="analysis-stat"><span>已記錄金額</span><strong>${priced.length}</strong></div><div class="analysis-stat"><span>區間總消費</span><strong>${money(total)}</strong></div><div class="analysis-stat"><span>平均每批購買</span><strong>${priced.length?money(total/priced.length):'—'}</strong></div>`;const max=rank[0]?.[1]||1;$('#spendRanking').innerHTML=rank.length?rank.map(([name,value],i)=>`<div class="rank-row"><div class="rank-label"><span>${i+1}. ${escapeHtml(name)}</span><strong>${money(value)}</strong></div><div class="dot-track" aria-label="${escapeHtml(name)}消費 ${value}">${Array.from({length:Math.max(1,Math.round(value/max*24))},()=>'<span class="spend-dot"></span>').join('')}</div></div>`).join(''):'<p>這個日期區間尚無已記錄購買金額的資料。</p>';renderSpendTrend(priced);$('#analysisTable').innerHTML=rows.length?`<table><thead><tr><th>購買日期</th><th>商品</th><th>分類</th><th>購買數量</th><th>總金額</th><th>單價</th><th>批次</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${formatDate(r.received_date)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.cat)}</td><td>${Number(r.received_quantity)} ${escapeHtml(r.items?.unit||'')}</td><td>${r.amount==null?'未記錄':money(r.amount)}</td><td>${r.unitPrice==null?'未記錄':money(r.unitPrice)}</td><td>${escapeHtml(r.batch_label||'—')}</td></tr>`).join('')}</tbody></table>`:'<p>查無購買紀錄。</p>';}
$('#analysisRefresh').addEventListener('click',loadSpendAnalysis);$('#analysisStart').value=new Date(new Date().getFullYear(),new Date().getMonth(),1).toLocaleDateString('en-CA');$('#analysisEnd').value=todayISO();$('#analysisCategory').addEventListener('change',loadSpendAnalysis);



if(configured()&&window.supabase){db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});db.auth.onAuthStateChange((_event,session)=>{if(session)verifyAdmin(session);else setSignedInUI(false);});loadPublicExpiry();db.auth.getSession().then(({data})=>verifyAdmin(data.session));}else{setNotice('網站前端已建立。下一步請建立新的 Supabase 專案，將 URL 與公開金鑰填入 app.js，再執行 schema.sql。');renderExpiry([]);}
