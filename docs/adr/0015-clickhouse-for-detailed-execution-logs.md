# 使用 ClickHouse 保存詳細執行 log

PostgreSQL 維持分析作業狀態、queue、版本、checkpoint 與領域資料的唯一真相來源；同一份 Docker Compose 內的 ClickHouse 保存追加式詳細執行事件，包含作業、階段、批次、時間、level、事件類型、耗時、token、模型及錯誤分類。所有 log 寫入前強制遮蔽 API key、token、密碼、cookie 與表單敏感值，預設 TTL 為 30 天且可調整；大型截圖、trace 與 AI payload 只保存物件 URI 及 checksum。UI 透過後端查詢摘要，不直接連線 ClickHouse；ClickHouse 暫時不可用時，worker 暫存有限事件並於恢復後補送，不得令分析作業失敗。
