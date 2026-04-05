# Command Atlas

一個可搜尋、可分類、可離線使用的指令查詢工作台。這個專案是純靜態網站，不需要打包工具，適合直接部署到 GitHub Pages。

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
