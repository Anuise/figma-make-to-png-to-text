FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/source-projects/package.json packages/source-projects/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY apps/worker apps/worker
COPY packages/database packages/database
COPY packages/source-projects packages/source-projects

RUN npm run build --workspace=@analysis-tool/worker

CMD ["node", "apps/worker/dist/src/main.mjs"]
