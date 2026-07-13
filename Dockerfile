# syntax=docker/dockerfile:1

# Artivault — multi-stage image. The build stage compiles the better-sqlite3
# native addon and bundles the SPA; the runtime stage ships only the built app
# and production dependencies. One container serves both the API and the GUI.

ARG NODE_VERSION=26

# --- build ------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app

# Toolchain to compile better-sqlite3 from source (node-gyp needs python3 + g++).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better layer caching) using the lockfile.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci

# Make sure the native addon and esbuild's binary are actually built/fetched,
# independent of the host's install-script approval state.
RUN npm rebuild better-sqlite3 esbuild

# Build the server (tsc + migrations copy) and the SPA (vite), then drop dev deps.
COPY . .
RUN npm run build \
  && npm prune --omit=dev

# --- runtime ----------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app

# Container-sane defaults; override PUBLIC_BASE_URL/EXPECTED_ORIGIN/RP_ID/secrets
# via env_file or -e. HOST=0.0.0.0 so the port is reachable from outside.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data

# Built app + pruned production node_modules (keeps the workspace layout intact).
COPY --chown=node:node --from=build /app ./

# Persisted data (SQLite DB + per-dataset SQLite files) lives on a volume here.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 8787

# Readiness = process up AND database reachable (see routes/health.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run node directly (not npm) so SIGTERM reaches the process for graceful shutdown.
CMD ["node", "server/dist/index.js"]
