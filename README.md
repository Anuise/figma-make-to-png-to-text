# Figma Make Analysis

本機分析作業骨架會啟動 Next.js 控制面、TypeScript worker 與 PostgreSQL 16。來源專案必須是設定父目錄下的直接子目錄；控制面與 worker 皆以唯讀方式掛載來源，依賴安裝與暫時修改只會發生在 worker 建立的 Working Copy。

## 啟動

需求：Windows 11、Docker Desktop WSL2 與 Docker Compose v2。

```powershell
Copy-Item .env.example .env
# 將 SOURCE_PROJECTS_ROOT 改成 Windows 上既有父目錄的絕對路徑。
docker compose up --build
```

開啟 [http://localhost:3000](http://localhost:3000)。若修改 `WEB_PORT`，請使用對應的 host port。

## 停止與資料保留

```powershell
docker compose down
```

`docker compose down` 會停止並移除容器，但保留 PostgreSQL 與分析資料的 named volumes；下次 `docker compose up` 後，既有 Analysis Runs 與 Source Revisions 仍可查閱。

`docker compose down -v` 會不可逆地刪除本機 Analysis Runs、Source Revisions 與 Working Copies，只應在確定不再需要資料時執行。

## 設定

- `SOURCE_PROJECTS_ROOT`：來源專案父目錄的 Windows 絕對路徑。只能選擇其安全、非 symlink 的直接子目錄。
- `WEB_PORT`：控制面 host port，預設 `3000`。
- `POSTGRES_PORT`：PostgreSQL host port，預設 `54329`。
