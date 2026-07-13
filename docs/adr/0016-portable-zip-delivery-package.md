# 使用可攜式 ZIP 交付分析工作簿與證據

交付匯出產生包含 `analysis.xlsx`、原始 PNG、Playwright trace 與 `manifest.json` 的 ZIP；Excel 包含 Screens、Workflows、Frontend Tasks、Backend Tasks、Cross-cutting Tasks、APIs、Data Models、Evidence 與 Run Metadata 等工作表，透過穩定 ID 關聯。Data Models 區分已觀察與建議的邏輯實體、欄位、驗證及關係，不直接產生 SQL migration、ORM schema 或正式 ERD。Cross-cutting Tasks 只保存有證據或目標技術設定依據的跨前後端／基礎設施工項，不自動套用無關的企業級樣板。Screens 工作表嵌入縮圖，完整證據與 trace 以相對路徑連結，manifest 保存穩定 ID、checksum、版本及路徑。ZIP 不依賴本機絕對路徑或 MinIO 權限，並只包含符合匯出篩選條件的最新產物；單獨取出 Excel 時仍可閱讀主要文字與縮圖，但外部附件連結不保證有效。
