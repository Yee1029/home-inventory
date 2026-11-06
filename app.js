/* Home Inventory v1. Fill these values from the NEW Supabase project settings. Never use service_role here. */
const SUPABASE_URL = 'https://oxoincirkewbwarhzaaw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5Ahl3TVf5Gapj6glZqkCXg_c7YqSOcr';

const $ = (s) => document.querySelector(s);
let db = null;
let currentFilter = 'all';
let currentItems = [];
let availableCategories = [];
let availableLocations = [];
let editingItemId = null;
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
 setSignedInUI(true,session.user.email||'已登入');resetIdleLogoutTimer();$('#loginMessage').textContent='';const loginDialog=$('#loginDialog');if(loginDialog?.open)loginDialog.close();$('#loginForm').reset();await loadAdminData();return true;
}
async function loadAdminData(){await Promise.all([loadCategories(),loadLocations(),loadItems(),loadTransactions()]); await loadInventory(); await loadAnalysisCategories();}
async function loadCategories(){const {data,error}=await db.from('categories').select('id,name').eq('is_active',true).order('name');if(error)return setAdminNotice(error.message,true);availableCategories=data||[];$('#categorySelect').innerHTML='<option value="">未分類</option>'+availableCategories.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');const filter=$('#inventoryCategory');if(filter){const prior=filter.value;filter.innerHTML='<option value="">全部分類</option>'+availableCategories.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');if(availableCategories.some(x=>x.id===prior))filter.value=prior;}}
async function loadLocations(){const {data,error}=await db.from('storage_locations').select('id,name').eq('is_active',true).order('name');if(error)return setAdminNotice(error.message,true);availableLocations=data||[];const options=availableLocations.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');$('#locationSelect').innerHTML='<option value="">未指定</option>'+options;const receiveLocation=$('#receiveLocation');if(receiveLocation)receiveLocation.innerHTML='<option value="">沿用物品預設位置</option>'+options;}
async function loadItems(){
 const {data,error}=await db.from('items').select('id,name,brand,unit,unit_cost,is_active,location_id,category_id,low_stock_threshold,notes,expiry_reminder_days,categories(name),storage_locations(name),inventory_batches(id,batch_label,received_date,expiry_date,remaining_quantity,purchase_total,location_id,storage_locations(name))').order('name');
 if(error)return setAdminNotice(error.message,true);currentItems=data||[];
 renderItemsTable();
 $('#receiveItem').innerHTML='<option value="">請選擇物品</option>'+currentItems.filter(i=>i.is_active).map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');
 $('#consumeItem').innerHTML='<option value="">請選擇物品</option>'+currentItems.filter(i=>i.is_active&&(i.inventory_batches||[]).some(b=>Number(b.remaining_quantity)>0)).map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');
 updateReceiveItemInfo(); updateConsumeBatches();
}
function renderItemsTable(){
 $('#itemsTable').innerHTML=currentItems.length?`<table><thead><tr><th>物品</th><th>購買通路</th><th>分類</th><th>預設位置</th><th>單位</th><th>預設單價</th><th>低庫存門檻</th><th>效期提醒天數</th><th>備註</th><th>目前庫存</th><th>狀態</th><th>操作</th></tr></thead><tbody>${currentItems.map(i=>{const qty=(i.inventory_batches||[]).reduce((sum,b)=>sum+Number(b.remaining_quantity||0),0);if(editingItemId===i.id){return `<tr class="item-edit-row" data-item-row="${i.id}"><td><input data-field="name" value="${escapeHtml(i.name)}" required aria-label="物品名稱"></td><td><input data-field="brand" value="${escapeHtml(i.brand||'')}" aria-label="購買通路"></td><td><select data-field="category_id"><option value="">未分類</option>${availableCategories.map(c=>`<option value="${c.id}" ${c.id===i.category_id?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select></td><td><select data-field="location_id"><option value="">未指定</option>${availableLocations.map(l=>`<option value="${l.id}" ${l.id===i.location_id?'selected':''}>${escapeHtml(l.name)}</option>`).join('')}</select></td><td><input data-field="unit" value="${escapeHtml(i.unit||'')}" required aria-label="計量單位"></td><td><input data-field="unit_cost" type="number" min="0" step="0.01" value="${i.unit_cost??''}" aria-label="預設單價"></td><td><input data-field="low_stock_threshold" type="number" min="0" step="0.001" value="${i.low_stock_threshold??''}" aria-label="低庫存門檻"></td><td><input data-field="expiry_reminder_days" type="number" min="0" step="1" value="${i.expiry_reminder_days??30}" aria-label="效期提醒天數"></td><td><input data-field="notes" value="${escapeHtml(i.notes||'')}" aria-label="備註"></td><td>${qty}</td><td>${i.is_active?'使用中':'已停用'}</td><td><button class="button primary small" data-save-item="${i.id}">儲存</button> <button class="button secondary small" data-cancel-item="${i.id}">取消</button></td></tr>`;}return `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.brand||'—')}</td><td>${escapeHtml(i.categories?.name||'未分類')}</td><td>${escapeHtml(i.storage_locations?.name||'未指定')}</td><td>${escapeHtml(i.unit)}</td><td>${i.unit_cost==null?'—':money(i.unit_cost)}</td><td>${i.low_stock_threshold??'—'}</td><td>${i.expiry_reminder_days??30}</td><td>${escapeHtml(i.notes||'—')}</td><td>${qty}</td><td>${i.is_active?'使用中':'已停用'}</td><td><button class="button secondary small" data-edit-item="${i.id}">編輯</button> ${i.is_active?`<button class="button secondary small" data-consume="${i.id}">領用</button> <button class="button secondary small" data-deactivate="${i.id}">停用</button>`:'—'}</td></tr>`}).join('')}</tbody></table>`:'<p>尚無物品，請先新增物品。</p>';
}
function beginInlineEdit(id){editingItemId=id;renderItemsTable();$('#itemsTable').querySelector(`[data-item-row="${id}"] [data-field="name"]`)?.focus();}
async function saveInlineEdit(id){
 const row=$(`#itemsTable [data-item-row="${id}"]`);if(!row)return;
 const get=k=>row.querySelector(`[data-field="${k}"]`)?.value??'';
 const name=get('name').trim(),unit=get('unit').trim(),cost=get('unit_cost').trim(),threshold=get('low_stock_threshold').trim(),reminder=get('expiry_reminder_days').trim();
 if(!name||!unit){alert('儲存失敗：物品名稱與計量單位不可空白。');return;}
 if(cost!==''&&(!Number.isFinite(Number(cost))||Number(cost)<0)){alert('購買單價必須是大於或等於 0 的數字。');return;}
 if(threshold!==''&&(!Number.isFinite(Number(threshold))||Number(threshold)<0)){alert('低庫存門檻必須是大於或等於 0 的數字。');return;}
 if(reminder===''||!Number.isFinite(Number(reminder))||Number(reminder)<0){alert('效期提醒天數必須是大於或等於 0 的數字。');return;}
 const payload={name,brand:get('brand').trim()||null,category_id:get('category_id')||null,location_id:get('location_id')||null,unit,unit_cost:cost===''?null:Number(cost),low_stock_threshold:threshold===''?null:Number(threshold),expiry_reminder_days:Number(reminder),notes:get('notes').trim()||null};
 const buttons=row.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
 try{
  const {error}=await db.from('items').update(payload).eq('id',id);if(error)throw error;
  const item=currentItems.find(x=>x.id===id);if(item)Object.assign(item,payload);
  editingItemId=null;renderItemsTable();
  alert('儲存成功！物品資料已更新。\n注意：既有入庫批次的存放位置仍維持各批次設定，不會跟著預設位置變更。');
  await loadItems();await loadInventory();await loadPublicExpiry();
 }catch(err){alert(`儲存失敗：${err.message||'未知錯誤'}`);buttons.forEach(b=>b.disabled=false);}
}
function updateReceiveItemInfo(){const box=$('#receiveItemInfo');if(!box)return;const item=currentItems.find(i=>i.id===$('#receiveItem').value);if(!item){box.classList.add('hidden');box.innerHTML='';return;}box.classList.remove('hidden');box.innerHTML=`<span>物品分類／所屬</span><strong>${escapeHtml(item.categories?.name||'未分類')}</strong><span>物品預設存放位置</span><strong>${escapeHtml(item.storage_locations?.name||'未指定')}</strong><small>入庫時可另選本批存放位置；未選擇則沿用物品預設位置。</small>`;const loc=$('#receiveLocation');if(loc&&!loc.value)loc.value='';}
let inventoryRows=[];
async function loadInventory(){
 const {data,error}=await db.from('items').select('id,name,brand,unit,unit_cost,is_active,location_id,category_id,categories(id,name),storage_locations(name),inventory_batches(id,batch_label,received_date,received_quantity,expiry_date,opened_date,opened_use_by_date,remaining_quantity,purchase_total,location_id,notes,storage_locations(name))').order('name');
 if(error){alert(`庫存查詢載入失敗：${error.message}`);setAdminNotice(`庫存查詢載入失敗：${error.message}`,true);return;}
 const locationSelect=$('#inventoryLocation'); const prior=locationSelect.value;
 const {data:locations, error:locError}=await db.from('storage_locations').select('id,name').eq('is_active',true).order('name');
 if(locError){setAdminNotice(`載入存放位置失敗：${locError.message}`,true);return;}
 locationSelect.innerHTML='<option value="">全部位置</option>'+(locations||[]).map(l=>`<option value="${l.id}">${escapeHtml(l.name)}</option>`).join(''); if((locations||[]).some(l=>l.id===prior))locationSelect.value=prior;
 inventoryRows=data||[]; renderInventory(inventoryRows);
}
function renderInventory(rows){
 const loc=$('#inventoryLocation').value, category=$('#inventoryCategory')?.value||'', query=$('#inventorySearch').value.trim().toLocaleLowerCase();
 const filtered=rows.filter(i=>(!category||i.category_id===category)&&(!query||i.name.toLocaleLowerCase().includes(query)||String(i.brand||'').toLocaleLowerCase().includes(query)));
 const batches=filtered.flatMap(i=>(i.inventory_batches||[]).filter(b=>Number(b.remaining_quantity)>0&&(!loc||b.location_id===loc)).map(b=>({...b,itemName:i.name,categoryName:i.categories?.name||'未分類',unit:i.unit,location:b.storage_locations?.name||i.storage_locations?.name||'未指定',brand:i.brand||'',unitCost:b.purchase_total!=null&&Number(b.received_quantity)>0?Number(b.purchase_total)/Number(b.received_quantity):Number(i.unit_cost||0),purchaseTotal:b.purchase_total!=null?Number(b.purchase_total):(i.unit_cost!=null?Number(i.unit_cost)*Number(b.received_quantity||0):null)})));
 const total=batches.reduce((sum,b)=>sum+Number(b.remaining_quantity||0),0);
 $('#inventorySummary').textContent=`符合 ${filtered.length} 項物品、${batches.length} 個有庫存批次；目前總庫存數量 ${total}`;
 $('#inventoryTable').innerHTML=batches.length?`<table><thead><tr><th>物品</th><th>分類／所屬</th><th>購買通路</th><th>存放位置</th><th>入庫日期</th><th>有效期限</th><th>開封後期限</th><th>剩餘數量</th><th>單價</th><th>本批購買金額</th><th>批次備註</th></tr></thead><tbody>${batches.map(b=>`<tr><td>${escapeHtml(b.itemName)}</td><td>${escapeHtml(b.categoryName)}</td><td>${escapeHtml(b.brand||'—')}</td><td>${escapeHtml(b.location)}</td><td>${formatDate(b.received_date)}</td><td>${formatDate(b.expiry_date)}</td><td>${formatDate(b.opened_use_by_date)}</td><td>${Number(b.remaining_quantity)} ${escapeHtml(b.unit)}</td><td>${b.unitCost==null?'未記錄':money(b.unitCost)}</td><td>${b.purchaseTotal==null?'未記錄':money(b.purchaseTotal)}</td><td>${escapeHtml(b.batch_label||'—')}</td></tr>`).join('')}</tbody></table>`:'<p>目前沒有符合條件且庫存大於 0 的批次。</p>';
}

// Excel 匯入／匯出：批次 UUID 作為不可變識別碼；空白 ID 建立新批次。
let pendingInventoryImport=null;
const INVENTORY_EXCEL_HEADERS=['批次識別碼','物品識別碼','物品名稱','分類','購買通路','存放位置','入庫日期','原始入庫數量','剩餘數量','購買總金額','單位成本','計量單位','有效期限','開封日期','開封後期限','批次標籤','批次備註'];
function inventoryExportRows(){
 const loc=$('#inventoryLocation').value,category=$('#inventoryCategory')?.value||'',query=$('#inventorySearch').value.trim().toLocaleLowerCase();
 return (inventoryRows||[]).filter(i=>(!category||i.category_id===category)&&(!query||i.name.toLocaleLowerCase().includes(query)||String(i.brand||'').toLocaleLowerCase().includes(query))).flatMap(i=>(i.inventory_batches||[]).filter(b=>Number(b.remaining_quantity)>0&&(!loc||b.location_id===loc)).map(b=>({
  '批次識別碼':b.id,'物品識別碼':i.id,'物品名稱':i.name,'分類':i.categories?.name||'','購買通路':i.brand||'',
  '存放位置':b.storage_locations?.name||i.storage_locations?.name||'', '入庫日期':b.received_date||'',
  '原始入庫數量':Number(b.received_quantity||0),'剩餘數量':Number(b.remaining_quantity||0),
  '購買總金額':b.purchase_total==null?'':Number(b.purchase_total),'單位成本':i.unit_cost==null?'':Number(i.unit_cost),
  '計量單位':i.unit||'','有效期限':b.expiry_date||'','開封日期':b.opened_date||'',
  '開封後期限':b.opened_use_by_date||'','批次標籤':b.batch_label||'','批次備註':b.notes||''
 })));
}
function exportInventoryExcel(){
 if(!window.XLSX){alert('Excel 元件載入失敗，請重新整理網頁後再試。');return;}
 const rows=inventoryExportRows();if(!rows.length){alert('目前篩選條件沒有可匯出的庫存批次。');return;}
 const ws=XLSX.utils.json_to_sheet(rows,{header:INVENTORY_EXCEL_HEADERS});ws['!cols']=[{wch:38},{wch:22},{wch:16},{wch:18},{wch:18},{wch:14},{wch:14},{wch:12},{wch:14},{wch:12},{wch:12},{wch:14},{wch:14},{wch:14},{wch:18},{wch:28}];
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'庫存批次');
 const guide=[['欄位說明','使用方式'],['批次識別碼','系統自動產生，請勿修改。空白代表新增批次。'],['物品識別碼','對應物品主檔的固定識別碼；新增批次可留白，系統只會在物品名稱唯一相符時自動對應；同名物品請填入此識別碼。'],['物品名稱','必須與物品識別碼所指向的主檔名稱相符，不可透過本功能改名或新增物品。'],['分類／購買通路／單位成本／計量單位','屬於物品主檔欄位；同一物品多批次資料若填寫衝突，該物品主檔欄位不更新。'],['剩餘數量','匯入後以此數量覆蓋目前剩餘庫存，不會累加。'],['空白識別碼','視為新增批次；重複上傳同一個完全相同檔案會依檔案指紋避免重複新增。'],['刪除 Excel 列','不會刪除網站資料庫中的庫存。'],['效期','無效期商品請留白。']];
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(guide),'使用說明');XLSX.writeFile(wb,`家庭庫存_${new Date().toISOString().slice(0,10)}.xlsx`);
}
function excelCellDate(v){if(v==null||v==='')return null;if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==='number'){const d=XLSX.SSF.parse_date_code(v);if(!d)return null;return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;}const s=String(v).trim();if(!s)return null;const m=s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;return null;}
function normalizeExcelRow(r){const get=(k)=>r[k]===undefined||r[k]===null?'':String(r[k]).trim();const num=(k)=>get(k)===''?null:Number(get(k));return {id:get('批次識別碼'),item_id:get('物品識別碼'),name:get('物品名稱'),category:get('分類'),brand:get('購買通路'),location:get('存放位置'),received_date:excelCellDate(r['入庫日期']),received_quantity:num('原始入庫數量'),remaining_quantity:num('剩餘數量'),purchase_total:num('購買總金額'),unit_cost:num('單位成本'),unit:get('計量單位'),expiry_date:excelCellDate(r['有效期限']),opened_date:excelCellDate(r['開封日期']),opened_use_by_date:excelCellDate(r['開封後期限']),batch_label:get('批次標籤'),notes:get('批次備註')};}
function sameImportNumber(a,b){if((a===null||a===undefined||a==='')&&(b===null||b===undefined||b===''))return true;const x=Number(a),y=Number(b);return Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<0.000001;}
function sameImportText(a,b){return String(a??'').trim()===String(b??'').trim();}
async function sha256File(file){const buf=await file.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',buf);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function prepareInventoryImport(file){
 const box=$('#inventoryImportPreview');box.classList.remove('hidden');box.innerHTML='<p>正在讀取 Excel…</p>';pendingInventoryImport=null;
 try{if(!window.XLSX)throw new Error('Excel 元件載入失敗。');const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});const ws=wb.Sheets[wb.SheetNames[0]];if(!ws)throw new Error('找不到工作表。');const raw=XLSX.utils.sheet_to_json(ws,{defval:'',raw:true});if(!raw.length)throw new Error('Excel 沒有資料列。');const missing=INVENTORY_EXCEL_HEADERS.filter(h=>!Object.prototype.hasOwnProperty.call(raw[0],h));if(missing.length)throw new Error(`缺少必要欄位：${missing.join('、')}。請使用網站下載的範本。`);
 const fingerprint=await sha256File(file);const rows=raw.map((r,i)=>({...normalizeExcelRow(r),sourceRow:i+2}));const {data:{user:importUser}}=await db.auth.getUser();const {data:priorImports,error:priorErr}=await db.from('inventory_import_logs').select('source_row').eq('user_id',importUser.id).eq('file_fingerprint',fingerprint);if(priorErr)throw new Error(`讀取匯入防重複紀錄失敗：${priorErr.message}。請先執行 ZIP 內的 excel_import_migration.sql。`);const priorRows=new Set((priorImports||[]).map(x=>Number(x.source_row)));
 const idGroups=new Map();rows.forEach(r=>{if(r.id){if(!idGroups.has(r.id))idGroups.set(r.id,[]);idGroups.get(r.id).push(r);}});
 const duplicateIds=new Set([...idGroups.entries()].filter(([,a])=>a.length>1).map(([id])=>id));
 const {data:items,error:itemErr}=await db.from('items').select('id,name,brand,unit,unit_cost,category_id,location_id');if(itemErr)throw itemErr;
 const {data:batches,error:batchErr}=await db.from('inventory_batches').select('id,item_id,batch_label,received_date,received_quantity,remaining_quantity,expiry_date,opened_date,opened_use_by_date,purchase_total,location_id,notes');if(batchErr)throw batchErr;
 const {data:cats,error:catErr}=await db.from('categories').select('id,name');if(catErr)throw catErr;const {data:locs,error:locErr}=await db.from('storage_locations').select('id,name');if(locErr)throw locErr;
 const itemByName=new Map(items.map(x=>[x.name.trim().toLocaleLowerCase(),x]));const itemNameMatches=new Map();items.forEach(x=>{const k=x.name.trim().toLocaleLowerCase();if(!itemNameMatches.has(k))itemNameMatches.set(k,[]);itemNameMatches.get(k).push(x);});const itemById=new Map(items.map(x=>[x.id,x]));const batchById=new Map(batches.map(x=>[x.id,x]));const catByName=new Map(cats.map(x=>[x.name.trim().toLocaleLowerCase(),x]));const locByName=new Map(locs.map(x=>[x.name.trim().toLocaleLowerCase(),x]));
 const seen=new Set();const plan=[];for(const r of rows){let status='待處理',message='';if(priorRows.has(r.sourceRow)){plan.push({...r,status:'忽略',message:'這個檔案的此列已經匯入過，避免重複建立批次'});continue;}if(r.id&&duplicateIds.has(r.id)){const first=rows.find(x=>x.id===r.id);if(r.sourceRow!==first.sourceRow){status='忽略';message='同檔案重複 ID：僅處理該 ID 第一次出現的列';plan.push({...r,status,message});continue;}}
 if(r.id){if(seen.has(r.id)){plan.push({...r,status:'忽略',message:'重複識別碼'});continue;}seen.add(r.id);const b=batchById.get(r.id);if(!b){status='失敗';message='識別碼不存在於目前資料庫';}else{const item=items.find(x=>x.id===b.item_id);if(!item||r.item_id!==b.item_id||item.name.trim()!==r.name.trim()){status='失敗';message='商品名稱與原批次不符';}else if((b.expiry_date||null)!==(r.expiry_date||null)){status='失敗';message='有效期限與原批次不符；本版不允許變更批次效期識別條件';}else if(r.remaining_quantity==null||!Number.isFinite(r.remaining_quantity)||r.remaining_quantity<0){status='失敗';message='剩餘數量必須是大於或等於 0 的數字';}else if(r.received_quantity==null||r.received_quantity<=0||r.remaining_quantity>r.received_quantity){status='失敗';message='原始入庫數量必須大於 0，且不得小於剩餘數量';}else if(r.location&&!locByName.has(r.location.toLocaleLowerCase())){status='失敗';message=`找不到存放位置「${r.location}」，請先在網站建立`; }else{const itemForCompare=items.find(x=>x.id===b.item_id);const locId=r.location?locByName.get(r.location.toLocaleLowerCase())?.id:null;const catId=r.category?catByName.get(r.category.toLocaleLowerCase())?.id:null;const batchDiff=[];if(!sameImportText(b.received_date,r.received_date))batchDiff.push('入庫日期');if(!sameImportNumber(b.received_quantity,r.received_quantity))batchDiff.push('原始入庫數量');if(!sameImportNumber(b.remaining_quantity,r.remaining_quantity))batchDiff.push('剩餘數量');if(!sameImportText(b.opened_date,r.opened_date))batchDiff.push('開封日期');if(!sameImportText(b.opened_use_by_date,r.opened_use_by_date))batchDiff.push('開封後期限');if(!sameImportNumber(b.purchase_total,r.purchase_total))batchDiff.push('購買總金額');if(!sameImportText(b.location_id||'',locId||''))batchDiff.push('存放位置');if(!sameImportText(b.notes,r.notes))batchDiff.push('批次備註');if(!sameImportText(b.batch_label,r.batch_label))batchDiff.push('批次標籤');const masterDiff=[];if(itemForCompare&&!sameImportText(itemForCompare.category_id||'',catId||''))masterDiff.push('分類');if(itemForCompare&&!sameImportText(itemForCompare.brand,r.brand))masterDiff.push('購買通路');if(itemForCompare&&!sameImportText(itemForCompare.unit,r.unit))masterDiff.push('計量單位');if(itemForCompare&&!sameImportNumber(itemForCompare.unit_cost,r.unit_cost))masterDiff.push('單位成本');if(!batchDiff.length&&!masterDiff.length){status='無變更';message='資料與資料庫相同，不需更新';}else{status='更新';message=`差異欄位：${[...batchDiff,...masterDiff].join('、')||'資料格式'}`;}}}}
 else{let item=r.item_id?itemById.get(r.item_id):null;if(!r.item_id&&r.name){const matches=itemNameMatches.get(r.name.trim().toLocaleLowerCase())||[];if(matches.length===1){item=matches[0];r.item_id=item.id;}else if(matches.length>1){status='失敗';message='有多筆同名物品，請填入正確的「物品識別碼」避免新增到錯誤物品';}}if(status!=='失敗'&&(!item||item.name.trim()!==r.name.trim())){status='失敗';message='找不到唯一且名稱相符的物品主檔；請確認物品名稱，或填入物品識別碼';}else if(status!=='失敗'&&(!r.name||!r.received_date||r.received_quantity==null||r.received_quantity<=0||r.remaining_quantity==null||r.remaining_quantity<0||r.remaining_quantity>r.received_quantity)){status='失敗';message='新增批次缺少物品、入庫日期或有效數量';}else if(status!=='失敗'&&r.location&&!locByName.has(r.location.toLocaleLowerCase())){status='失敗';message=`找不到存放位置「${r.location}」，請先在網站建立`;}else if(status!=='失敗'){status='新增';message='空白批次識別碼，已依唯一物品名稱對應主檔，將建立新批次';}}
 plan.push({...r,status,message});}
 // 同一物品若多個列填入互相衝突的主檔欄位，批次仍可處理，但主檔欄位不會被任意覆蓋。
 const masterConflicts=new Set();const grouped=new Map();plan.filter(x=>['更新','新增'].includes(x.status)).forEach(r=>{const item=itemById.get(r.item_id);if(!item||item.name.trim()!==r.name.trim())return;const key=item.id;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r);});for(const [id,list] of grouped){const sigs=new Set(list.map(r=>JSON.stringify([r.category,r.brand,r.unit,r.unit_cost])));if(sigs.size>1)masterConflicts.add(id);}
 pendingInventoryImport={rows:plan,items,batches,cats,locs,itemByName,batchById,catByName,locByName,fingerprint,masterConflicts};renderImportPreview();
 }catch(err){box.innerHTML=`<strong>無法讀取 Excel</strong><p>${escapeHtml(err.message||String(err))}</p>`;}
}
function renderImportPreview(){const box=$('#inventoryImportPreview');const p=pendingInventoryImport;if(!p)return;const count=s=>p.rows.filter(r=>r.status===s).length;const errors=count('失敗');box.innerHTML=`<h4>Excel 匯入預覽</h4><div class="preview-counts"><span>新增 ${count('新增')} 筆</span><span>更新 ${count('更新')} 筆</span><span>無變更 ${count('無變更')} 筆</span><span>忽略 ${count('忽略')} 筆</span><span>失敗 ${errors} 筆</span></div><p class="preview-note">新增批次可留白批次識別碼；物品識別碼留白時，系統僅在物品名稱唯一相符時自動對應，同名物品須填識別碼。重複 ID 僅處理該 ID 在檔案中第一次出現的資料列，後續列直接忽略且不寫入忽略紀錄。資料庫已有 ID 時，商品名稱與效期必須相符；其他批次欄位以 Excel 為準。分類、購買通路、單位成本、計量單位為物品主檔欄位；同一物品在多列出現不一致時，該物品主檔欄位本次不更新，但批次資料仍可更新。刪除 Excel 列不會刪除資料庫資料。</p><div class="preview-table"><table><thead><tr><th>Excel 列</th><th>識別碼</th><th>物品</th><th>剩餘數量</th><th>位置</th><th>判斷</th><th>說明</th></tr></thead><tbody>${p.rows.map(r=>`<tr><td>${r.sourceRow}</td><td>${escapeHtml(r.id||'（新增）')}</td><td>${escapeHtml(r.name)}</td><td>${r.remaining_quantity??'—'}</td><td>${escapeHtml(r.location||'未指定')}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.message)}</td></tr>`).join('')}</tbody></table></div><div class="preview-actions"><button type="button" class="button primary" id="confirmInventoryImport" ${p.rows.some(r=>['新增','更新'].includes(r.status))?'':'disabled'}>確認匯入</button><button type="button" class="button secondary" id="cancelInventoryImport">取消</button></div>`;}
async function confirmInventoryImport(){const p=pendingInventoryImport;if(!p)return;const btn=$('#confirmInventoryImport');if(btn){btn.disabled=true;btn.textContent='匯入處理中…';}let added=0,updated=0,ignored=p.rows.filter(r=>r.status==='忽略').length,noChange=p.rows.filter(r=>r.status==='無變更').length,failed=p.rows.filter(r=>r.status==='失敗').length;const {data:{user}}=await db.auth.getUser();
 for(const r of p.rows){if(!['新增','更新'].includes(r.status))continue;try{const item=p.itemById.get(r.item_id);if(!item||item.name.trim()!==r.name.trim())throw new Error('找不到對應的物品主檔，請確認物品識別碼及名稱');const category=r.category? p.catByName.get(r.category.toLocaleLowerCase()):null;if(r.category&&!category)throw new Error(`分類「${r.category}」不存在，請先在物品管理建立`);const location=r.location?p.locByName.get(r.location.toLocaleLowerCase()):null;
 const masterConflict=p.masterConflicts.has(item.id);const masterPayload={};if(!masterConflict){masterPayload.category_id=category?.id||null;masterPayload.brand=r.brand||null;masterPayload.unit=r.unit||item.unit;masterPayload.unit_cost=r.unit_cost;}
 if(r.status==='新增'){
  const payload={item_id:item.id,batch_label:r.batch_label||null,received_date:r.received_date,received_quantity:r.received_quantity,remaining_quantity:r.remaining_quantity,expiry_date:r.expiry_date,opened_date:r.opened_date,opened_use_by_date:r.opened_use_by_date,notes:r.notes||null,purchase_total:r.purchase_total,location_id:location?.id||null,created_by:user.id};
  const {data:newBatch,error}=await db.from('inventory_batches').insert(payload).select('id').single();if(error)throw error;
  const {error:txErr}=await db.from('stock_transactions').insert({item_id:item.id,batch_id:newBatch.id,transaction_type:'receive',quantity:r.received_quantity,quantity_delta:r.received_quantity,reason:'Excel 匯入新增',created_by:user.id});if(txErr)throw txErr;
  const {error:logErr}=await db.from('inventory_import_logs').insert({user_id:user.id,batch_id:newBatch.id,item_id:item.id,action:'import_create',source_row:r.sourceRow,file_fingerprint:p.fingerprint,before_data:null,after_data:{...payload,master_fields:masterPayload}});if(logErr)throw logErr;
  if(!masterConflict){const {error:masterErr}=await db.from('items').update(masterPayload).eq('id',item.id);if(masterErr)throw masterErr;}added++;
 }else{
  const old=p.batchById.get(r.id);const before={...old};const payload={batch_label:r.batch_label||null,received_date:r.received_date||old.received_date,received_quantity:r.received_quantity,remaining_quantity:r.remaining_quantity,opened_date:r.opened_date,opened_use_by_date:r.opened_use_by_date,notes:r.notes||null,purchase_total:r.purchase_total,location_id:location?.id||null};
  const changed=Object.keys(payload).some(k=>String(old[k]??'')!==String(payload[k]??''));const masterChanged=!masterConflict&&Object.keys(masterPayload).some(k=>String(item[k]??'')!==String(masterPayload[k]??''));if(!changed&&!masterChanged)continue;
  const {error:upErr}=await db.from('inventory_batches').update(payload).eq('id',r.id);if(upErr)throw upErr;
  if(!masterConflict&&masterChanged){const {error:masterErr}=await db.from('items').update(masterPayload).eq('id',item.id);if(masterErr)throw masterErr;}
  const delta=Number(r.remaining_quantity)-Number(old.remaining_quantity);if(delta!==0){const {error:txErr}=await db.from('stock_transactions').insert({item_id:item.id,batch_id:r.id,transaction_type:'adjustment',quantity:Math.abs(delta),quantity_delta:delta,reason:`Excel 匯入修改：庫存 ${old.remaining_quantity} → ${r.remaining_quantity}`,created_by:user.id});if(txErr)throw txErr;}
  const {error:logErr}=await db.from('inventory_import_logs').insert({user_id:user.id,batch_id:r.id,item_id:item.id,action:'import_update',source_row:r.sourceRow,file_fingerprint:p.fingerprint,before_data:before,after_data:{...payload,master_fields:masterConflict?{skipped:'同一物品多列主檔欄位不一致'}:masterPayload}});if(logErr)throw logErr;updated++;
 }
 }catch(err){failed++;console.error('Excel 匯入列處理失敗',r.sourceRow,err);r.status='失敗';r.message=err.message||'匯入失敗';}}
 pendingInventoryImport=null;$('#inventoryImportPreview').classList.add('hidden');$('#importInventoryExcel').value='';await loadAdminData();alert(`Excel 匯入完成！\n新增：${added} 筆\n修改：${updated} 筆\n無變更：${noChange} 筆\n忽略：${ignored} 筆\n失敗：${failed} 筆`);}

async function loadTransactions(){
 const {data:tx,error}=await db.from('stock_transactions').select('created_at,transaction_type,quantity,quantity_delta,reason,items(name)').order('created_at',{ascending:false}).limit(100);if(error)return setAdminNotice(error.message,true);
 const {data:imports,error:importError}=await db.from('inventory_import_logs').select('created_at,action,before_data,after_data,items(name)').order('created_at',{ascending:false}).limit(100);if(importError)return setAdminNotice(`載入 Excel 匯入異動失敗：${importError.message}`,true);
 const rows=[...(tx||[]).map(t=>({created_at:t.created_at,name:t.items?.name||'—',type:t.transaction_type,delta:`${Number(t.quantity_delta)>0?'+':''}${t.quantity_delta}`,reason:t.reason||''})),...(imports||[]).map(t=>({created_at:t.created_at,name:t.items?.name||'—',type:t.action==='import_create'?'匯入新增':'匯入修改',delta:'—',reason:t.action==='import_create'?'Excel 匯入新增庫存批次':`Excel 匯入修改：${Object.keys(t.after_data||{}).filter(k=>JSON.stringify((t.before_data||{})[k]??null)!==JSON.stringify(t.after_data[k]??null)).join('、')||'主檔欄位更新'}`}))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,100);
 $('#transactionsTable').innerHTML=rows.length?`<table><thead><tr><th>時間</th><th>物品</th><th>類型</th><th>異動量</th><th>原因</th></tr></thead><tbody>${rows.map(t=>`<tr><td>${new Date(t.created_at).toLocaleString('zh-TW')}</td><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.type)}</td><td>${escapeHtml(t.delta)}</td><td>${escapeHtml(t.reason)}</td></tr>`).join('')}</tbody></table>`:'<p>尚無異動紀錄。</p>';
}
async function editItem(id){beginInlineEdit(id);}
async function deactivateItem(id){if(!confirm('確定停用這個物品？歷史紀錄會保留。'))return;const {error}=await db.from('items').update({is_active:false}).eq('id',id);if(error)return setAdminNotice(error.message,true);setAdminNotice('物品已停用。');await loadItems();await loadPublicExpiry();}
// Delegate item-table actions from a stable parent. Re-rendering the table no longer drops click handlers.
$('#exportInventoryExcel').addEventListener('click',exportInventoryExcel);$('#importInventoryExcel').addEventListener('change',e=>{const file=e.target.files?.[0];if(file)prepareInventoryImport(file);});$('#inventoryImportPreview').addEventListener('click',e=>{if(e.target.id==='cancelInventoryImport'){pendingInventoryImport=null;$('#inventoryImportPreview').classList.add('hidden');$('#importInventoryExcel').value='';}if(e.target.id==='confirmInventoryImport')confirmInventoryImport();});
$('#itemsTable').addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.editItem){beginInlineEdit(button.dataset.editItem);return;}
 if(button.dataset.saveItem){saveInlineEdit(button.dataset.saveItem);return;}
 if(button.dataset.cancelItem){editingItemId=null;renderItemsTable();return;}
 if(button.dataset.consume){showPage('consume');$('#consumeItem').value=button.dataset.consume;updateConsumeBatches();return;}
 if(button.dataset.deactivate){deactivateItem(button.dataset.deactivate);return;}
});

$('#loginClose').addEventListener('click',()=>{ $('#loginForm').reset(); $('#loginDialog').close(); });$('#loginDialog').addEventListener('close',()=>$('#loginForm').reset());$('#refresh').addEventListener('click',refreshPublic);
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{currentFilter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderExpiry(JSON.parse($('#expiryList').dataset.rows||'[]'));}));
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
$('#tab-items').classList.remove('hidden');
const REMEMBER_EMAIL_KEY='homeInventoryRememberedEmail';
function restoreRememberedEmail(){const saved=localStorage.getItem(REMEMBER_EMAIL_KEY)||'';const emailInput=$('#loginForm')?.elements.email;if(emailInput)emailInput.value=saved;const remember=$('#rememberAccount');if(remember)remember.checked=Boolean(saved);}
restoreRememberedEmail();
$('#loginOpen').addEventListener('click',()=>{ $('#loginForm').reset(); restoreRememberedEmail(); $('#loginMessage').textContent=''; $('#loginDialog').showModal(); });
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();if(!db)return;const f=new FormData(e.currentTarget);const email=String(f.get('email')||'').trim();if($('#rememberAccount').checked)localStorage.setItem(REMEMBER_EMAIL_KEY,email);else localStorage.removeItem(REMEMBER_EMAIL_KEY);$('#loginMessage').textContent='登入中…';const {data,error}=await db.auth.signInWithPassword({email,password:f.get('password')});if(error){$('#loginMessage').textContent='登入失敗，請確認帳號、密碼與 Supabase Auth 設定。';restoreRememberedEmail();return;}const ok=await verifyAdmin(data.session);if(ok){e.currentTarget.reset();restoreRememberedEmail();$('#loginDialog').close();}});
let idleLogoutTimer=null;let idleLogoutInProgress=false;const IDLE_LOGOUT_MS=30*60*1000;
function clearIdleLogoutTimer(){if(idleLogoutTimer){clearTimeout(idleLogoutTimer);idleLogoutTimer=null;}}
function resetIdleLogoutTimer(){clearIdleLogoutTimer();if(!db||$('#logout').classList.contains('hidden')||idleLogoutInProgress)return;idleLogoutTimer=setTimeout(async()=>{if($('#logout').classList.contains('hidden'))return;idleLogoutInProgress=true;try{await db.auth.signOut();setSignedInUI(false);await loadPublicExpiry();$('#loginForm').reset();restoreRememberedEmail();$('#loginMessage').textContent='因閒置超過 30 分鐘，系統已自動登出。請重新登入後繼續使用。';$('#loginDialog').showModal();alert('閒置自動登出：您已超過 30 分鐘沒有操作，為保護帳號安全，系統已自動登出。');}finally{idleLogoutInProgress=false;clearIdleLogoutTimer();}},IDLE_LOGOUT_MS);}
['pointerdown','keydown','mousemove','touchstart','scroll'].forEach(type=>document.addEventListener(type,resetIdleLogoutTimer,{passive:true}));
$('#logout').addEventListener('click',async()=>{clearIdleLogoutTimer();await db.auth.signOut();$('#loginForm').reset();restoreRememberedEmail();setSignedInUI(false);await loadPublicExpiry();});
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
$('#receiveItem').addEventListener('change',updateReceiveItemInfo);
$('#receiveForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;await runFormSubmit('#receiveForm','確認入庫',async()=>{const f=new FormData(form);const {error}=await db.rpc('inventory_receive',{p_item_id:f.get('item_id'),p_quantity:Number(f.get('quantity')),p_expiry_date:f.get('expiry_date')||null,p_received_date:f.get('received_date')||todayISO(),p_batch_label:f.get('batch_label')||null,p_opened_date:f.get('opened_date')||null,p_opened_use_by_date:f.get('opened_use_by_date')||null,p_notes:f.get('notes')||null,p_purchase_total:f.get('purchase_total')!==''?Number(f.get('purchase_total')):null,p_location_id:f.get('location_id')||null});if(error)throw error;},'新增入庫成功！庫存批次及異動紀錄已建立。',form=>{form.elements.received_date.value=todayISO();});});
$('#inventoryLocation').addEventListener('change',()=>renderInventory(inventoryRows));$('#inventoryCategory')?.addEventListener('change',()=>renderInventory(inventoryRows));$('#inventorySearch').addEventListener('input',()=>renderInventory(inventoryRows));$('#inventoryRefresh').addEventListener('click',()=>loadInventory());

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



if(configured()&&window.supabase){db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage:window.localStorage}});db.auth.onAuthStateChange((_event,session)=>{if(session)verifyAdmin(session);else setSignedInUI(false);});loadPublicExpiry();db.auth.getSession().then(({data})=>verifyAdmin(data.session));}else{setNotice('網站前端已建立。下一步請建立新的 Supabase 專案，將 URL 與公開金鑰填入 app.js，再執行 schema.sql。');renderExpiry([]);}
