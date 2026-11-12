# Command Atlas

指令查詢工作台。純靜態網站，不需要打包工具。想客製化的話，clone 這個 repo、改 `commands.json`、透過 GitHub Actions 或任何靜態主機 deploy 即可。格式如下：

## 怎麼用

網站：

https://moonking60144-collab.github.io/command-cheatsheet/

1. 開啟網站後，直接在搜尋框輸入關鍵字。
2. 搜尋會同時比對：
   - `command`
   - `description`
   - `tags`
   - `category`
3. 你可以先點分類按鈕，再輸入關鍵字縮小範圍。
4. 若指令有 `<佔位符>`，卡片會出現輸入框，填好後再按「複製」，複製的是替換完成的指令。
5. 頁面會記住你上一次的搜尋狀態。

## 如何新增或修改指令

常改的檔案是 `commands.json`。每一筆資料建議長這樣：

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
- `command`：實際指令。若指令包含需要自填的值，用 `<角括號>` 標記，例如 `git switch -c <分支名稱>`，卡片會自動顯示輸入框，填完後複製即可得到替換後的完整指令
- `description`：你之後搜尋和閱讀時會看到的主要說明
- `tags`：補充關鍵字，讓搜尋更好找
- `notes`：進一步備註，可省略

### 一張卡要放好幾個相近指令（variants）

像 `shutdown` 關機/重開/休眠/取消，用 tab 切換比分散成 5 張卡清爽，寫法：

```json
{
  "id": "windows-shutdown",
  "category": "Windows Process & Service",
  "description": "Windows 關機、重開、休眠、登出等。",
  "variants": [
    { "label": "關機",   "command": "shutdown /s /t 0" },
    { "label": "重開機", "command": "shutdown /r /t 0" },
    { "label": "休眠",   "command": "shutdown /h" }
  ],
  "tags": ["windows", "shutdown", "power"],
  "notes": "會立刻執行，沒有倒數。遠端機器請先確認影響。"
}
```

有 `variants` 這個陣列，最外層就不用再寫 `command`，`description` / `tags` / `notes` 還是照舊由這張卡共用。`label` 是 tab 上顯示的字，越短越好。

## 鍵盤快捷鍵

- `/` 或 `Ctrl+K`：聚焦搜尋框（捲到中段會自動抓快速搜尋那條）
- `Esc`：清空目前的搜尋和分類，原地不動
- `[` `]`：切上一個 / 下一個分類
- 卡片上按 `Enter` 或 `Space`：複製指令
- `?`（右上角那顆）：打開這份清單


