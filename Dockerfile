# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- run ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8787 DATABASE_PATH=/data/eeos.db
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/server/seed/demo-seed.json ./server/seed/demo-seed.json
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "dist-server/index.js"]
