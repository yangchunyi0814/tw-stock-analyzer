# node-red-contrib-tw-stock-analyzer

台股個股分析 Node-RED 節點。功能包含 TWSE 日成交資料、技術指標、Groq 分析、本益比、EPS 推算與三大法人買賣超。

## 安裝

```powershell
cd ~/.node-red
npm install https://github.com/yangchunyi0814/tw-stock-analyzer.git
```

重啟 Node-RED 後，在節點清單搜尋 `智慧股市分析`。

Windows 若 PowerShell 無法正確解析 `~/.node-red`，請改用你的 Node-RED 使用者目錄，例如：

```powershell
cd "$env:USERPROFILE\.node-red"
npm install https://github.com/yangchunyi0814/tw-stock-analyzer.git
```

## 基本輸入

```json
{
  "stockCode": "2330",
  "startDate": "2026-07-01",
  "endDate": "2026-07-03",
  "analysisType": "summary"
}
```

## 補充資料選項

```json
{
  "stockCode": "2330",
  "startDate": "2026-07-01",
  "endDate": "2026-07-03",
  "analysisType": "summary",
  "includeEps": true,
  "includePER": true,
  "includeInstitutional": true
}
```

## 注意

- `includeEps` 產生的是 `estimatedEps`，算法是同日收盤價除以本益比。
- Groq API Key 可填在節點內，也可用 `msg.apiKey` 覆寫。
- 若不需要 AI 分析，將 `analysisType` 設為 `none`。
