# syntax=docker/dockerfile:1

# ---- Build stage: compile TypeScript to dist/ ----
FROM node:22-slim AS builder
WORKDIR /app

# Install ALL deps (incl. dev) for the build.
COPY package.json package-lock.json ./
RUN npm ci

# Compile.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage: production deps + compiled output only ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
# Config dir for the JSON state (guild-config.json, temp-rooms.json).
ENV DATA_DIR=/app/data
WORKDIR /app

# Production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled JS from the build stage.
COPY --from=builder /app/dist ./dist

# Static assets (the knock sound played on a request).
COPY assets ./assets

# Persist bot state across container restarts (mount a volume here).
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]

# Drop root.
USER node

# The bot reads its token/config from environment variables (pass with
# --env-file .env or -e). It does NOT serve HTTP — no EXPOSE needed.
CMD ["node", "dist/index.js"]
