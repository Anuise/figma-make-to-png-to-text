# 可持久化本機分析作業骨架設計

## 目標

建立 Issue #2 所需的最小可運作骨架：單一本機使用者可透過 Docker Compose 啟動 Next.js 控制面、TypeScript worker 與 PostgreSQL 16，從唯讀來源父目錄選擇專案，建立不可變來源版本與獨立工作副本，並在服務重啟後繼續查閱分析作業。

## 範圍與假設

- 本階段只包含 `web`、`worker` 與 PostgreSQL 16，不加入 `ai-worker`、ClickHouse 或 MinIO。
- 正式支援環境是 Windows 11、Docker Desktop WSL2 backend 與 Docker Compose v2。
- 使用 npm workspaces 管理 Next.js 應用程式、worker 與共享程式碼。
- PostgreSQL 是分析作業、來源版本與工作佇列的唯一真相來源。
- 來源父目錄由主機環境變數設定，並以唯讀 bind mount 掛載至容器固定路徑 `/sources`。
- 第一版只列出 `/sources` 的直接子目錄；UI 與資料庫只保存相對子路徑。
- 來源版本快照與工作副本保存於 Docker named volume，服務重啟不會刪除。

## 架構

### Web

Next.js 提供單頁控制面與 HTTP API。控制面列出可選來源專案、允許建立分析作業，並顯示既有分析作業的狀態、來源相對路徑、fingerprint 與來源版本。

API 負責：

- 列出唯讀來源父目錄下的直接子目錄。
- 驗證使用者提交的相對路徑確實位於 `/sources` 內。
- 以單一資料庫交易建立 Analysis Run 與 queued job。
- 查詢 Analysis Run 與其 Source Revision。

Web 不在 HTTP request 中複製來源或計算 fingerprint；這些可延長的工作交由 worker 執行。

### Worker

TypeScript worker 透過 PostgreSQL 輪詢 queued job，使用 `FOR UPDATE SKIP LOCKED` 原子取得工作。雖然第一版只有一個 worker，資料庫鎖仍避免服務重啟或未來誤啟多個程序時重複領取同一工作。

worker 依序：

1. 將 Analysis Run 標記為 `preparing`。
2. 再次驗證來源相對路徑仍位於 `/sources` 內。
3. 以排序後的相對檔名、檔案型別與內容計算 SHA-256 fingerprint。
4. 將來源複製到該 Source Revision 專屬的不可變快照目錄。
5. 從快照建立該 Analysis Run 專屬 Working Copy。
6. 在同一資料庫交易保存 Source Revision、更新 Analysis Run 關聯，並完成 job。

任何步驟失敗時，worker 保存可讀錯誤訊息並將 Analysis Run 與 job 標記為 `failed`。重新啟動 worker 後，超過租約時間的 `processing` job 會回到 `queued`，但已完成的 Source Revision 不會被覆寫。

### PostgreSQL

採版本化 SQL migration 與 `node-postgres`，不引入 ORM 或外部 queue 套件。最小資料模型如下：

- `analysis_runs`
  - `id`: UUID
  - `source_relative_path`: 使用者選擇的相對子路徑
  - `status`: `queued | preparing | ready | failed`
  - `source_revision_id`: nullable UUID
  - `error_message`: nullable text
  - `created_at`, `updated_at`
- `source_revisions`
  - `id`: UUID
  - `analysis_run_id`: unique UUID
  - `fingerprint`: SHA-256 hex
  - `snapshot_path`: volume 內的不可變快照路徑
  - `working_copy_path`: 該 run 專屬工作副本路徑
  - `created_at`
- `jobs`
  - `id`: UUID
  - `analysis_run_id`: unique UUID
  - `status`: `queued | processing | completed | failed`
  - `attempts`, `locked_at`, `error_message`
  - `created_at`, `updated_at`

資料庫約束確保一個 Analysis Run 在本階段只有一個 Source Revision 與一個準備 job。

## 路徑與隔離

所有由 UI 提交的路徑必須是單一相對子目錄名稱。Web 與 worker 都以 `realpath` 解析來源父目錄與候選目錄，並確認候選目錄的父路徑等於來源父目錄；絕對路徑、`..`、巢狀路徑、檔案及逃逸父目錄的 symlink 均拒絕。

Compose 對 `web` 與 `worker` 掛載相同的唯讀 `/sources`。只有 `worker` 可寫入來源版本與工作副本 volume。依賴安裝與暫時修改不屬於本 Issue，但後續只能發生於 `working_copy_path`，不能發生於來源 mount 或不可變快照。

## 資料流

1. 使用者開啟控制面；Web 從 `/sources` 列出可選目錄。
2. 使用者選擇一個目錄並建立 Analysis Run。
3. Web 在 PostgreSQL 建立 `queued` Analysis Run 與 job，立即回傳 run ID。
4. worker 取得 job，建立 fingerprint、Source Revision 快照與 Working Copy。
5. worker 將 Analysis Run 標記為 `ready`。
6. 控制面輪詢 run API 並顯示完成資料。
7. Compose 服務重啟後，Web 從 PostgreSQL 重新列出 run；快照與工作副本仍位於 named volume。

## 錯誤處理

- 來源根目錄未設定或不可讀：來源列表 API 回傳服務設定錯誤，UI 顯示原因。
- 相對路徑無效或逃逸來源父目錄：建立 API 回傳 `400`，不建立任何資料。
- 建立 run 的資料庫交易失敗：run 與 job 都不建立。
- 來源在排隊後被刪除或改成不安全路徑：worker 將 run 標記為 `failed`。
- 複製或 fingerprint 失敗：worker 清理該次未完成目錄，保存錯誤狀態，不修改來源。
- worker 中途終止：租約逾時後 job 可重新排隊；使用固定 run/revision 目錄與原子 rename，避免把半成品視為完成版本。

## 測試接縫

測試只透過可公開觀察的接縫驗證行為：

- HTTP API：來源列表、拒絕不安全路徑、建立與查詢 Analysis Run。
- PostgreSQL 與檔案系統整合：worker 建立 fingerprint、不可變快照、獨立 Working Copy 與持久狀態。
- Docker Compose smoke test：`web`、`worker`、PostgreSQL 16 健康啟動。
- 重啟驗收：建立 run 後重新啟動 Compose 服務，確認 run、revision、snapshot 與 working copy 仍可查閱。

測試不直接呼叫 worker 私有函式、不斷言 SQL 實作細節，也不測 React 元件內部結構。

## 驗收條件對應

1. Compose 定義與 smoke test 證明 Windows 11、Docker Desktop WSL2、Compose v2 可啟動 Next.js、TypeScript worker 與 PostgreSQL 16。
2. 唯讀 `/sources`、雙重 canonical-path 驗證、revision snapshot 與 run 專屬 Working Copy 證明來源不被修改。
3. `analysis_runs`、`source_revisions`、`jobs` 以及 worker 整合測試證明 fingerprint、不可變來源版本與作業狀態均被保存。
4. PostgreSQL 與檔案 named volumes 加上重啟驗收，證明既有 Analysis Run 與 Source Revision 在服務重啟後仍可查閱。

## 不在本 Issue 範圍

- 安裝來源專案依賴或啟動來源網站。
- Playwright 探索、截圖、Human Review 或分析 pipeline。
- Python `ai-worker`、ClickHouse、MinIO 或 Delivery Export。
- 分析作業取消、局部重跑、來源更新比較或跨 run 共用 Source Revision。
- 登入、權限、多人協作或集中部署。
