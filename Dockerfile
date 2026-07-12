# Deterministic build for the bot-server, bypassing nixpacks (whose npm-based
# auto-detection fought this pnpm workspace). Pin pnpm to package.json's
# `packageManager` version and let it read build-script approvals from
# pnpm-workspace.yaml so pnpm 10 does not abort on ignored builds.
FROM node:20-slim

WORKDIR /app
# CI=true so pnpm runs non-interactively (no TTY prompts).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true

# Provide pnpm 10.23.0 on PATH via corepack (bundled with Node).
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

# Copy manifests + lockfile first as their own layer. This guarantees the
# lockfile is present for a frozen install and avoids reusing a stale COPY cache.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot-server/package.json ./apps/bot-server/
RUN pnpm install --frozen-lockfile

# Copy the rest of the source and compile TypeScript to dist/.
COPY . .
RUN pnpm build

# Run the built server directly — no pnpm needed at runtime. Env comes from Railway.
CMD ["node", "apps/bot-server/dist/index.js"]
