# 家庭庫存管理平台｜溫馨家庭版 v2

此版本採用固定左側選單與右側單頁內容。首頁只顯示效期提醒；管理者登入後，可從左側切換物品管理、新增入庫、領用出庫及異動紀錄。主題使用奶油米白、鼠尾草綠與淺木色。網站使用純 HTML/CSS/JS，部署到 GitHub Pages；資料與登入使用既有 Supabase 專案。

## 重要安全原則

- 不要把 `service_role` / secret key 放入 `app.js`、GitHub 或任何瀏覽器前端。
- 公開訪客只呼叫 `public_expiry_list()`，該函式只回傳物品名稱、分類、有效期限及「已過期／即將到期」狀態。
- 其他資料表皆啟用 RLS，只有 `profiles.is_admin = true` 的登入使用者可管理資料。
- 第一版不應存放敏感個資；公開效期頁不顯示數量、位置、購買或領用紀錄。

## 建置步驟

### 1. 建立全新 Supabase 專案

1. 登入 Supabase，建立一個新的 project，名稱可用 `home-inventory`。
2. 在 Project Settings / API（或 Connect）取得 Project URL 與 publishable key（舊專案可能顯示 `anon` key）。
3. 請勿使用或公開 `service_role` / secret key。

### 2. 建立資料庫

1. 開啟新專案的 SQL Editor。
2. 貼上並執行 `schema.sql`。
3. 確認建立 `profiles`、`categories`、`storage_locations`、`items`、`inventory_batches`、`stock_transactions` 與函式。

### 3. 建立管理者登入

1. 在 Supabase Authentication / Users 建立或邀請管理者帳號。
2. 複製該使用者的 UUID。
3. 在 SQL Editor 執行以下語句，將 UUID 換成剛才複製的真實 UUID：

```sql
insert into public.profiles (user_id, display_name, is_admin)
values ('替換成管理者使用者UUID', '家庭庫存管理者', true)
on conflict (user_id) do update set is_admin = true;
```

只有這個被明確授權的帳號才會通過管理者檢查。不要讓瀏覽器端自行設定 `is_admin`。

### 4. 連接前端

開啟 `app.js`，修改最上方兩個常數：

```js
const SUPABASE_URL = '你的新專案 Project URL';
const SUPABASE_ANON_KEY = '你的 publishable 或 anon key';
```

不要填 service role key。

### 5. 初始分類與位置（可選）

在 SQL Editor 執行：

```sql
insert into public.categories(name) values
('精油'), ('保健品'), ('日用品'), ('食品')
on conflict (name) do nothing;

insert into public.storage_locations(name) values
('廚房'), ('冰箱'), ('浴室'), ('臥室收納櫃')
on conflict (name) do nothing;
```

### 6. GitHub Pages 部署

1. 建立全新 GitHub Repository，例如 `home-inventory`。
2. 上傳 `index.html`、`styles.css`、`app.js`（`schema.sql` 與 README 也可以一併保存，但不要把任何 secret key 寫進檔案）。
3. 到 Repository → Settings → Pages，選擇從 `main` 分支的 `/ (root)` 部署。
4. 等待 Actions / Pages 顯示成功，再開啟網站測試。

## 第一版測試清單

- 未登入只能看到效期清單，不能直接讀取 items、batches 或 transactions 資料表。
- 未登入直接呼叫 `inventory_receive` / `inventory_remove` 必須失敗。
- 管理者能建立物品及入庫批次。
- 領用量不可大於該批次剩餘量。
- 同一物品不同效期必須是不同批次。
- 停用品項不會出現在公開效期頁。
- 過期／即將到期狀態會依資料庫日期計算。

## 開發狀態與限制

這是第一版起始包，並非已部署或已連接你的 Supabase 專案。需完成新專案設定、管理者授權與實機測試後才可正式使用。領用介面目前在物品只有單一有庫存批次時可直接操作；多批次領用選擇、分類/位置新增管理介面、完整盤點與報廢介面、備份/還原流程仍需在後續迭代補齊。`schema.sql` 已提供批次、交易紀錄及基本安全政策作為起點。
