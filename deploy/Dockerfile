# syntax=docker/dockerfile:1
FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org

FROM dependencies AS build
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY server ./server
COPY web ./web
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
RUN npm run build
# 运行镜像不需要 TypeScript、Vite 或测试工具。
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=18771 STATE_DIR=/app/storage CONFIG_FILE=/app/config/config.env
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/holic512/ocs-answer-hub"
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY server/config.ts ./server/config.ts
COPY deploy/config.env.example ./defaults/config.env
COPY deploy/compose.yaml ./defaults/compose.yml
COPY deploy/deploy.sh ./defaults/deploy.sh
RUN node node_modules/@prisma/engines/scripts/postinstall.js \
    && mkdir -p /app/config /app/storage \
    && chown node:node /app/config /app/storage
USER node
EXPOSE 18771
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD ["node","dist/server/deployment.js","health"]
ENTRYPOINT ["node","dist/server/deployment.js"]
CMD ["start"]
