# node-red-contrib-tw-stock-analyzer

台股個股分析 Node-RED 節點。功能包含 TWSE 日成交資料、技術指標、Groq 分析、本益比、EPS 推算與三大法人買賣超。

## 安裝

```powershell
cd C:\Users\User\.node-red
npm install "E:\Codex\台股智能分析\node-red-contrib-tw-stock-analyzer"
```

重啟 Node-RED 後，在節點清單搜尋 `智慧股市分析`。

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
