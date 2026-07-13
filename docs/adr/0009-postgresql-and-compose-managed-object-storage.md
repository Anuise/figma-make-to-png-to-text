# 使用 PostgreSQL 並由同一份 Compose 管理儲存服務

分析工具的結構化領域資料固定保存於 PostgreSQL；詳細執行 log 保存於 ClickHouse；大型產物依分析作業建立時選定的儲存模式保存於本機檔案系統或 S3 相容物件儲存。需要 S3 相容儲存時，使用同一份 Docker Compose 內的 MinIO profile；不需要時不啟用 MinIO。PostgreSQL、ClickHouse、分析工具、來源專案執行環境與可選的 MinIO 都由同一份 Docker Compose 管理，資料服務使用持久 volumes，`docker compose down` 後仍保留資料。分析作業中途不得切換儲存模式，以維持物件 URI、清理及版本追溯的一致性。工具提供手動匯出分析作業的備份方式，包含資料庫內容、產物與必要設定；第一版不做自動雲端備份或跨機同步，破壞性 volume 清除也不由 UI 執行。
