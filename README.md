# Command Atlas

一個可搜尋、可分類、可離線使用的指令查詢工作台。這個專案是純靜態網站，不需要打包工具，適合直接部署到 GitHub Pages。

## 專案位置

- WSL 路徑：`/mnt/c/Users/moonk/Personal/command-cheatsheet`
- Windows 路徑：`C:\Users\moonk\Personal\command-cheatsheet`

如果你在 WSL 操作，請用 `/mnt/c/...` 路徑；如果你在 Windows PowerShell 操作，請用 `C:\...` 路徑。

## 你現在拿到什麼

- `index.html`：主畫面與版面結構
- `styles.css`：視覺樣式與 responsive 版面
- `app.js`：搜尋、分類、複製、狀態保存、Service Worker 註冊
- `commands.json`：指令資料庫
- `manifest.json`：PWA 設定
- `sw.js`：離線快取邏輯
- `.github/workflows/deploy.yml`：GitHub Pages 自動部署

## 日常怎麼用

1. 開啟網站後，直接在搜尋框輸入關鍵字。
2. 搜尋會同時比對：
   - `command`
   - `description`
   - `tags`
   - `category`
3. 你可以先點分類按鈕，再輸入關鍵字縮小範圍。
4. 卡片右上角按「複製」即可把指令帶走。
5. 頁面會記住你上一次的搜尋狀態。

## 本機預覽

### 在 WSL 預覽

```bash
cd /mnt/c/Users/moonk/Personal/command-cheatsheet
python3 -m http.server 4173
```

然後打開 [http://localhost:4173](http://localhost:4173)。

### 在 Windows PowerShell 預覽

```powershell
cd C:\Users\moonk\Personal\command-cheatsheet
py -m http.server 4173
```

然後打開 [http://localhost:4173](http://localhost:4173)。

## 如何新增或修改指令

最常改的檔案是 `commands.json`。每一筆資料建議長這樣：

```json
{
  "id": "git-log-graph",
  "category": "Git",
  "command": "git log --oneline --graph --decorate --all",
  "description": "快速查看 commit 歷史、分支位置與 merge 走向。",
  "tags": ["git", "history", "log"],
  "notes": "很適合排查這條分支是從哪裡分出去的。"
}
```

### 欄位說明

- `id`：唯一識別值，建議不要重複
- `category`：分類名稱，前端會拿這個生成篩選按鈕
- `command`：實際指令
- `description`：你之後搜尋和閱讀時會看到的主要說明
- `tags`：補充關鍵字，讓搜尋更好找
- `notes`：進一步備註，可省略

### 維護建議

- 分類名稱請固定寫法，不要今天 `Powershell`、明天 `PowerShell`
- `description` 寫成「這條指令拿來做什麼」最有價值
- `tags` 用你自己真的會拿來搜尋的詞，不要只堆漂亮名詞
- 新增完至少本機預覽一次，確認沒有 JSON 格式錯誤

## 如何部署到 GitHub Pages

### 第一次部署

1. 在 GitHub 建立一個新的 repository。
2. 把這個專案內容推上去。
3. 到 GitHub repository 的 `Settings > Pages`。
4. Source 選 `GitHub Actions`。
5. 之後只要 push 到 `main`，workflow 就會自動部署。

### 推送範例

```bash
git init
git add .
git commit -m "Initial Command Atlas"
git branch -M main
git remote add origin <你的 repository URL>
git push -u origin main
```

## 後續維護怎麼分工

### 只想加新指令

只改 `commands.json` 就好。這是最常見、也最安全的維護方式。

### 想調整畫面外觀

改 `styles.css`。像是色彩、間距、卡片造型、字體、手機版排版都在這裡。

### 想改搜尋與互動

改 `app.js`。像是：

- 搜尋規則
- 複製按鈕邏輯
- 快捷鍵
- localStorage 狀態記憶
- 分類按鈕生成

### 想調整離線策略

改 `sw.js`。目前採用：

- 安裝時先快取核心檔案
- 平時優先向網路拿新版
- 沒網路時回退到快取

這種做法的好處是 `commands.json` 更新後，比較容易讓使用者拿到新版，不需要你每次手動改 cache key。

## 常見注意事項

- 不要直接雙擊 `index.html` 預覽，因為瀏覽器會擋 `fetch('commands.json')`
- 一定要透過本機伺服器，例如 `python3 -m http.server 4173`
- 如果你改了 `commands.json` 但畫面沒更新，先重新整理一次
- 如果你大改了 `app.js` 或 `styles.css`，可以在瀏覽器做一次 hard refresh

## 下一步你可以做什麼

你可以先做這三件事：

1. 先把 `commands.json` 改成你自己常用的指令
2. 用本機伺服器跑起來，確認搜尋與分類符合你的使用習慣
3. 建 GitHub repo，打開 GitHub Pages 的 `GitHub Actions` 部署
