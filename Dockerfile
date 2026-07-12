# Deterministic build for the bot-server, bypassing nixpacks (whose npm-based
# auto-detection fought with this pnpm workspace). We pin pnpm to the version in
# package.json's `packageManager` field and let it read the build-script approvals
# from pnpm-workspace.yaml / package.json, so pnpm 10 does not abort on ignored builds.
FROM node:20-slim

WORKDIR /app
# CI=true so pnpm runs non-interactively (frozen install, no TTY prompts).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true

# Provide pnpm 10.23.0 on PATH via corepack (bundled with Node).
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

# Install workspace dependencies, then compile TypeScript to dist/.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Run the built server directly — no pnpm needed at runtime. Env comes from Railway.
CMD ["node", "apps/bot-server/dist/index.js"]
