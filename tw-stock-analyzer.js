const axiosModule = require('axios');
const axios = axiosModule.default || axiosModule;

module.exports = function(RED) {
    // --- 核心功能函式 ---

    const requestOptions = {
        timeout: 15000,
        headers: {
            "User-Agent": "Node-RED tw-stock-analyzer"
        }
    };

    const parseNumber = (value) => {
        const normalized = String(value).replace(/,/g, '').replace(/X/g, '').replace(/--/g, '').trim();
        const number = parseFloat(normalized);
        return Number.isNaN(number) ? null : number;
    };

    const parseInteger = (value) => {
        const number = parseInt(String(value).replace(/,/g, '').replace(/X/g, '').trim(), 10);
        return Number.isNaN(number) ? null : number;
    };

    const toBoolean = (value) => value === true || value === "true" || value === 1 || value === "1";

    const getMonthsInRange = (start, end) => {
        const months = new Set();
        let currentDate = new Date(start.getFullYear(), start.getMonth(), 1);
        const lastDate = new Date(end.getFullYear(), end.getMonth(), 1);
        while (currentDate <= lastDate) {
            const year = currentDate.getFullYear();
            const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
            months.add(`${year}${month}`);
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
        return Array.from(months);
    };

    const formatDateKey = (date) => date.toISOString().split('T')[0];

    function parseTwseRocDate(value) {
        const normalized = String(value).trim().replace('年', '/').replace('月', '/').replace('日', '');
        const [rocYear, month, day] = normalized.split('/');
        return new Date(parseInt(rocYear, 10) + 1911, parseInt(month, 10) - 1, parseInt(day, 10));
    }

    function toTwseDate(dateText) {
        return String(dateText).replace(/-/g, '');
    }

    /**
     * 抓取單一月份的股市資料
     */
    async function fetchDataForMonth(stockCode, month) {
        const dateStr = `${month}01`;
        const apiUrl = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${dateStr}&stockNo=${stockCode}`;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`;
        
        // 增加查詢間隔，避免請求過於頻繁
        await new Promise(resolve => setTimeout(resolve, 500));

        try {
            const response = await axios.get(apiUrl, requestOptions);
            return response.data;
        } catch (directError) {
            try {
                const response = await axios.get(proxyUrl, requestOptions);
                return response.data;
            } catch (proxyError) {
                console.error(`Error fetching data for ${stockCode} in ${month}: direct=${directError.message}; proxy=${proxyError.message}`);
                throw new Error(`無法連線至證交所 API。直連失敗：${directError.message}；代理失敗：${proxyError.message}`);
            }
        }
    }

    /**
     * 抓取指定區間的完整股市資料
     */
    async function fetchStockData(stockCode, startDate, endDate) {
        const months = getMonthsInRange(new Date(startDate), new Date(endDate));
        const fetchPromises = months.map(month => fetchDataForMonth(stockCode, month));
        const monthlyResults = await Promise.all(fetchPromises);

        let allData = [];
        let stockInfo = { code: stockCode, name: '' };
        monthlyResults.forEach(result => {
            if (result && result.stat === "OK" && result.data) {
                allData.push(...result.data);
                if (!stockInfo.name && result.title) {
                    stockInfo.name = result.title.split(' ')[2];
                }
            }
        });

        if (allData.length === 0) {
             throw new Error(`找不到 ${stockCode} 的資料，請確認代號是否正確。`);
        }

        const filteredData = allData.map(item => {
            const gregorianDate = parseTwseRocDate(item[0]);
            return { dateObj: gregorianDate, data: item };
        }).filter(item => {
            const d = item.dateObj;
            return d >= new Date(startDate) && d <= new Date(endDate);
        }).sort((a, b) => a.dateObj - b.dateObj);
        
        if (filteredData.length === 0) {
            throw new Error('您選擇的日期範圍內沒有交易資料。');
        }
        
        return {
            stockInfo: stockInfo,
            data: filteredData.map(item => {
                const d = item.data;
                return {
                    date: formatDateKey(item.dateObj),
                    volume: parseInteger(d[1]),
                    amount: parseInteger(d[2]),
                    open: parseNumber(d[3]),
                    high: parseNumber(d[4]),
                    low: parseNumber(d[5]),
                    close: parseNumber(d[6]),
                    change: parseNumber(d[7]),
                    transactions: parseInteger(d[8])
                };
            })
        };
    }

    async function fetchValuationData(stockCode, startDate, endDate, priceByDate) {
        const months = getMonthsInRange(new Date(startDate), new Date(endDate));
        const results = [];

        for (const month of months) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const apiUrl = `https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU?date=${month}01&stockNo=${stockCode}&response=json`;
            const response = await axios.get(apiUrl, requestOptions);
            const result = response.data;
            if (!result || result.stat !== "OK" || !result.data) continue;

            for (const row of result.data) {
                const date = formatDateKey(parseTwseRocDate(row[0]));
                if (date < startDate || date > endDate) continue;

                const peRatio = parseNumber(row[3]);
                const close = priceByDate[date]?.close;
                results.push({
                    date,
                    dividendYield: parseNumber(row[1]),
                    dividendYear: row[2],
                    peRatio,
                    pbRatio: parseNumber(row[4]),
                    fiscalQuarter: row[5],
                    estimatedEps: peRatio && close ? Number((close / peRatio).toFixed(2)) : null
                });
            }
        }

        return results.sort((a, b) => a.date.localeCompare(b.date));
    }

    async function fetchInstitutionalData(stockCode, dates) {
        const results = [];

        for (const date of dates) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const apiUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${toTwseDate(date)}&selectType=ALLBUT0999&response=json`;
            const response = await axios.get(apiUrl, requestOptions);
            const result = response.data;
            if (!result || result.stat !== "OK" || !result.data || !result.fields) continue;

            const row = result.data.find(item => String(item[0]).trim() === String(stockCode));
            if (!row) continue;

            const indexOf = (name) => result.fields.indexOf(name);
            const valueAt = (name) => {
                const index = indexOf(name);
                return index >= 0 ? parseInteger(row[index]) : null;
            };

            results.push({
                date,
                foreignNet: valueAt("外陸資買賣超股數(不含外資自營商)"),
                foreignDealerNet: valueAt("外資自營商買賣超股數"),
                investmentTrustNet: valueAt("投信買賣超股數"),
                dealerNet: valueAt("自營商買賣超股數"),
                totalNet: valueAt("三大法人買賣超股數")
            });
        }

        return results;
    }

    async function fetchExtraData(stockCode, startDate, endDate, processedData, options) {
        const priceByDate = Object.fromEntries(processedData.map(item => [item.date, item]));
        const extraData = {};
        const errors = [];

        if (options.includePER || options.includeEps) {
            try {
                const valuation = await fetchValuationData(stockCode, startDate, endDate, priceByDate);
                extraData.valuation = {
                    source: "TWSE BWIBBU",
                    epsNote: "estimatedEps 為同日收盤價除以本益比的推算值，不是 TWSE 直接揭露 EPS。",
                    data: valuation.map(item => ({
                        date: item.date,
                        peRatio: options.includePER ? item.peRatio : undefined,
                        estimatedEps: options.includeEps ? item.estimatedEps : undefined,
                        pbRatio: item.pbRatio,
                        dividendYield: item.dividendYield,
                        fiscalQuarter: item.fiscalQuarter
                    }))
                };
            } catch (error) {
                errors.push({ source: "TWSE BWIBBU", message: error.message });
            }
        }

        if (options.includeInstitutional) {
            try {
                extraData.institutional = {
                    source: "TWSE T86",
                    unit: "shares",
                    data: await fetchInstitutionalData(stockCode, processedData.map(item => item.date))
                };
            } catch (error) {
                errors.push({ source: "TWSE T86", message: error.message });
            }
        }

        if (errors.length > 0) extraData.errors = errors;
        return extraData;
    }
    
    /**
     * 計算各種技術指標
     */
    function calculateIndicators(data) {
        // MA
        [5, 10, 20].forEach(p => {
            for (let i = 0; i < data.length; i++) data[i]['ma' + p] = i >= p - 1 ? (data.slice(i - p + 1, i + 1).reduce((s, d) => s + d.close, 0) / p).toFixed(2) : null;
        });

        // RSI (14)
        let gains = 0, losses = 0;
        for (let i = 1; i < data.length; i++) {
            const change = data[i].close - data[i - 1].close;
            if (i < 14) { if (change > 0) gains += change; else losses -= change; }
            else if (i === 14) { gains /= 14; losses /= 14; }
            else { if (change > 0) gains = (gains * 13 + change) / 14; else losses = (losses * 13 - change) / 14; }
            if (i >= 13) data[i].rsi = (100 - (100 / (1 + (losses === 0 ? 100 : gains / losses)))).toFixed(2); else data[i].rsi = null;
        }

        // KD (9)
        for (let i = 0; i < data.length; i++) {
            if (i > 0) {
                const periodData = data.slice(Math.max(0, i - 8), i + 1);
                const lowestLow = Math.min(...periodData.map(d => d.low));
                const highestHigh = Math.max(...periodData.map(d => d.high));
                const range = highestHigh - lowestLow;
                const rsv = range === 0 ? 0 : ((data[i].close - lowestLow) / range) * 100;
                const prevK = data[i-1].k === null ? 50 : parseFloat(data[i-1].k);
                data[i].k = (prevK * 2/3) + (rsv * 1/3);
                const prevD = data[i-1].d === null ? 50 : parseFloat(data[i-1].d);
                data[i].d = (prevD * 2/3) + (data[i].k * 1/3);
                data[i].k = data[i].k.toFixed(2);
                data[i].d = data[i].d.toFixed(2);
            } else { data[i].k = null; data[i].d = null; }
        }

        // MACD (12, 26, 9)
        const ema = (source, period) => {
            let emaValues = [];
            if (source.length < period) return emaValues;
            let multiplier = 2 / (period + 1);
            emaValues[period - 1] = source.slice(0, period).reduce((sum, d) => sum + d.close, 0) / period;
            for (let i = period; i < source.length; i++) {
                emaValues[i] = (source[i].close - emaValues[i-1]) * multiplier + emaValues[i-1];
            }
            return emaValues;
        };
        const ema12 = ema(data, 12);
        const ema26 = ema(data, 26);
        for(let i = 0; i < data.length; i++) data[i].macd = (ema12[i] && ema26[i]) ? (ema12[i] - ema26[i]).toFixed(2) : null;
        
        const macdData = data.filter(d => d.macd !== null).map(d => ({close: parseFloat(d.macd)}));
        const signalEma = ema(macdData, 9);
        let signalIndex = 0;
        for(let i = 0; i < data.length; i++) {
            if(data[i].macd !== null) {
                if (signalEma[signalIndex] !== undefined) {
                    data[i].signal = signalEma[signalIndex].toFixed(2);
                    data[i].histogram = (data[i].macd - data[i].signal).toFixed(2);
                } else { data[i].signal = null; data[i].histogram = null; }
                signalIndex++;
            } else { data[i].signal = null; data[i].histogram = null; }
        }
        return data;
    }

    const DEFAULT_GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

    /**
     * 呼叫 Groq API 進行分析
     */
    async function callGroqApi(apiKey, prompt, model = DEFAULT_GROQ_MODEL) {
        if (!apiKey) {
            throw new Error("尚未設定 Groq API 金鑰。");
        }
        const apiUrl = "https://api.groq.com/openai/v1/chat/completions";
        const payload = {
            model,
            messages: [
                {
                    role: "system",
                    content: "你是謹慎的台灣股市資料分析助理。只使用繁體中文回答。不要把分析內容包裝成投資建議或保證。"
                },
                { role: "user", content: prompt }
            ],
            temperature: 0.2,
            max_tokens: 4096
        };
        
        try {
            const response = await axios.post(apiUrl, payload, {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                }
            });
            const result = response.data;
            if (!result.choices || result.choices.length === 0) {
                 throw new Error('API 回應無效，未包含任何候選內容。');
            }
            const choice = result.choices[0];
            if (choice.finish_reason && !["stop", "length"].includes(choice.finish_reason)) {
                throw new Error(`API 回應因「${choice.finish_reason}」而提前終止。`);
            }
            if (choice.message && choice.message.content) {
                return choice.message.content;
            }
            throw new Error('API 回應中未包含有效的內容。');
        } catch (error) {
            if (error.response) {
                throw new Error(`API 錯誤 (${error.response.status}): ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    /**
     * 產生不同分析類型的提示詞
     */
    function generatePrompt(type, stockInfo, data, extraData = {}) {
        const dataSample = JSON.stringify(data.slice(-30).map(d => ({ date: d.date, close: d.close, volume: d.volume, rsi: d.rsi, macd: d.macd })), null, 2);
        const extraDataText = Object.keys(extraData).length > 0 ? `\n補充資料:\n${JSON.stringify(extraData, null, 2)}\n` : "";
        let prompt = `你是一位頂尖的台灣股市金融分析師，請根據以下 ${stockInfo.name} (${stockInfo.code}) 的股票數據，提供分析。\n數據範例:\n${dataSample}\n${extraDataText}\n`;
        switch (type) {
            case 'summary':
                prompt += "請提供一個總體摘要，包括價格趨勢、成交量變化和關鍵支撐/壓力位。";
                break;
            case 'technical':
                prompt += "請深入分析技術指標，包括移動平均線(MA)、相對強弱指數(RSI)、隨機指標(KD)和MACD，並解釋它們所傳達的市場信號。";
                break;
            case 'future':
                prompt += "根據目前的技術指標和價格趨勢，請提供對未來短期（一週內）走勢的預測和可能的情境分析。";
                break;
            case 'pattern':
                 return `你是一位專業的台灣股市技術分析師，專精於 K 線型態辨識。我將提供簡化的 JSON 格式每日數據，請你根據價格走勢推斷並辨識出經典技術型態（如 W底, M頭, 頭肩底/頂, 三角形等）。
數據: ${JSON.stringify(data.slice(-60).map(d => ({ date: d.date, close: d.close })))}
${extraDataText}

你的回覆必須「只能」是一個 JSON 物件，絕對不能有其他任何文字或說明。JSON 物件格式如下：
{
  "analysis": "在這裡用中文簡要總結你發現的型態及其市場意義。",
  "patterns": [
    { "name": "型態中文名稱", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }
  ]
}`;
            case 'expert':
                return `你是一位頂尖的台灣股市金融分析師。請根據我提供的這檔股票「${stockInfo.name} (${stockInfo.code})」的歷史數據，推斷並預測該股票在「未來一日到一週內」の可能走勢。
補充資料:
${JSON.stringify(extraData, null, 2)}

你的分析應包含：
1. 趨勢判斷 (例如：偏多整理、盤整待變、偏空看待)。
2. 分析依據 (技術面、消息面)。
3. 關鍵價位 (上檔壓力區、下檔支撐區)。
請以專業、客觀且條理分明的方式呈現你的分析報告。`;

            default:
                prompt += "請提供一個簡短的摘要。";
        }
        return prompt + "\n\n請以專業、簡潔、條列式的方式呈現分析結果。";
    }

    // --- Node-RED 節點主體 ---
    function TwStockAnalyzerNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.on('input', async function(msg, send, done) {
            const stockCode = msg.payload?.stockCode;
            const startDate = msg.payload?.startDate || config.startDate;
            const endDate = msg.payload?.endDate || config.endDate;
            const apiKey = msg.apiKey || config.apiKey;
            const model = msg.payload?.model || msg.model || config.model || DEFAULT_GROQ_MODEL;
            const analysisType = msg.payload?.analysisType || config.analysisType;
            const options = {
                includeEps: toBoolean(msg.payload?.includeEps ?? config.includeEps),
                includePER: toBoolean(msg.payload?.includePER ?? config.includePER),
                includeInstitutional: toBoolean(msg.payload?.includeInstitutional ?? config.includeInstitutional)
            };

            // --- 輸入驗證 ---
            if (!stockCode || !startDate || !endDate) {
                node.status({ fill: "red", shape: "ring", text: "缺少輸入參數" });
                done(new Error("錯誤：必須提供 stockCode、startDate、endDate。日期可在節點內設定，也可由 msg.payload 覆寫。"));
                return;
            }
            if (analysisType !== 'none' && !apiKey) {
                node.status({ fill: "red", shape: "ring", text: "缺少 API Key" });
                done(new Error("錯誤：進行 AI 分析需要提供 API Key。"));
                return;
            }

            try {
                // 1. 抓取資料
                node.status({ fill: "blue", shape: "dot", text: `抓取 ${stockCode} 資料...` });
                const { stockInfo, data: rawData } = await fetchStockData(stockCode, startDate, endDate);

                // 2. 計算技術指標
                node.status({ fill: "blue", shape: "dot", text: "計算技術指標..." });
                const processedData = calculateIndicators(rawData);

                node.status({ fill: "blue", shape: "dot", text: "抓取勾選補充資料..." });
                const extraData = await fetchExtraData(stockCode, startDate, endDate, processedData, options);
                
                let aiResult = null;
                // 3. 執行 AI 推論 (如果需要)
                if (analysisType && analysisType !== 'none') {
                    node.status({ fill: "blue", shape: "dot", text: `執行 Groq ${analysisType} 分析...` });
                    const prompt = generatePrompt(analysisType, stockInfo, processedData, extraData);
                    const resultText = await callGroqApi(apiKey, prompt, model);
                    
                    if (analysisType === 'pattern') {
                        try {
                            aiResult = JSON.parse(resultText.replace(/```json/g, '').replace(/```/g, '').trim());
                        } catch(e) {
                            node.warn("AI 型態辨識回傳的並非標準 JSON，將以純文字輸出。");
                            aiResult = { analysis: resultText, patterns: [] };
                        }
                    } else {
                        aiResult = resultText;
                    }
                }
                
                // 4. 準備並送出結果
                msg.payload = {
                    stockInfo: stockInfo,
                    analysisType: analysisType,
                    model: analysisType && analysisType !== 'none' ? model : null,
                    options: options,
                    processedData: processedData,
                    extraData: extraData,
                    aiResult: aiResult,
                };
                
                node.status({ fill: "green", shape: "dot", text: `分析完成: ${stockInfo.name}` });
                send(msg);

            } catch (error) {
                node.status({ fill: "red", shape: "ring", text: "執行錯誤" });
                done(error);
            }
            
            if (done) {
                done();
            }
        });
    }
    RED.nodes.registerType("tw-stock-analyzer", TwStockAnalyzerNode);
}
