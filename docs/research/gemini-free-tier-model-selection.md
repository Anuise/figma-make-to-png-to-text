# Gemini API Free Tier 與模型選型

研究日期：2026-07-13

## 結論

第一版建議使用 `gemini-3.5-flash` 作為主要模型，`gemini-3.1-flash-lite` 作為遭遇 rate limit 時的降級模型。兩者都支援文字、圖片、PDF 等輸入、structured outputs，且輸入上限為 1,048,576 tokens、輸出上限為 65,536 tokens。3.5 Flash 的官方定位是高智慧、agentic、多步驟與長時間任務；3.1 Flash-Lite 則定位為高量、簡單資料處理與低成本工作。來源：[3.5 Flash model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash)、[3.1 Flash-Lite model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)。

不建議把 Free Tier 的 RPM、TPM 或 RPD 寫死在程式碼。Google 明確說明限額依 project（不是 API key）套用，實際限額會隨 usage tier 與 account status 更新，且「specified rate limits are not guaranteed」；使用者應在 [Google AI Studio active rate limits](https://aistudio.google.com/)，查看該 API key 所屬 project 的目前值。來源：[Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)。

## Free Tier 速率限制

Google 的公開文件定義三個主要維度：requests per minute（RPM）、input tokens per minute（TPM）及 requests per day（RPD）；任一維度超過都會觸發 rate-limit error，RPD 於 Pacific time 午夜重設。公開頁面沒有對所有模型保證一組固定的 Free Tier RPM/TPM/RPD 數字，而是要求從 AI Studio 查看 active limits。來源：[Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)。

因此本工具應：

- 在設定頁顯示使用者目前 project、model 與可配置的 RPM/TPM/RPD（由使用者從 AI Studio 核對或由 API 錯誤回報更新）。
- 以 token-aware queue 控制並發，不只用固定 sleep；對 `429 RESOURCE_EXHAUSTED` 使用 exponential backoff、Retry-After（若回應提供）及可續跑 checkpoint。
- 將每次請求、模型、估計 input/output tokens、429 次數與重試狀態寫入 Run Metadata。
- 讓模型與 limit policy 可由環境設定覆寫；Free Tier 限額改變時不需重新部署。

## 模型比較與選擇

| 模型 | 官方能力／定位 | 本專案用途 | 判斷 |
|---|---|---|---|
| `gemini-3.5-flash` | 文字、圖片、影片、音訊、PDF；structured outputs；1M input / 65K output；官方定位為 frontier-level、agentic、多步驟與長期任務 | 由截圖、trace、程式碼產生工作流、工項與 API 草稿 | **主要模型**，品質與多模態推理較適合核心分析 |
| `gemini-3.1-flash-lite` | 文字、圖片、影片、音訊、PDF；structured outputs；1M input / 65K output；官方定位為高量、快速、簡單資料處理 | 大量畫面摘要、證據預處理、3.5 Flash 受限時降級 | **降級／預處理模型**，降低 token 與 rate-limit 壓力 |
| `gemini-2.5-flash` | 文字、圖片、影片、音訊、PDF；structured outputs；1M input / 65K output；stable | 若 3.x 在使用者 project 不可用時的相容 fallback | 備援 |
| `gemini-2.5-pro` | 文字、圖片、影片、音訊、PDF；structured outputs；1M input / 65K output；官方定位為複雜 reasoning 與 coding | 少量、疑難的人工重試分析 | 不作預設；品質可能高但 Free Tier 資源更緊 |

來源：[Models](https://ai.google.dev/gemini-api/docs/models)、[3.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash)、[3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)、[2.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash)、[2.5 Pro](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro)。

## 成本與資料使用注意

目前 pricing 頁將 3.5 Flash、3.1 Flash-Lite、2.5 Flash、2.5 Pro 的 Standard Free Tier input/output 標示為 free of charge；Free Tier 的模型輸入可能被 Google 用於改善產品（pricing 表的 `Used to improve our products` 欄位為 `Yes`）。因此這個工具在送出來源程式碼前仍須執行既定的敏感檔案與 secret 排除，並在 UI 明確告知使用者。來源：[Pricing](https://ai.google.dev/gemini-api/docs/pricing)。

## Structured output 約束

Google Gemini API 支援以 JSON Schema 約束輸出，GenAI SDK 可使用 Pydantic 或 Zod；但 structured output 只支援 JSON Schema 子集（例如 object、array、string、number、integer、boolean、null，以及 properties、required、enum 等）。因此 pipeline 應在本機以 JSON Schema/Pydantic 再驗證模型回應，驗證失敗只重試該階段，不重跑 Playwright。來源：[Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)。

## 建議的第一版 policy

```text
primaryModel = gemini-3.5-flash
fallbackModel = gemini-3.1-flash-lite
legacyFallback = gemini-2.5-flash
maxConcurrentRequests = 1 (Free Tier conservative default)
retry = exponential backoff on 429/5xx, bounded attempts
checkpoint = persist after each model response and each validated artifact
```

`maxConcurrentRequests = 1` 是本工具的保守預設，不是 Google 公告的限額；使用者可在本機設定中調高，但仍須以 AI Studio active limits 為準。
