# The whole app in one image: the backend serves the API and the built frontend.
#   docker compose --profile app up --build      with the Postgres from docker-compose.yml
#   docker build -t saystreet . && docker run --env-file .env -p 8080:8080 saystreet

# ---- Build: install everything, generate the Prisma client, bundle backend and frontend ----
FROM node:26-alpine AS build
RUN npm install -g pnpm@12.18.0
WORKDIR /app

# Dependencies first, so a code change doesn't reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages packages
RUN pnpm build

# ---- Run: production dependencies plus the Prisma CLI for migrations at start ----
FROM node:26-alpine
RUN npm install -g pnpm@12.18.0
WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/packages/backend/package.json packages/backend/
COPY --from=build /app/packages/backend/prisma packages/backend/prisma
COPY --from=build /app/packages/backend/prisma.config.ts packages/backend/
COPY --from=build /app/packages/backend/dist packages/backend/dist
COPY --from=build /app/packages/frontend/package.json packages/frontend/
COPY --from=build /app/packages/frontend/dist packages/frontend/dist
# The backend's dependencies only. `pnpm start` runs `prisma migrate deploy`, so its dev
# dependencies (the Prisma CLI) are installed too; NODE_ENV is set after, or pnpm would skip them.
RUN pnpm install --frozen-lockfile --filter @saystreet/backend...

ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
CMD ["pnpm", "start"]
