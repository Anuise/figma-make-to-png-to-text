# 使用背景 worker 並固定執行環境版本

同一份 Docker Compose 內由 Next.js `web` 提供控制面，TypeScript `worker` 執行來源複製、依賴安裝、Playwright 探索、截圖、pipeline 與 Excel，Python `ai-worker` 封裝 Antigravity SDK，PostgreSQL 16 同時保存領域資料與 job queue，可選的 MinIO 保存 S3 相容物件。長時間工作不在 HTTP request handler 內執行，也不新增 Redis、RabbitMQ 或 Kafka。多個分析作業可以排隊，但全系統同時只執行一個；使用者可安全取消 active job，worker 在可中斷點停止、保留已驗證 checkpoint、清理來源程序與暫時資源，並允許稍後續跑。Python 固定 3.13 並一律使用 `uv` 管理及鎖定依賴；SDK 啟動與最小請求納入早期 smoke test。
